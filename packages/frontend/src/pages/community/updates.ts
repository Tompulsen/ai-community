/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readonly, shallowRef } from 'vue';

// Cached routes refresh when revisited; an active route also sees late mutation responses.
const updateVersion = shallowRef(0);
export const communityUpdates = readonly(updateVersion);
export const getCommunityUpdateVersion = () => updateVersion.value;
export const markCommunityUpdated = () => { updateVersion.value++; };
