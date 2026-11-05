/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CommunityService } from '@/core/CommunityService.js';
import { communityErrors, communityWorkSchema } from '@/server/api/community-schema.js';

export const meta = {
	limit: { duration: 60000, max: 60 },
	tags: ['admin'], requireCredential: true, requireModerator: true, secure: true,
	errors: communityErrors,
	res: communityWorkSchema,
} as const;

export const paramDef = {
	type: 'object',
	properties: { submissionId: { type: 'string', format: 'misskey:id' }, version: { type: 'integer', minimum: 0 }, decision: { type: 'string', enum: ['approve', 'reject', 'remove'] }, reason: { type: 'string', maxLength: 1000 } },
	required: ['submissionId', 'version', 'decision'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private service: CommunityService) {
		super(meta, paramDef, async (ps, me) => service.review(me.id, ps));
	}
}
