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
} as const;

export const paramDef = {
	type: 'object',
	properties: { submissionId: { type: 'string', format: 'misskey:id' }, version: { type: 'integer', minimum: 0 } },
	required: ['submissionId', 'version'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private service: CommunityService) {
		super(meta, paramDef, async (ps, me) => service.delete(me.id, ps));
	}
}
