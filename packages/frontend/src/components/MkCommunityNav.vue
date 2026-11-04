<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<nav :class="[$style.root, { [$style.compact]: compact, [$style.horizontal]: horizontal }]" :aria-label="i18n.ts._aiCommunity.navigation">
	<MkA v-for="item in communityModules" :key="item.key" :to="`/community/${item.key}`" :class="[$style.link, { [$style.active]: activeModule === item.key }]" :aria-current="activeModule === item.key ? 'page' : undefined" :title="item.title" :aria-label="item.title">
		<i :class="item.icon" aria-hidden="true"></i><span :class="$style.label">{{ item.title }}</span>
	</MkA>
</nav>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { useRouter } from '@/router.js';
import { i18n } from '@/i18n.js';
import { communityModules } from '@/utility/ai-community.js';

const router = useRouter();
const activeModule = computed(() => {
	const current = router.currentRef.value;
	return current.route.path === '/' ? 'video' : current.route.path === '/community/:module' ? current.props.get('module') : null;
});

defineProps<{
	compact?: boolean;
	horizontal?: boolean;
}>();
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 12px;
	direction: ltr;
}
.link {
	display: flex;
	align-items: center;
	gap: 12px;
	min-height: 50px;
	padding: 8px 12px;
	box-sizing: border-box;
	border-radius: 999px;
	color: var(--MI_THEME-fg);
	font-size: 17px;
	line-height: 1.5;
	text-decoration: none;
	transition: background-color 150ms ease;
	> i { flex-shrink: 0; font-size: 23px; }
	&:hover { background: var(--MI_THEME-buttonHoverBg); }
	&:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
}
.active { color: var(--MI_THEME-fgHighlighted); font-weight: 700; }
.label { overflow-wrap: anywhere; }
.compact {
	.link { justify-content: center; padding: 12px; }
	.label { display: none; }
}
.horizontal { flex-direction: row; flex-wrap: wrap; padding: 0; }
.horizontal .link { font-size: 14px; min-height: 44px; }
.horizontal.compact .link { height: 44px; padding: 8px 12px; }
@media (prefers-reduced-motion: reduce) { .link { transition: none; } }
</style>
