/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CommunityService } from '@/core/CommunityService.js';
import { communityErrors, communityWorkSchema, communityTagIdsParam } from '@/server/api/community-schema.js';
import { paramDef as createParamDef } from './create.js';

export const meta = {
	tags: ['community'], requireCredential: true, prohibitMoved: true, kind: 'write:notes', limit: { duration: 3600000, max: 100 },
	errors: communityErrors, res: communityWorkSchema,
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		tagIds: communityTagIdsParam,
		submissionId: { type: 'string', format: 'misskey:id' }, version: { type: 'integer', minimum: 0 },
		category: createParamDef.properties.category, title: createParamDef.properties.title, text: createParamDef.properties.text,
		model: createParamDef.properties.model, sourceUrl: createParamDef.properties.sourceUrl, license: createParamDef.properties.license,
		fileIds: createParamDef.properties.fileIds, generation: createParamDef.properties.generation,
	},
	required: ['submissionId', 'version', 'category', 'title'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private service: CommunityService) {
		super(meta, paramDef, async (ps, me) => service.update(me.id, ps));
	}
}
