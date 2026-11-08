/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { In, type EntityManager } from 'typeorm';
import { MiCommunitySubmission } from '@/models/CommunitySubmission.js';
import { MiNote } from '@/models/Note.js';
import { ApiError } from '@/server/api/error.js';
import { communityErrors } from '@/server/api/community-schema.js';

export const hasVideoAttachments = (files?: readonly { type: string }[] | null) => (files ?? []).some(file => file.type.toLowerCase().startsWith('video/'));

export async function isCommunityReply(manager: EntityManager, reply: Pick<MiNote, 'id' | 'threadId'>) {
	const ids = [reply.id, ...(reply.threadId ? [reply.threadId] : [])];
	return manager.getRepository(MiCommunitySubmission).existsBy({ approvedNoteId: In(ids), destination: 'community' });
}

/** Enforce the same rule for ordinary replies, nested replies and studio shares. */
export async function assertCommunityCommentMedia(manager: EntityManager, data: {
	reply?: Pick<MiNote, 'id' | 'threadId'> | null;
	files?: { type: string }[] | null;
	renote?: Pick<MiNote, 'id' | 'renoteId' | 'attachedFileTypes'> | null;
}) {
	if (!data.reply || (!hasVideoAttachments(data.files) && !data.renote)) return;
	if (!await isCommunityReply(manager, data.reply)) return;
	if (hasVideoAttachments(data.files)) throw new ApiError(communityErrors.invalidFiles);
	let referenceId = data.renote?.id;
	const seen = new Set<string>();
	while (referenceId) {
		if (seen.has(referenceId) || seen.size >= 32) throw new ApiError(communityErrors.invalidFiles);
		const query = manager.getRepository(MiNote).createQueryBuilder('reference').where({ id: referenceId });
		// Keep the reference stable until the comment insert commits; edits use a write lock.
		if (manager.queryRunner?.isTransactionActive) query.setLock('pessimistic_read');
		const reference = await query.getOne();
		if (!reference || reference.attachedFileTypes.some(type => type.toLowerCase().startsWith('video/'))) throw new ApiError(communityErrors.invalidFiles);
		seen.add(referenceId);
		referenceId = reference.renoteId ?? undefined;
	}
}

/** An existing comment must not gain a video when its referenced work is edited. */
export async function assertCommunityVideoEdit(manager: EntityManager, noteId: string) {
	const referenced = await manager.query(`
		WITH RECURSIVE quoted AS (
			SELECT id, "replyId", "threadId" FROM note WHERE "renoteId" = $1
			UNION
			SELECT n.id, n."replyId", n."threadId" FROM note n INNER JOIN quoted q ON n."renoteId" = q.id
		)
		SELECT 1 FROM quoted q INNER JOIN community_submission s
		ON s."approvedNoteId" IN (q."replyId", q."threadId")
		WHERE s.destination = 'community' LIMIT 1
	`, [noteId]);
	if (referenced.length) throw new ApiError(communityErrors.invalidFiles);
}
