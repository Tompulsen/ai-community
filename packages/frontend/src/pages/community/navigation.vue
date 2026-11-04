<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<nav :class="$style.root" :aria-label="t.community">
	<MkA to="/" :class="$style.brand">{{ t.brand }}</MkA>
	<p :class="$style.label">{{ t.community }}</p>
	<MkA v-for="entry in communitySections" :key="entry.id" :to="entry.path" :class="[$style.item, $style.communityItem]" :activeClass="$style.active"><i :class="entry.icon" aria-hidden="true"></i><span>{{ entry.title }}</span></MkA>
	<p :class="$style.label">{{ t.workspace }}</p>
	<MkA to="/community/profile" :class="$style.item" :activeClass="$style.active"><i class="ti ti-folders" aria-hidden="true"></i><span>{{ t.profile }}</span></MkA>
	<MkA to="/community/mine" :class="$style.item" :activeClass="$style.active"><i class="ti ti-folders" aria-hidden="true"></i><span>{{ t.mine }}</span></MkA>
	<MkA to="/community/ai" :class="$style.item" :activeClass="$style.active"><i class="ti ti-sparkles" aria-hidden="true"></i><span>{{ t.ai }}</span></MkA>
	<MkA to="/community/compose" :class="$style.publish">{{ t.publish }}</MkA>
	<p :class="$style.note">{{ t.moderationHint }}</p>
</nav>
</template>

<script setup lang="ts">
import { communitySections, communityText as t } from './copy.js';
</script>

<style lang="scss" module>
.root { width: 250px; flex-shrink: 0; padding: 28px 16px; color: var(--MI_THEME-fg); background: var(--MI_THEME-panel); overflow-y: auto; box-sizing: border-box; }
.brand { display: block; padding: 0 12px 28px; font-weight: 700; font-size: 18px; }
.label { font-size: 12px; padding: 0 12px; margin: 26px 0 10px; color: var(--MI_THEME-fg); }
.item { display: flex; align-items: center; gap: 12px; padding: 14px 12px; font-size: 17px; border-radius: 999px; margin-block: 4px; }
.item:hover { background: var(--MI_THEME-buttonBg); }
.item i { font-size: 23px; }
.publish { display: flex; align-items: center; justify-content: center; min-height: 48px; margin: 24px 10px; border-radius: 999px; background: var(--MI_THEME-fg); color: var(--MI_THEME-panel); font-weight: 700; }
.active { font-weight: 700; }
.item:focus-visible, .brand:focus-visible, .publish:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 2px; }
.note { font-size: 12px; padding: 12px; margin-top: 28px; line-height: 1.7; color: var(--MI_THEME-fg); }
@media (max-width: 700px) { .root { width: 100%; padding: 8px 16px; display: flex; gap: 4px; align-items: center; overflow: visible; border: 0; } .label, .note, .publish, .communityItem { display: none; } .brand { display: block; margin-right: auto; padding: 0; font-size: 14px; white-space: nowrap; } .item { flex-shrink: 0; justify-content: center; padding: 8px 4px; min-height: 44px; box-sizing: border-box; font-size: 12px; gap: 4px; margin: 0; } .item i { display: none; } .publish { display: flex; position: fixed; right: 16px; bottom: max(16px, env(safe-area-inset-bottom)); z-index: 5; margin: 0; padding: 10px 20px; } }
</style>
