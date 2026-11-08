/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { shallowReactive } from 'vue';
import type { Router } from '@/router.js';

const returnPaths = new WeakMap<Router, Map<string, string>>();
const feedPaths = new Set(['/community', ...['all', 'video', 'image', 'knowledge', 'resource', 'text', 'code', 'skill'].map(section => `/community/${section}`)]);

function pathsFor(router: Router): Map<string, string> {
	let paths = returnPaths.get(router);
	if (!paths) {
		paths = shallowReactive(new Map<string, string>());
		returnPaths.set(router, paths);
	}
	return paths;
}

export function rememberCommunityWorkReturnPath(router: Router, beforeFullPath: string, fullPath: string): void {
	if (!feedPaths.has(beforeFullPath.split(/[?#]/, 1)[0])) return;
	const work = /^\/community\/work\/([^/?#]+)(?:[?#]|$)/.exec(fullPath);
	if (!work) return;
	const paths = pathsFor(router);
	paths.delete(work[1]);
	paths.set(work[1], beforeFullPath);
	// Keep navigation context bounded independently of the page cache preference.
	if (paths.size > 50) paths.delete(paths.keys().next().value!);
}

export function getCommunityWorkReturnPath(router: Router, submissionId: string): string | undefined {
	return pathsFor(router).get(submissionId);
}
