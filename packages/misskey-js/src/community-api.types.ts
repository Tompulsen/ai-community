/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: MIT
 */

import type { Note } from './autogen/models.js';

/** Fork endpoints kept separate from upstream-generated SDK files. */
export type CommunityEndpoints = {
	'admin/community/notes': {
		req: {
			module: 'video' | 'image' | 'knowledge';
			limit?: number;
			sinceId?: string;
			untilId?: string;
		};
		res: Note[];
	};
};
