/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type AiCommunityConfig = Record<'video' | 'image' | 'knowledge', string | null>;

/** Only public channel IDs cross this boundary; never return the source object. */
export function parseAiCommunityConfig(value: unknown): AiCommunityConfig {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Invalid AI community configuration');
	}
	const source = value as Record<string, unknown>;
	const result: AiCommunityConfig = { video: null, image: null, knowledge: null };
	const ids = new Set<string>();
	for (const key of ['video', 'image', 'knowledge'] as const) {
		const id = source[key];
		if (id == null || id === '') continue;
		if (typeof id !== 'string' || !/^[a-zA-Z0-9]{1,64}$/.test(id) || ids.has(id)) {
			throw new Error(`Invalid or duplicate AI community channel: ${key}`);
		}
		ids.add(id);
		result[key] = id;
	}
	return result;
}

export async function loadAiCommunityConfig(rootDir: string): Promise<AiCommunityConfig> {
	try {
		const raw = await readFile(resolve(rootDir, '.config/ai-community.json'), 'utf8');
		return parseAiCommunityConfig(JSON.parse(raw));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return { video: null, image: null, knowledge: null };
		}
		throw error;
	}
}
