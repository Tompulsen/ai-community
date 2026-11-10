/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CommunityLotteryService } from '@/core/CommunityLotteryService.js';
import { lotteryErrors, lotteryDrawSchema } from '@/server/api/lottery-schema.js';

export const meta = {
	tags: ['community', 'admin'], requireCredential: true, secure: true, requireAdmin: true,
	limit: { duration: 60000, max: 30 }, errors: lotteryErrors, res: lotteryDrawSchema,
} as const;

export const paramDef = { type: 'object', properties: { drawId: { type: 'string', format: 'misskey:id', maxLength: 32 }, }, required: ['drawId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private service: CommunityLotteryService) {
		super(meta, paramDef, async (ps, me) => service.fulfill(me.id, ps.drawId));
	}
}
