/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { StoryObj } from '@storybook/vue3';
import MkCommunityNav from './MkCommunityNav.vue';

export const Default = { args: { compact: false, horizontal: false } } satisfies StoryObj<typeof MkCommunityNav>;
export const Compact = { args: { compact: true, horizontal: false } } satisfies StoryObj<typeof MkCommunityNav>;
export const Horizontal = { args: { compact: true, horizontal: true } } satisfies StoryObj<typeof MkCommunityNav>;
