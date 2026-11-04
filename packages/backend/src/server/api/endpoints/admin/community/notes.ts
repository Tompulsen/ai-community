/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { Config } from '@/config.js';
import type { NotesRepository, PollsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { loadAiCommunityConfig } from '@/misc/ai-community-config.js';

export const meta = {
	tags: ['admin', 'notes'],
	requireCredential: true,
	requireModerator: true,
	kind: 'read:admin:abuse-user-reports',
	limit: { duration: 60000, max: 120 },
	res: {
		type: 'array', optional: false, nullable: false,
		items: { type: 'object', optional: false, nullable: false, ref: 'Note' },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		module: { type: 'string', enum: ['video', 'image', 'knowledge'] },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: ['module'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,
		@Inject(DI.pollsRepository)
		private pollsRepository: PollsRepository,
		private queryService: QueryService,
		private noteEntityService: NoteEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const channels = await loadAiCommunityConfig(this.config.rootDir);
			const channelId = channels[ps.module];
			if (!channelId) return [];
			// Moderation must not inherit personal blocks, mutes, or fanout filters.
			// Restrict access to public posts in the configured official channels.
			const query = this.queryService.makePaginationQuery(this.notesRepository.createQueryBuilder('note'), ps.sinceId, ps.untilId)
				.andWhere('note.channelId = :channelId', { channelId })
				.andWhere('note.visibility = :visibility', { visibility: 'public' })
				.take(ps.limit);
			const notes = await query.getMany();
			const packed = await this.noteEntityService.packMany(notes, me, { detail: false, skipHide: true });
			const pollIds = notes.filter(note => note.hasPoll).map(note => note.id);
			const polls = pollIds.length ? await this.pollsRepository.findBy({ noteId: In(pollIds) }) : [];
			const pollsByNote = new Map(polls.map(poll => [poll.noteId, poll]));
			for (const note of packed) {
				const poll = pollsByNote.get(note.id);
				if (!poll) continue;
				note.poll = {
					multiple: poll.multiple,
					expiresAt: poll.expiresAt?.toISOString() ?? null,
					choices: poll.choices.map((text, index) => ({ text, votes: poll.votes[index] ?? 0, isVoted: false })),
				};
			}
			return packed;
		});
	}
}
