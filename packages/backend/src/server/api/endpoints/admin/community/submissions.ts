/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CommunityService } from '@/core/CommunityService.js';
import { communityErrors, communityPageSchema, communityListProperties } from '@/server/api/community-schema.js';

export const meta = {
	tags: ['admin'], requireCredential: true, requireModerator: true, secure: true,
	errors: communityErrors,
	res: communityPageSchema,
} as const;

export const paramDef = {
	type: 'object',
	properties: { ...communityListProperties, status: { type: 'string', enum: ['unreviewed', 'all', 'pending', 'published', 'approved', 'rejected', 'removed', 'withdrawn'], default: 'unreviewed' } },
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private service: CommunityService) {
		super(meta, paramDef, async (ps, me) => service.list('review', ps, me.id));
	}
}
