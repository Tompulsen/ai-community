/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const lotteryErrors = {
	accountRequired: { message: 'Link an available balance account before drawing.', code: 'LOTTERY_ACCOUNT_REQUIRED', id: 'e3624915-fbfd-4d41-a2c2-e82ddab9e8e5', httpStatusCode: 409 },
	unavailable: { message: 'The lottery is paused or has no available prizes.', code: 'LOTTERY_UNAVAILABLE', id: '076ec4a1-13e6-46b9-9faa-0f08db69e331', httpStatusCode: 409 },
	insufficient: { message: 'Not enough draw chances.', code: 'LOTTERY_INSUFFICIENT', id: 'd4f5fef4-d6ae-4d88-94bc-38a0b391350a', httpStatusCode: 409 },
	conflict: { message: 'The settings or request have changed. Reload before retrying.', code: 'LOTTERY_CONFLICT', id: '8684c2a6-4f04-4aab-9ef1-d831f2d705ea', httpStatusCode: 409 },
	invalid: { message: 'Invalid lottery settings.', code: 'LOTTERY_INVALID', id: 'd1511895-911c-49ac-acd6-f1c114e24986', httpStatusCode: 400 },
	forbidden: { message: 'This account cannot perform this lottery action.', code: 'LOTTERY_FORBIDDEN', id: '8cc4a258-2611-4cab-9ff9-717b14e4a280', httpStatusCode: 403 },
	notFound: { message: 'No such lottery record.', code: 'LOTTERY_NOT_FOUND', id: 'f71bb5f9-a809-4fe1-beb2-84b9cfbd8469', httpStatusCode: 404 },
} as const;

const string = { type: 'string', optional: false, nullable: false } as const;
const integer = { type: 'integer', optional: false, nullable: false } as const;
const boolean = { type: 'boolean', optional: false, nullable: false } as const;
const rule = { type: 'object', optional: false, nullable: false, properties: { enabled: boolean, threshold: integer, tickets: integer } } as const;
export const lotteryPrizeSchema = { type: 'object', optional: false, nullable: false, properties: { id: string, name: string, description: string, amountCents: integer, weight: integer, stock: integer, enabled: boolean, kind: { ...string, enum: ['balance', 'empty'] } } } as const;
export const lotteryWheelSchema = { type: 'object', optional: false, nullable: false, properties: { theme: { ...string, enum: ['teal', 'violet', 'sunset'] }, title: string, subtitle: string, buttonText: string, rulesText: string } } as const;
export const lotterySettingsSchema = { type: 'object', optional: false, nullable: false, properties: { enabled: boolean, invites: rule, likes: rule, followers: rule, likesMode: { ...string, enum: ['work', 'total'] }, wheel: lotteryWheelSchema, prizes: { type: 'array', optional: false, nullable: false, items: lotteryPrizeSchema } } } as const;
export const lotteryConfigSchema = { type: 'object', optional: false, nullable: false, properties: { version: integer, settings: lotterySettingsSchema } } as const;
const award = { type: 'object', optional: false, nullable: false, properties: { prizeId: string, name: string, description: string, amountCents: integer, status: { ...string, enum: ['pending', 'fulfilled', 'empty'] }, fulfilledAt: { ...string, nullable: true }, note: string } } as const;
export const lotteryDrawSchema = { type: 'object', optional: false, nullable: false, properties: { id: string, userId: string, username: string, createdAt: string, creditAttempts: integer, prizes: { type: 'array', optional: false, nullable: false, items: award } } } as const;
export const lotteryRecordsSchema = { type: 'object', optional: false, nullable: false, properties: { items: { type: 'array', optional: false, nullable: false, items: lotteryDrawSchema }, nextCursor: { ...string, nullable: true } } } as const;
export const lotteryStatusSchema = { type: 'object', optional: false, nullable: false, properties: {
	settings: lotterySettingsSchema, balance: integer, creditReady: boolean, accountLinked: boolean, earned: { type: 'object', optional: false, nullable: false, properties: { invites: integer, likes: integer, followers: integer } },
	counts: { type: 'object', optional: false, nullable: false, properties: { invites: integer, likes: integer, followers: integer, bestWorkLikes: integer } }, inviteUrl: string,
} } as const;

const ruleParam = { type: 'object', additionalProperties: false, properties: { enabled: { type: 'boolean' }, threshold: { type: 'integer', minimum: 1, maximum: 1000000 }, tickets: { type: 'integer', minimum: 1, maximum: 1000 } }, required: ['enabled', 'threshold', 'tickets'] } as const;
export const lotterySettingsParam = { type: 'object', additionalProperties: false, properties: {
	enabled: { type: 'boolean' }, invites: ruleParam, likes: ruleParam, followers: ruleParam, likesMode: { type: 'string', enum: ['work', 'total'] },
	wheel: { type: 'object', additionalProperties: false, properties: { theme: { type: 'string', enum: ['teal', 'violet', 'sunset'] }, title: { type: 'string', maxLength: 32 }, subtitle: { type: 'string', maxLength: 120 }, buttonText: { type: 'string', minLength: 1, maxLength: 8 }, rulesText: { type: 'string', maxLength: 2000 } }, required: ['theme', 'title', 'subtitle', 'buttonText', 'rulesText'] },
	prizes: { type: 'array', maxItems: 30, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' }, name: { type: 'string', minLength: 1, maxLength: 80 }, description: { type: 'string', maxLength: 500 }, amountCents: { type: 'integer', minimum: 0, maximum: 1000000 }, weight: { type: 'integer', minimum: 1, maximum: 1000000 }, stock: { type: 'integer', minimum: -1, maximum: 1000000 }, enabled: { type: 'boolean' }, kind: { type: 'string', enum: ['balance', 'empty'] } }, required: ['id', 'name', 'description', 'amountCents', 'weight', 'stock', 'enabled', 'kind'] } },
}, required: ['enabled', 'invites', 'likes', 'followers', 'likesMode', 'prizes'] } as const;
