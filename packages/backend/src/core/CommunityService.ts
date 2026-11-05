/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import type * as Redis from 'ioredis';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, type EntityManager } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { MiCommunitySubmission } from '@/models/CommunitySubmission.js';
import { MiDriveFile } from '@/models/DriveFile.js';
import { MiNote } from '@/models/Note.js';
import { MiUser } from '@/models/User.js';
import { MiFollowing } from '@/models/Following.js';
import { MiBlocking } from '@/models/Blocking.js';
import { MiAnnouncement } from '@/models/Announcement.js';
import { MiModerationLog } from '@/models/ModerationLog.js';
import type { MiMeta } from '@/models/Meta.js';
import { shouldHideNoteByTime } from '@/misc/should-hide-note-by-time.js';
import { ApiError } from '@/server/api/error.js';
import { communityErrors } from '@/server/api/community-schema.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { IdService } from './IdService.js';
import { NoteCreateService } from './NoteCreateService.js';
import { NoteDeleteService } from './NoteDeleteService.js';
import { GlobalEventService } from './GlobalEventService.js';
import { AnnouncementEntityService } from './entities/AnnouncementEntityService.js';
import { ReactionsBufferingService } from './ReactionsBufferingService.js';
import { RoleService } from './RoleService.js';
import { DriveFileEntityService } from './entities/DriveFileEntityService.js';

type Category = MiCommunitySubmission['category'];
type Status = MiCommunitySubmission['status'];
type SubmissionInput = { idempotencyKey: string; category: Category; title: string; text: string; model: string; sourceUrl: string; license: string; fileIds: string[]; };
type ListInput = { limit: number; untilId?: string; query: string; category?: Category; authorId?: string; status?: Status | 'all' | 'unreviewed' | 'withdrawn'; };

@Injectable()
export class CommunityService {
	constructor(
		@Inject(DI.db) private db: DataSource,
		private idService: IdService,
		private noteCreateService: NoteCreateService,
		private roleService: RoleService,
		private driveFileEntityService: DriveFileEntityService,
		@Inject(DI.meta) private meta: MiMeta,
		private noteDeleteService: NoteDeleteService,
		private globalEventService: GlobalEventService,
		private announcementEntityService: AnnouncementEntityService,
		@Inject(DI.redis) private redis: Redis.Redis,
		private reactionsBufferingService: ReactionsBufferingService,
	) {}

	private async files(manager: EntityManager, authorId: string, fileIds: string[], category: Category) {
		const files = fileIds.length ? await manager.getRepository(MiDriveFile).findBy({ id: In(fileIds), userId: authorId }) : [];
		if (files.length !== fileIds.length || files.length > 16 ||
			(category === 'image' && !files.some(file => file.type.startsWith('image/'))) ||
			(category === 'video' && !files.some(file => file.type.startsWith('video/')))) throw new ApiError(communityErrors.invalidFiles);
		return fileIds.map(fileId => files.find(file => file.id === fileId)!);
	}

	private async author(manager: EntityManager, id: string) {
		const user = await manager.getRepository(MiUser).findOneBy({ id });
		if (!user || user.host !== null || user.isSuspended || user.isDeleted || user.movedToUri) throw new ApiError(communityErrors.authorUnavailable);
		return user;
	}

