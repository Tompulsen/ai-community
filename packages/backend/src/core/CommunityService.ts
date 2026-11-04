/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, type EntityManager } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { MiCommunitySubmission } from '@/models/CommunitySubmission.js';
import { MiDriveFile } from '@/models/DriveFile.js';
import { MiNote } from '@/models/Note.js';
import { MiUser } from '@/models/User.js';
import { MiFollowing } from '@/models/Following.js';
import { MiBlocking } from '@/models/Blocking.js';
import type { MiMeta } from '@/models/Meta.js';
import { shouldHideNoteByTime } from '@/misc/should-hide-note-by-time.js';
import { ApiError } from '@/server/api/error.js';
import { communityErrors } from '@/server/api/community-schema.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { IdService } from './IdService.js';
import { NoteCreateService } from './NoteCreateService.js';
import { RoleService } from './RoleService.js';
import { DriveFileEntityService } from './entities/DriveFileEntityService.js';

type Category = MiCommunitySubmission['category'];
type Status = MiCommunitySubmission['status'];
type SubmissionInput = { idempotencyKey: string; category: Category; title: string; text: string; model: string; sourceUrl: string; license: string; fileIds: string[]; };
type ListInput = { limit: number; untilId?: string; query: string; category?: Category; authorId?: string; status?: Status | 'all'; };

@Injectable()
export class CommunityService {
	constructor(
		@Inject(DI.db) private db: DataSource,
		private idService: IdService,
		private noteCreateService: NoteCreateService,
		private roleService: RoleService,
		private driveFileEntityService: DriveFileEntityService,
		@Inject(DI.meta) private meta: MiMeta,
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
			return { id: existing.id, status: 'pending' as const, submittedAt: existing.submittedAt.toISOString() };
		}
		const submission = await this.db.transaction(async manager => {
			await this.author(manager, authorId);
			await this.files(manager, authorId, normalized.fileIds, normalized.category);
			const repo = manager.getRepository(MiCommunitySubmission);
			await repo.createQueryBuilder().insert().values({ ...normalized, id: this.idService.gen(), authorId, idempotencyKey, payloadHash, submittedAt: new Date(), status: 'pending', version: 0 }).orIgnore().execute();
			const result = await repo.findOneByOrFail({ authorId, idempotencyKey });
			if (result.payloadHash !== payloadHash) throw new ApiError(communityErrors.conflict);
			return result;
		});
		return { id: submission.id, status: 'pending' as const, submittedAt: submission.submittedAt.toISOString() };
	}

	public async list(scope: 'public' | 'mine' | 'review', options: ListInput, viewerId?: string) {
		if (scope !== 'public' && !viewerId) throw new ApiError(communityErrors.forbidden);
		if (scope === 'review' && !(await this.roleService.isModerator({ id: viewerId! }))) throw new ApiError(communityErrors.forbidden);
		if (scope === 'public' && !viewerId && this.meta.ugcVisibilityForVisitor === 'none') return { items: [], nextCursor: null };
		const query = scope === 'public' ? this.publicQuery(viewerId) : this.db.getRepository(MiCommunitySubmission).createQueryBuilder('submission')
			.innerJoinAndSelect('submission.author', 'author').leftJoinAndSelect('submission.approvedNote', 'note');
		if (scope !== 'public') {
			query.where(scope === 'mine' ? 'submission.authorId = :viewerId' : '1 = 1', { viewerId });
			if (options.status && options.status !== 'all') query.andWhere('submission.status = :status', { status: options.status });
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
		return { items: await Promise.all(rows.slice(0, options.limit).map(row => this.pack(row))), nextCursor: rows.length > options.limit ? rows[options.limit - 1].id : exhausted ? null : scannedCursor };
	}

	private publicQuery(viewerId?: string) {
		const query = this.db.getRepository(MiCommunitySubmission).createQueryBuilder('submission')
			.innerJoinAndSelect('submission.author', 'author').leftJoinAndSelect('submission.approvedNote', 'note')
			.where('submission.status = :approved', { approved: 'approved' })
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

	public async review(reviewerId: string, input: { submissionId: string; version: number; decision: 'approve' | 'reject'; reason?: string; }) {
		if (!(await this.roleService.isModerator({ id: reviewerId }))) throw new ApiError(communityErrors.forbidden);
		if (input.decision === 'reject' && !input.reason?.trim()) throw new ApiError(communityErrors.invalidContent);
		const afterCommit: (() => void)[] = [];
		const result = await this.db.transaction(async manager => {
			const repo = manager.getRepository(MiCommunitySubmission);
			const submission = await repo.createQueryBuilder('submission').setLock('pessimistic_write').where('submission.id = :id', { id: input.submissionId }).getOne();
			if (!submission) throw new ApiError(communityErrors.notFound);
			if (submission.status !== 'pending' || submission.version !== input.version) throw new ApiError(communityErrors.conflict);
			if (input.decision === 'approve') {
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
			submission.status = input.decision === 'approve' ? 'approved' : 'rejected';
			submission.rejectionReason = input.decision === 'reject' ? input.reason!.trim() : null;
			submission.version++;
			submission.reviewedAt = new Date();
			submission.reviewedById = reviewerId;
			await repo.save(submission);
			return submission;
		});
		for (const publish of afterCommit) publish();
		return this.pack(result);
	}

	private async pack(row: MiCommunitySubmission) {
		const author = row.author ?? await this.db.getRepository(MiUser).findOneByOrFail({ id: row.authorId });
		const note = row.approvedNote ?? (row.approvedNoteId ? await this.db.getRepository(MiNote).findOneBy({ id: row.approvedNoteId }) : null);
		const files = row.fileIds.length ? await this.db.getRepository(MiDriveFile).findBy({ id: In(row.fileIds), userId: row.authorId }) : [];
		return {
			id: row.id, version: row.version, category: row.category, title: row.title, text: row.text, model: row.model, sourceUrl: row.sourceUrl, license: row.license,
			files: await Promise.all(row.fileIds.flatMap(id => { const file = files.find(f => f.id === id); return file ? [this.driveFileEntityService.pack(file)] : []; })),
			author: { id: author.id, name: author.name ?? '', username: author.username }, status: row.status, submittedAt: row.submittedAt.toISOString(),
			rejectionReason: row.rejectionReason, approvedNoteId: row.approvedNoteId, repliesCount: note?.repliesCount ?? 0,
		};
	}
}
