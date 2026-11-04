/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const communityErrors = {
	invalidFiles: { message: 'Invalid or unavailable community attachments.', code: 'COMMUNITY_INVALID_FILES', id: '6d79454d-1011-45fc-8580-3b9a86fb76fc', httpStatusCode: 400 },
	invalidContent: { message: 'Invalid community content.', code: 'COMMUNITY_INVALID_CONTENT', id: '3f9e490d-3f0d-47b0-aab3-b6a64a487a8e', httpStatusCode: 400 },
	authorUnavailable: { message: 'The author is unavailable.', code: 'COMMUNITY_AUTHOR_UNAVAILABLE', id: 'cd0c8e78-44e1-46ec-a898-632d195a03d2', httpStatusCode: 400 },
	cannotPublish: { message: 'The content cannot be published publicly.', code: 'COMMUNITY_CANNOT_PUBLISH', id: '99e25bc2-3c5d-4e8c-8eed-caca5f1473bb', httpStatusCode: 400 },
	notFound: { message: 'No such community submission.', code: 'COMMUNITY_NOT_FOUND', id: 'aedfe7ed-0d04-4ca7-8e19-408e7732dc8c', httpStatusCode: 404 },
	conflict: { message: 'The submission has changed or the idempotency key is in use.', code: 'COMMUNITY_CONFLICT', id: '34635dea-5dba-40d4-a409-43c473b7bec0', httpStatusCode: 409 },
	forbidden: { message: 'Moderator or owner authorization required.', code: 'COMMUNITY_FORBIDDEN', id: 'c3cde43b-5971-4209-9c36-7d2cc025b1fa', httpStatusCode: 403 },
} as const;

const string = { type: 'string', optional: false, nullable: false } as const;
const nullableString = { ...string, nullable: true } as const;
export const communityWorkSchema = {
	type: 'object', optional: false, nullable: false,
	properties: {
		id: string, version: { type: 'integer', optional: false, nullable: false },
		category: { ...string, enum: ['video', 'image', 'resource'] },
		title: string, text: string, model: string, sourceUrl: string, license: string,
		files: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, ref: 'DriveFile' } },
		author: { type: 'object', optional: false, nullable: false, properties: { id: string, name: string, username: string } },
		status: { ...string, enum: ['pending', 'approved', 'rejected'] },
		submittedAt: { ...string, format: 'date-time' }, rejectionReason: nullableString, approvedNoteId: nullableString,
		repliesCount: { type: 'integer', optional: false, nullable: false },
	},
} as const;
export const communityPageSchema = {
	type: 'object', optional: false, nullable: false,
	properties: { items: { type: 'array', optional: false, nullable: false, items: communityWorkSchema }, nextCursor: nullableString },
} as const;
export const communityListProperties = {
	limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
	untilId: { type: 'string', format: 'misskey:id' },
	query: { type: 'string', maxLength: 200, default: '' },
} as const;
