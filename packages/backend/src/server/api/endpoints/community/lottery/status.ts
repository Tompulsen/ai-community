/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CommunityLotteryService } from '@/core/CommunityLotteryService.js';
import { lotteryErrors, lotteryStatusSchema } from '@/server/api/lottery-schema.js';

export const meta = {
	tags: ['community'], requireCredential: false, secure: true,
	limit: { duration: 60000, max: 30 }, errors: lotteryErrors, res: lotteryStatusSchema,
} as const;

export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private service: CommunityLotteryService) {
		super(meta, paramDef, async (ps, me) => service.status(me?.id));
	}
}
