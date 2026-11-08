<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<nav :class="[$style.root, { [$style.compact]: compact, [$style.horizontal]: horizontal }]" :aria-label="i18n.ts._aiCommunity.navigation" :data-motion="prefer.s.animation" data-testid="community-navigation">
	<MkA v-for="item in navigationItems" :key="item.key" :to="item.to" :class="[$style.link, { [$style.active]: activeItem === item.key }]" :aria-current="activeItem === item.key ? 'page' : undefined" :title="item.title" :aria-label="item.title">
		<i :class="item.icon" aria-hidden="true"></i><span :class="$style.label">{{ item.title }}</span>
	</MkA>
</nav>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { useRouter } from '@/router.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { creationText, creationPages } from '@/utility/creation-pages.js';

const router = useRouter();
const navigationItems = [
	{ key: 'community', title: creationText.community, icon: 'ti ti-users', to: '/community' },
	...creationPages.map(item => ({ ...item, to: `/create/${item.key}` })),
];
const activeItem = computed(() => {
	const current = router.currentRef.value;
	if (current.route.path === '/community') return 'community';
	if (current.route.path === '/community/:module' && ['video', 'image', 'resource', 'text', 'code', 'skill', 'knowledge'].includes(String(current.props.get('module')))) return 'community';
	return current.route.path === '/create/:kind' ? current.props.get('kind') : null;
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
	min-height: 46px;
	padding: 8px 12px;
	box-sizing: border-box;
	border-radius: var(--community-radius-small, 8px);
	color: var(--MI_THEME-fg);
	font-size: 14px;
	line-height: 1.5;
	text-decoration: none;
	position: relative;
	transition: background-color 180ms ease, color 180ms ease;
	> i { flex-shrink: 0; font-size: 20px; transition: transform 280ms var(--community-ease, ease-out); }
	> span { transition: transform 280ms var(--community-ease, ease-out); }
	&:hover, &:focus-visible { background: var(--MI_THEME-buttonHoverBg); > i { transform: translateY(-2px) rotate(-7deg); } > span { transform: translateX(3px); } }
	&:active { > i, > span { transform: translateY(1px); } }
	&:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
}
.active { color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); font-weight: 650; }
.label { overflow-wrap: anywhere; }
.compact {
	.link { justify-content: center; padding: 12px; }
	.label { display: none; }
}
.horizontal { flex-direction: row; flex-wrap: wrap; padding: 0; }
.horizontal .link { font-size: 14px; min-height: 44px; }
@media (max-width: 700px) {
	.horizontal { flex-wrap: nowrap; gap: 4px; }
	.horizontal .link { flex: 1; min-width: 0; flex-direction: column; justify-content: flex-start; gap: 4px; padding: 8px 2px; font-size: 12px; text-align: center; }
	.horizontal .link > i { line-height: 1; }
	.horizontal .label { line-height: 1.4; }
}
.horizontal.compact .link { height: 44px; padding: 8px 12px; }
.root[data-motion='false'] .link, .root[data-motion='false'] .link > * { transition: none; transform: none; }
@media (prefers-reduced-motion: reduce) { .link, .link > * { transition: none; transform: none !important; } }
</style>
