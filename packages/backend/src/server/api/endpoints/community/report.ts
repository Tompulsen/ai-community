/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { communityErrors } from '@/server/api/community-schema.js';
import { CommunityService } from '@/core/CommunityService.js';
import { AbuseReportService } from '@/core/AbuseReportService.js';
import { RoleService } from '@/core/RoleService.js';
import { GetterService } from '@/server/api/GetterService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';

export const meta = {
	tags: ['users'], requireCredential: true, kind: 'write:report-abuse',
	limit: { duration: 60000, max: 5 }, errors: communityErrors,
} as const;
export const paramDef = {
	type: 'object',
	properties: {
		submissionId: { type: 'string', format: 'misskey:id' },
		noteId: { type: 'string', format: 'misskey:id' },
		reason: { type: 'string', minLength: 1, maxLength: 1000 },
	},
	required: ['submissionId', 'reason'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config) private config: Config,
		private communityService: CommunityService,
		private abuseReportService: AbuseReportService,
		private getterService: GetterService,
		private noteEntityService: NoteEntityService,
		private roleService: RoleService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!ps.reason.trim()) throw new ApiError(communityErrors.invalidContent);
			const work = await this.communityService.show(ps.submissionId, me.id);
			let targetId = work.author.id;
			let contentKey = `work:${work.id}`;
			let snapshot = JSON.stringify({ title: work.title, text: work.text, files: work.files.map(file => ({ id: file.id, name: file.name })) });
			let path = `/community/work/${work.id}`;
			if (ps.noteId) {
				const note = await this.getterService.getNoteWithRelations(ps.noteId).catch(() => { throw new ApiError(communityErrors.notFound); });
				if (note.replyId !== work.approvedNoteId || note.userHost !== null) throw new ApiError(communityErrors.notFound);
				const packed = await this.noteEntityService.pack(note, me, { detail: true });
				if (packed.isHidden) throw new ApiError(communityErrors.notFound);
				targetId = note.userId;
				contentKey = `note:${note.id}`;
				snapshot = JSON.stringify({ text: note.text, cw: note.cw, fileIds: note.fileIds });
				path = `/notes/${note.id}`;
			}
			if (targetId === me.id || await this.roleService.isAdministrator({ id: targetId })) throw new ApiError(communityErrors.forbidden);
			await this.abuseReportService.report([{
				targetUserId: targetId, targetUserHost: null, reporterId: me.id, reporterHost: null,
				comment: `${this.config.url}${path}\n\n${ps.reason.trim()}`, contentKey, contentSnapshot: snapshot,
			}]);
		});
	}
}