	public async submit(authorId: string, input: SubmissionInput) {
		const { idempotencyKey, ...payload } = input;
		const normalized = { category: payload.category, title: payload.title.trim(), text: payload.text.trim(), model: payload.model.trim(), sourceUrl: payload.sourceUrl.trim(), license: payload.license.trim(), fileIds: payload.fileIds };
		if (!normalized.title || (!normalized.text && !normalized.fileIds.length)) throw new ApiError(communityErrors.invalidContent);
		if (normalized.sourceUrl) {
			try { const url = new URL(normalized.sourceUrl); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); } catch { throw new ApiError(communityErrors.invalidContent); }
		}
		const payloadHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
		const repository = this.db.getRepository(MiCommunitySubmission);
		const existing = await repository.findOneBy({ authorId, idempotencyKey });
		if (existing) {
			if (existing.payloadHash !== payloadHash) throw new ApiError(communityErrors.conflict);
			return this.receipt(existing);
		}
		const afterCommit: (() => void)[] = [];
		const publicationMode = this.meta.clientOptions.communityPublicationMode === 'after' ? 'after' : 'before';
		const submission = await this.db.transaction(async manager => {
			await this.author(manager, authorId);
			await this.files(manager, authorId, normalized.fileIds, normalized.category);
			const repo = manager.getRepository(MiCommunitySubmission);
			const id = this.idService.gen();
			await repo.createQueryBuilder().insert().values({ ...normalized, id, authorId, idempotencyKey, payloadHash, publicationMode, submittedAt: new Date(), status: 'pending', version: 0 }).orIgnore().execute();
			const result = await repo.createQueryBuilder('submission').setLock('pessimistic_write').where({ authorId, idempotencyKey }).getOneOrFail();
			if (result.payloadHash !== payloadHash) throw new ApiError(communityErrors.conflict);
			// Only the transaction that inserted this row may publish it. Retries return its current state.
			if (result.id === id && publicationMode === 'after') {
				await this.publish(result, manager, afterCommit);
				result.status = 'published';
				await repo.save(result);
			}
			return result;
		});
		for (const publish of afterCommit) publish();
		return this.receipt(submission);
	}

	private async receipt(row: MiCommunitySubmission) {
		const visibleStatus = ['approved', 'published'].includes(row.status) && (!row.approvedNoteId || !await this.db.getRepository(MiNote).existsBy({ id: row.approvedNoteId })) ? 'withdrawn' as const : row.status;
		return { id: row.id, status: visibleStatus, submittedAt: row.submittedAt.toISOString() };
	}

	private async publish(submission: MiCommunitySubmission, manager: EntityManager, afterCommit: (() => void)[]) {
		const author = await this.author(manager, submission.authorId);
		const files = await this.files(manager, author.id, submission.fileIds, submission.category);
		const text = [submission.title, submission.text, submission.model && `模型 / 工具：${submission.model}`, submission.sourceUrl && `来源：${submission.sourceUrl}`, submission.license && `授权：${submission.license}`].filter(Boolean).join('\n\n');
		try {
			const note = await this.noteCreateService.create(author, { text, files, visibility: 'public', localOnly: true }, false, { manager, afterCommit });
			if (note.visibility !== 'public') throw new ApiError(communityErrors.cannotPublish);
			submission.approvedNoteId = note.id;
		} catch (error) {
			if (error instanceof IdentifiableError) throw new ApiError(communityErrors.cannotPublish);
			throw error;
		}
	}

	public async list(scope: 'public' | 'mine' | 'review', options: ListInput, viewerId?: string) {
		if (scope !== 'public' && !viewerId) throw new ApiError(communityErrors.forbidden);
		if (scope === 'review' && !(await this.roleService.isModerator({ id: viewerId! }))) throw new ApiError(communityErrors.forbidden);
		if (scope === 'public' && !viewerId && this.meta.ugcVisibilityForVisitor === 'none') return { items: [], nextCursor: null };
		const query = scope === 'public' ? this.publicQuery(viewerId) : this.db.getRepository(MiCommunitySubmission).createQueryBuilder('submission')
			.innerJoinAndSelect('submission.author', 'author').leftJoinAndSelect('submission.approvedNote', 'note');
		if (scope !== 'public') {
			query.where(scope === 'mine' ? 'submission.authorId = :viewerId' : '1 = 1', { viewerId });
			if (options.status === 'unreviewed') query.andWhere("(submission.status = 'pending' OR (submission.status = 'published' AND note.id IS NOT NULL))");
			else if (options.status === 'withdrawn') query.andWhere("submission.status IN ('approved', 'published') AND note.id IS NULL");
			else if (options.status && options.status !== 'all') {
				query.andWhere('submission.status = :status', { status: options.status });
				if (['approved', 'published'].includes(options.status)) query.andWhere('note.id IS NOT NULL');
			}
		}
		if (options.category) query.andWhere('submission.category = :category', { category: options.category });
		if (options.authorId) query.andWhere('submission.authorId = :authorId', { authorId: options.authorId });
		if (options.untilId) query.andWhere('submission.id < :cursor', { cursor: options.untilId });
		if (options.query.trim()) query.andWhere('(submission.title ILIKE :query OR submission.text ILIKE :query OR author.name ILIKE :query OR author.username ILIKE :query)', { query: `%${options.query.trim().replace(/[\\%_]/g, '\\$&')}%` });
		const rows: MiCommunitySubmission[] = [];
		let scannedCursor: string | null = null;
		let exhausted = false;
		// Apply native author privacy before selecting a response page. Bound each scan.
		for (let batch = 0; batch < 10 && rows.length <= options.limit; batch++) {
			const page = query.clone().orderBy('submission.id', 'DESC').take(50);
			if (scannedCursor) page.andWhere('submission.id < :scannedCursor', { scannedCursor });
			const candidates = await page.getMany();
			for (const row of candidates) {
				scannedCursor = row.id;
				if (scope !== 'public' || await this.visible(row, viewerId)) rows.push(row);
				if (rows.length > options.limit) break;
			}
			if (candidates.length < 50) { exhausted = true; break; }
		}
		const selected = rows.slice(0, options.limit);
		const buffered = this.meta.enableReactionsBuffering ? await this.reactionsBufferingService.getMany(selected.flatMap(row => row.approvedNoteId ? [row.approvedNoteId] : [])) : new Map();
		return { items: await Promise.all(selected.map(row => this.pack(row, buffered.get(row.approvedNoteId!)?.deltas ?? {}))), nextCursor: rows.length > options.limit ? rows[options.limit - 1].id : exhausted ? null : scannedCursor };
	}

