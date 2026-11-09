/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CommunityService } from '@/core/CommunityService.js';
import { communityErrors, communityTagSchema } from '@/server/api/community-schema.js';

export const meta = {
	tags: ['admin', 'community'], requireCredential: true, requireAdmin: true, secure: true,
	limit: { duration: 60000, max: 60 }, errors: communityErrors,
	res: communityTagSchema,
} as const;

export const paramDef = {
	type: 'object',
	properties: { tagId: { type: 'string', format: 'misskey:id' }, name: { type: 'string', minLength: 1, maxLength: 24 } },
	required: ['tagId', 'name'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private service: CommunityService) {
		super(meta, paramDef, async (ps, me) => service.updateTag(me.id, ps.tagId, ps.name));
	}
}
