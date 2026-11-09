/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const communityErrors = {
	invalidTags: { message: 'Choose up to three available tags from the work category.', code: 'COMMUNITY_INVALID_TAGS', id: 'd08b3e71-c272-497c-b773-b410cb3a1e4e', httpStatusCode: 400 },
	tagConflict: { message: 'A tag with this name already exists in the category.', code: 'COMMUNITY_TAG_CONFLICT', id: '7609e615-cd7b-4a3b-8970-bb90fa92854a', httpStatusCode: 409 },
	tagNotFound: { message: 'No such available community tag.', code: 'COMMUNITY_TAG_NOT_FOUND', id: '2c52aa5a-b7d5-46bf-8076-7ac0ab3eb44d', httpStatusCode: 404 },
	sourceUnavailable: { message: 'The original work is unavailable for comments.', code: 'COMMUNITY_SOURCE_UNAVAILABLE', id: 'ea9bb5df-b981-4908-9777-5517f2dcce56', httpStatusCode: 400 },
	invalidFiles: { message: 'Invalid or unavailable community attachments.', code: 'COMMUNITY_INVALID_FILES', id: '6d79454d-1011-45fc-8580-3b9a86fb76fc', httpStatusCode: 400 },
	invalidContent: { message: 'Invalid community content.', code: 'COMMUNITY_INVALID_CONTENT', id: '3f9e490d-3f0d-47b0-aab3-b6a64a487a8e', httpStatusCode: 400 },
	authorUnavailable: { message: 'The author is unavailable.', code: 'COMMUNITY_AUTHOR_UNAVAILABLE', id: 'cd0c8e78-44e1-46ec-a898-632d195a03d2', httpStatusCode: 400 },
	cannotPublish: { message: 'The content cannot be published publicly.', code: 'COMMUNITY_CANNOT_PUBLISH', id: '99e25bc2-3c5d-4e8c-8eed-caca5f1473bb', httpStatusCode: 400 },
	notFound: { message: 'No such community submission.', code: 'COMMUNITY_NOT_FOUND', id: 'aedfe7ed-0d04-4ca7-8e19-408e7732dc8c', httpStatusCode: 404 },
	conflict: { message: 'The submission has changed or the idempotency key is in use.', code: 'COMMUNITY_CONFLICT', id: '34635dea-5dba-40d4-a409-43c473b7bec0', httpStatusCode: 409 },
	forbidden: { message: 'Moderator or owner authorization required.', code: 'COMMUNITY_FORBIDDEN', id: 'c3cde43b-5971-4209-9c36-7d2cc025b1fa', httpStatusCode: 403 },
} as const;

const string = { type: 'string', optional: false, nullable: false } as const;
export const sourceCommentStatusSchema = { type: 'string', optional: false, nullable: false, enum: ['none', 'pending', 'shared', 'unavailable'] } as const;
const nullableString = { ...string, nullable: true } as const;
export const communityTagSchema = {
	type: 'object', optional: false, nullable: false,
	properties: { id: string, category: { ...string, enum: ['video', 'image', 'resource'] }, name: string },
} as const;
export const communityTagIdsParam = { type: 'array', maxItems: 3, uniqueItems: true, items: { type: 'string', format: 'misskey:id' } } as const;
export const communityWorkSchema = {
	type: 'object', optional: false, nullable: false,
	properties: {
		destination: { ...string, enum: ['community', 'source-comment'] },
		sourceCommentStatus: sourceCommentStatusSchema,
		id: string, revisionPending: { type: 'boolean', optional: false, nullable: false }, version: { type: 'integer', optional: false, nullable: false },
		category: { ...string, enum: ['video', 'image', 'resource'] },
		tagIds: { type: 'array', optional: false, nullable: false, items: string },
		tags: { type: 'array', optional: false, nullable: false, items: communityTagSchema },
		title: string, text: string, model: string, sourceUrl: string, license: string,
		generation: { type: 'object', optional: false, nullable: true, properties: { prompt: string, model: string, referenceFileIds: { type: 'array', optional: false, nullable: false, items: string }, sourceWorkId: { ...string, optional: true }, shareToSource: { type: 'boolean', optional: true, nullable: false } } },
		referenceFiles: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, ref: 'DriveFile' } },
		files: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, ref: 'DriveFile' } },
		author: { type: 'object', optional: false, nullable: false, properties: { id: string, name: string, username: string } },
		status: { ...string, enum: ['pending', 'published', 'approved', 'rejected', 'removed', 'withdrawn'] },
		submittedAt: { ...string, format: 'date-time' }, rejectionReason: nullableString, approvedNoteId: nullableString,
		repliesCount: { type: 'integer', optional: false, nullable: false },
		likesCount: { type: 'integer', optional: false, nullable: false },
		renotesCount: { type: 'integer', optional: false, nullable: false },
		viewsCount: { type: 'integer', optional: false, nullable: false },
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
	tagIds: communityTagIdsParam,
} as const;
