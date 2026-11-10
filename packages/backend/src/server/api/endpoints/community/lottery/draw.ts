/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CommunityLotteryService } from '@/core/CommunityLotteryService.js';
import { lotteryErrors, lotteryDrawSchema } from '@/server/api/lottery-schema.js';

export const meta = {
	tags: ['community'], requireCredential: true, secure: true,
	limit: { duration: 60000, max: 30 }, errors: lotteryErrors, res: lotteryDrawSchema,
} as const;

export const paramDef = { type: 'object', properties: { requestId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{16,64}$' }, count: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['requestId', 'count'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private service: CommunityLotteryService) {
		super(meta, paramDef, async (ps, me) => service.draw(me.id, ps.requestId, ps.count));
	}
}
