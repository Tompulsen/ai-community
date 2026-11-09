<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="tags?.length" :class="$style.tags" :aria-label="t.tags" data-testid="work-tags">
	<MkA v-for="tag in tags" :key="tag.id" :to="tagSearchPath(tag)"># {{ tag.name }}</MkA>
</div>
</template>

<script setup lang="ts">
import type { CommunityTag } from './types.js';
import { tagSearchPath } from './work-tags.js';
import { tagText as t } from './tag-copy.js';

defineProps<{ tags?: CommunityTag[] }>();
</script>

<style lang="scss" module>
.tags { display: flex; flex-wrap: wrap; align-items: center; gap: 0 14px; margin: -2px 0 10px; font-size: 12px; }
.tags a { display: inline-flex; align-items: center; min-height: 44px; max-width: 100%; color: var(--MI_THEME-accent); overflow-wrap: anywhere; text-decoration: none; text-underline-offset: 3px; }
.tags a:hover { text-decoration: underline; }
.tags a:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 2px; border-radius: 3px; }
</style>
