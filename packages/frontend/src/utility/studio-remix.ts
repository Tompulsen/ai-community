/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
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
