/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { apiUrl } from '@@/js/config.js';
import { createCommunityGateway } from './api.js';
import type { CommunityFile } from './types.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';

/** The same authenticated uploads and file picker on the feed and the author's profile. */
export function createBrowserCommunityGateway() {
	return createCommunityGateway({
		apiUrl,
		getToken: () => $i?.token,
		uploadFiles: files => new Promise<CommunityFile[]>((resolve, reject) => {
			let dispose: (() => void) | undefined;
			let uploaded: CommunityFile[] = [];
			os.popupAsyncWithDialog(import('@/components/MkUploaderDialog.vue').then(module => module.default), { files, multiple: true }, {
				done: selected => { uploaded = selected ?? []; },
				closed: () => { dispose?.(); resolve(uploaded); },
			}).then(dialog => { dispose = dialog.dispose; }, reject);
		}),
		chooseFiles: () => new Promise<CommunityFile[]>((resolve, reject) => {
			let dispose: (() => void) | undefined;
			let selection: CommunityFile[] = [];
			os.popupAsyncWithDialog(import('@/components/MkDriveFileSelectDialog.vue').then(module => module.default), { multiple: true }, {
				done: selected => { selection = selected ?? []; },
				closed: () => { dispose?.(); resolve(selection); },
			}).then(dialog => { dispose = dialog.dispose; }, reject);
		}),
	});
}
