/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { entities } from 'misskey-js';
import { defineAsyncComponent } from 'vue';
import { url } from '@@/js/config.js';
import { chatText as t } from './copy.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import * as os from '@/os.js';

export function canPrivateMessage(user: entities.UserDetailed, meId: string) {
	return user.id !== meId && user.host === null && user.isFollowing === true && user.isFollowed === true &&
		!user.isBlocking && !user.isBlocked && !user.isSuspended && !user.movedTo && user.canChat;
}

export function communityWorkMessage(id: string) {
	return `${url}/community/work/${id}`;
}

export function sharedCommunityWorkId(text: string | null | undefined) {
	const prefix = `${url}/community/work/`;
	const id = text?.startsWith(prefix) ? text.slice(prefix.length) : '';
	return /^[a-zA-Z0-9]{1,32}$/.test(id) ? id : null;
}

export function privateMessageError(error: unknown) {
	const code = (error as { code?: string } | null)?.code;
	return code === 'COMMUNITY_CHAT_MUTUAL_REQUIRED' ? t.mutualRequired :
		code === 'COMMUNITY_CHAT_CONTENT_RESTRICTED' ? t.rules :
		code === 'COMMUNITY_CHAT_WORK_UNAVAILABLE' || code === 'COMMUNITY_NOT_FOUND' ? t.workUnavailable : t.sendFailed;
}

export async function selectPrivateMessageUser(meId: string) {
	const selected = await new Promise<entities.UserDetailed | null>(resolve => {
		const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkUserSelectDialog.vue')), { localOnly: true, includeSelf: false }, {
			ok: user => resolve(user),
			cancel: () => resolve(null),
			closed: () => { resolve(null); dispose(); },
		});
	});
	if (!selected) return null;
	const user = await misskeyApi('users/show', { userId: selected.id });
	if (!canPrivateMessage(user, meId)) {
		await os.alert({ type: 'info', text: t.mutualRequired });
		return null;
	}
	return user;
}
