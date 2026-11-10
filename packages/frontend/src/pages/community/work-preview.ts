/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { safeWebUrl } from './copy.js';
import type { CommunityWork } from './types.js';
import { getType, isPreviewable } from '@/utility/lightbox.js';
import * as os from '@/os.js';

export async function openWorkMedia(work: CommunityWork, id: string, revealed: string[] = []) {
	const group = work.files.some(file => file.id === id) ? work.files : work.referenceFiles ?? [];
	const files = group.filter((file, index, all) => all.findIndex(other => other.id === file.id) === index && safeWebUrl(file.url) && (!file.isSensitive || revealed.includes(file.id)));
	const selected = files.find(file => file.id === id);
	if (!selected) return;
	if (!isPreviewable(selected.type)) { window.open(safeWebUrl(selected.url), '_blank', 'noopener,noreferrer'); return; }
	const contents = files.filter(file => isPreviewable(file.type)).map(file => ({ id: file.id, type: getType(file.type), url: safeWebUrl(file.url)!, thumbnailUrl: safeWebUrl(file.thumbnailUrl), filename: file.name }));
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkLightbox.vue').then(x => x.default), { contents, defaultIndex: contents.findIndex(file => file.id === id) }, { closed: () => dispose() });
}
