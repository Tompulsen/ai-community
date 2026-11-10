/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { emojiRegex } from '@/misc/emoji-regex.js';

export const communityMutualFollowMessage = '你们已互相关注，可以私信分享社区作品和内置表情。 / You now follow each other. Share community works and built-in emoji in private messages.';

export const communityChatErrors = {
	mutualRequired: { message: 'Private messages require mutual following between available local users.', code: 'COMMUNITY_CHAT_MUTUAL_REQUIRED', id: 'e7c8a1d3-2a3a-4851-a558-b7bd0b978d20', kind: 'permission', httpStatusCode: 403 },
	contentRestricted: { message: 'Only community works and built-in emoji can be sent.', code: 'COMMUNITY_CHAT_CONTENT_RESTRICTED', id: '527499af-ce92-4d47-a125-4497c19825eb' },
	workUnavailable: { message: 'This community work is unavailable to one of the participants.', code: 'COMMUNITY_CHAT_WORK_UNAVAILABLE', id: '27cf094a-e41b-4936-aefb-916a445b62bd' },
	privateOnly: { message: 'Community messages support mutual one-to-one conversations. Existing groups are read-only.', code: 'COMMUNITY_CHAT_PRIVATE_ONLY', id: 'caaf5622-ac13-430b-a7d4-262ab835cdb7', kind: 'permission', httpStatusCode: 403 },
	directNotesDisabled: { message: 'Use mutual private messages to share community works and built-in emoji.', code: 'COMMUNITY_DIRECT_NOTES_DISABLED', id: '11bdd8b8-7d48-4bf3-9973-94d7a6e206b5' },
} as const;

/** Exact representations only: no captions, URL aliases, remote emoji, or attachments. */
export function parseCommunityChatContent(text: string | null | undefined, siteUrl: string) {
	if (!text || text !== text.trim()) return null;
	const prefix = `${siteUrl.replace(/\/$/, '')}/community/work/`;
	if (text.startsWith(prefix)) {
		const id = text.slice(prefix.length);
		return /^[a-zA-Z0-9]{1,32}$/.test(id) ? { type: 'work' as const, id, text } : null;
	}
	const custom = /^:([\w+-]+):$/.exec(text);
	if (custom) return { type: 'customEmoji' as const, name: custom[1], text };
	if (emojiRegex.exec(text)?.[0] === text) return { type: 'emoji' as const, text };
	return null;
}
