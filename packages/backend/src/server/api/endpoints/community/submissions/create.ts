/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CommunityService } from '@/core/CommunityService.js';
import { communityErrors } from '@/server/api/community-schema.js';

export const meta = {
	tags: ['community'], requireCredential: true, prohibitMoved: true, kind: 'write:notes', limit: { duration: 3600000, max: 100 },
	errors: communityErrors,
	res: { type: 'object', optional: false, nullable: false, properties: { id: { type: 'string', optional: false, nullable: false }, status: { type: 'string', enum: ['pending', 'published', 'approved', 'rejected', 'removed', 'withdrawn'], optional: false, nullable: false }, submittedAt: { type: 'string', format: 'date-time', optional: false, nullable: false } } },
} as const;

export const paramDef = {
	type: 'object',
	properties: { idempotencyKey: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-zA-Z0-9_-]+$' },
		category: { type: 'string', enum: ['video', 'image', 'resource'] },
		title: { type: 'string', minLength: 1, maxLength: 100 }, text: { type: 'string', maxLength: 2500, default: '' },
		model: { type: 'string', maxLength: 100, default: '' }, sourceUrl: { type: 'string', maxLength: 2000, default: '' }, license: { type: 'string', maxLength: 200, default: '' },
		fileIds: { type: 'array', uniqueItems: true, maxItems: 16, default: [], items: { type: 'string', format: 'misskey:id' } } },
	required: ['idempotencyKey', 'category', 'title'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private service: CommunityService) {
		super(meta, paramDef, async (ps, me) => service.submit(me.id, ps));
	}
}
