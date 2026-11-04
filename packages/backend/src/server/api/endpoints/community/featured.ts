/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CommunityService } from '@/core/CommunityService.js';
import { communityPageSchema } from '@/server/api/community-schema.js';

export const meta = {
	limit: { duration: 60000, max: 30 },
	tags: ['community'], requireCredential: false,
	res: communityPageSchema,
} as const;

export const paramDef = {
	type: 'object', properties: {}, required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private service: CommunityService) {
		super(meta, paramDef, async () => service.featured());
	}
}
