/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CommunityService } from '@/core/CommunityService.js';
import { communityTagSchema } from '@/server/api/community-schema.js';

export const meta = {
	tags: ['community'], requireCredential: false,
	limit: { duration: 60000, max: 120 },
	res: { type: 'array', optional: false, nullable: false, items: communityTagSchema },
} as const;

export const paramDef = {
	type: 'object',
	properties: { category: { type: 'string', enum: ['image', 'video', 'resource'] } },
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private service: CommunityService) {
		super(meta, paramDef, async ps => service.listTags(ps.category));
	}
}
