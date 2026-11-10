/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { CommunityWork } from '@/pages/community/types.js';
import { safeWebUrl } from '@/pages/community/copy.js';

/** Only explicitly saved reference images belong in a remix. */
export function remixReferenceFiles(work: Pick<CommunityWork, 'referenceFiles'>) {
	return (work.referenceFiles ?? []).filter(file => file.type.startsWith('image/') && safeWebUrl(file.url));
}

export type StudioRemix = { requestId: string; sourceWorkId: string; kind: 'text' | 'image' | 'video'; prompt: string; model: string; references: { url: string; name: string }[] };

/** postMessage cannot clone Vue proxies; copy only the public transfer fields. */
export function serializeStudioRemix(work: StudioRemix): StudioRemix {
	return {
		requestId: work.requestId,
		sourceWorkId: work.sourceWorkId,
		kind: work.kind,
		prompt: work.prompt,
		model: work.model,
		references: work.references.map(file => ({ url: file.url, name: file.name })),
	};
}
