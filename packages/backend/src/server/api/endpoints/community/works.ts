/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CommunityService } from '@/core/CommunityService.js';
import { communityErrors, communityPageSchema, communityListProperties } from '@/server/api/community-schema.js';

export const meta = {
	limit: { duration: 60000, max: 60 },
	tags: ['community'], requireCredential: false,
	errors: communityErrors,
	res: communityPageSchema,
} as const;

export const paramDef = {
	type: 'object',
	properties: { noteIds: { type: 'array', items: { type: 'string', format: 'misskey:id' }, minItems: 1, maxItems: 50, uniqueItems: true }, ...communityListProperties, category: { type: 'string', enum: ['video', 'image', 'resource'] }, authorId: { type: 'string', format: 'misskey:id' } },
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private service: CommunityService) {
		super(meta, paramDef, async (ps, me) => service.list('public', ps, me?.id));
	}
}