public async show(submissionId: string, viewerId?: string) {
		return this.pack(await this.publicWork(submissionId, viewerId));
	}

	private async publicWork(submissionId: string, viewerId?: string) {
		if (!viewerId && this.meta.ugcVisibilityForVisitor === 'none') throw new ApiError(communityErrors.notFound);
		const row = await this.publicQuery(viewerId).andWhere('submission.id = :submissionId', { submissionId }).getOne();
		if (!row || !await this.visible(row, viewerId)) throw new ApiError(communityErrors.notFound);
		return row;
	}

	public async recordView(submissionId: string, viewerId?: string, ip?: string | null) {
		const row = await this.publicWork(submissionId, viewerId);
		// Use server-owned identity, never a browser-supplied visitor id. No raw IP is stored.
		const identity = viewerId ? 'user:' + viewerId : ip ? 'ip:' + ip : null;
		if (!identity) return { viewsCount: row.viewsCount };
		const key = 'community:view:' + submissionId + ':' + createHash('sha256').update(identity).digest('hex');
		if (await this.redis.set(key, '1', 'EX', 1800, 'NX')) {
			const result = await this.db.getRepository(MiCommunitySubmission).createQueryBuilder().update()
				.set({ viewsCount: () => 'LEAST("viewsCount"::bigint + 1, 2147483647)' })
				.where('id = :id AND status IN (:...statuses) AND "approvedNoteId" = :noteId', { id: row.id, statuses: ['approved', 'published'], noteId: row.approvedNoteId })
				.returning(['viewsCount']).execute();
			if (!result.affected) throw new ApiError(communityErrors.notFound);
			return { viewsCount: result.raw[0].viewsCount as number };
		}
		return { viewsCount: row.viewsCount };
	}

	private publicQuery(viewerId?: string) {
		const query = this.db.getRepository(MiCommunitySubmission).createQueryBuilder('submission')
			.innerJoinAndSelect('submission.author', 'author').leftJoinAndSelect('submission.approvedNote', 'note')
			.where('submission.status IN (:...publicStatuses)', { publicStatuses: ['approved', 'published'] })
			.andWhere('note.id IS NOT NULL AND note.visibility = :visibility', { visibility: 'public' })
			.andWhere('author.isSuspended = FALSE AND author.isDeleted = FALSE');
		if (!viewerId) query.andWhere('author.requireSigninToViewContents = FALSE');
		return query;
	}

	/** One universally public work, ranked by reactions + replies + renotes. */
	public async featured() {
		if (this.meta.ugcVisibilityForVisitor === 'none') return { items: [], nextCursor: null };
		const heat = 'note."repliesCount"::bigint + note."renoteCount"::bigint + COALESCE((SELECT SUM(reaction.value::bigint) FROM jsonb_each_text(note.reactions) AS reaction), 0)';
		// One ordered query avoids mixing score ordering with the chronological list cursor.
		// These are only many-to-one joins; limit avoids TypeORM's DISTINCT pagination wrapper.
		const candidates = await this.publicQuery().addSelect(heat, 'community_heat')
			.orderBy('community_heat', 'DESC').addOrderBy('submission.id', 'DESC').limit(500).getMany();
		for (const candidate of candidates) {
			// Always use the visitor view, including when an administrator calls this endpoint.
			if (await this.visible(candidate)) return { items: [await this.pack(candidate)], nextCursor: null };
		}
		return { items: [], nextCursor: null };
	}

	private async visible(row: MiCommunitySubmission, viewerId?: string) {
		if (viewerId === row.authorId) return true;
		const createdAt = this.idService.parse(row.approvedNoteId!).date;
		if (shouldHideNoteByTime(row.author.makeNotesHiddenBefore, createdAt)) return false;
		if (viewerId && await this.db.getRepository(MiBlocking).exists({ where: [
			{ blockerId: row.authorId, blockeeId: viewerId }, { blockerId: viewerId, blockeeId: row.authorId },
		] })) return false;
		if (shouldHideNoteByTime(row.author.makeNotesFollowersOnlyBefore, createdAt)) {
			return !!viewerId && await this.db.getRepository(MiFollowing).existsBy({ followerId: viewerId, followeeId: row.authorId });
		}
		return true;
	}

	public async review(reviewerId: string, input: { submissionId: string; version: number; decision: 'approve' | 'reject' | 'remove'; reason?: string; }) {
		if (!(await this.roleService.isModerator({ id: reviewerId }))) throw new ApiError(communityErrors.forbidden);
		if (input.decision !== 'approve' && !input.reason?.trim()) throw new ApiError(communityErrors.invalidContent);
		const afterCommit: (() => void)[] = [];
		const result = await this.db.transaction(async manager => {
			const repo = manager.getRepository(MiCommunitySubmission);
			const submission = await repo.createQueryBuilder('submission').setLock('pessimistic_write').where('submission.id = :id', { id: input.submissionId }).getOne();
			if (!submission) throw new ApiError(communityErrors.notFound);
			const allowed = input.decision === 'approve' ? ['pending', 'published'] : input.decision === 'reject' ? ['pending'] : ['published', 'approved'];
			if (!allowed.includes(submission.status) || submission.version !== input.version) throw new ApiError(communityErrors.conflict);
			const note = submission.approvedNoteId ? await manager.getRepository(MiNote).createQueryBuilder('note').where({ id: submission.approvedNoteId }).setLock('pessimistic_write').getOne() : null;
			if (submission.status !== 'pending' && !note) throw new ApiError(communityErrors.conflict);
			if (input.decision === 'approve') {
				if (submission.status === 'pending') await this.publish(submission, manager, afterCommit);
			} else if (input.decision === 'remove' && note) {
				const author = await manager.getRepository(MiUser).findOneByOrFail({ id: submission.authorId });
				await this.noteDeleteService.deleteLocalInTransaction(author, note, { manager, afterCommit });
				await manager.getRepository(MiModerationLog).insert({ id: this.idService.gen(), userId: reviewerId, type: 'deleteNote', info: {
					noteId: note.id, noteUserId: author.id, noteUserUsername: author.username, noteUserHost: author.host,
					note, communitySubmissionId: submission.id, reason: input.reason!.trim(),
				} });
				submission.approvedNoteId = null;
			}
			submission.status = input.decision === 'approve' ? 'approved' : input.decision === 'remove' ? 'removed' : 'rejected';
			submission.rejectionReason = input.decision !== 'approve' ? input.reason!.trim() : null;
			submission.version++;
			submission.reviewedAt = new Date();
			submission.reviewedById = reviewerId;
			await repo.save(submission);
			if (input.decision !== 'approve') await this.notifyAuthor(submission, manager, afterCommit);
			return submission;
		});
		for (const publish of afterCommit) publish();
		return this.pack(result);
	}

	private async notifyAuthor(row: MiCommunitySubmission, manager: EntityManager, afterCommit: (() => void)[]) {
		// A private, durable notice survives disconnects and disabled app notifications.
		const announcement = manager.getRepository(MiAnnouncement).create({
			id: this.idService.gen(), updatedAt: null, userId: row.authorId,
			title: row.status === 'removed' ? '作品违规，已下架 / Work removed' : '作品审核未通过 / Submission rejected',
			text: `《${row.title}》\n${row.rejectionReason}\n\n请在“我的投稿”查看审核反馈。 / View feedback in My submissions.`,
			imageUrl: null, icon: 'warning', display: 'banner', needConfirmationToRead: true,
			isActive: true, autoArchiveAt: null, forExistingUsers: false, silence: false,
		});
		await manager.getRepository(MiAnnouncement).insert(announcement);
		const packed = await this.announcementEntityService.pack({ ...announcement, isRead: false }, { id: row.authorId });
		afterCommit.push(() => this.globalEventService.publishMainStream(row.authorId, 'announcementCreated', { announcement: packed }));
	}

	private async pack(row: MiCommunitySubmission, deltas?: Record<string, number>) {
		const author = row.author ?? await this.db.getRepository(MiUser).findOneByOrFail({ id: row.authorId });
		const note = row.approvedNote ?? (row.approvedNoteId ? await this.db.getRepository(MiNote).findOneBy({ id: row.approvedNoteId }) : null);
		const files = row.fileIds.length ? await this.db.getRepository(MiDriveFile).findBy({ id: In(row.fileIds), userId: row.authorId }) : [];
		const buffered = deltas ?? (note && this.meta.enableReactionsBuffering ? (await this.reactionsBufferingService.get(note.id)).deltas : {});
		const reactions = this.reactionsBufferingService.mergeReactions(note?.reactions ?? {}, buffered);
		const likesCount = Object.entries(reactions).reduce((sum, [key, count]) => sum + (key.replaceAll('\uFE0F', '') === '❤' ? count : 0), 0);
		return {
			id: row.id, version: row.version, category: row.category, title: row.title, text: row.text, model: row.model, sourceUrl: row.sourceUrl, license: row.license,
			files: await Promise.all(row.fileIds.flatMap(id => { const file = files.find(f => f.id === id); return file ? [this.driveFileEntityService.pack(file)] : []; })),
			author: { id: author.id, name: author.name ?? '', username: author.username }, status: ['approved', 'published'].includes(row.status) && !note ? 'withdrawn' as const : row.status, submittedAt: row.submittedAt.toISOString(),
			rejectionReason: row.rejectionReason, approvedNoteId: row.approvedNoteId, repliesCount: note?.repliesCount ?? 0, likesCount, renotesCount: note?.renoteCount ?? 0, viewsCount: row.viewsCount,
		};
	}
}
