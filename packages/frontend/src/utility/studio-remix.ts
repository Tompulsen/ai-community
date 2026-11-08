/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
export type StudioRemix = { requestId: string; sourceWorkId: string; kind: 'text' | 'image' | 'video'; prompt: string; model: string; references: { url: string; name: string }[] };
