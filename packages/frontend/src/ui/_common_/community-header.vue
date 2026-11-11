<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<header :class="$style.header" data-testid="desktop-community-navigation">
	<div :class="$style.inner">
		<div :class="$style.primary">
			<MkA to="/community" :class="$style.brand" :aria-label="instance.name || i18n.ts._aiCommunity.title" :title="instance.name || i18n.ts._aiCommunity.title"><img :src="instance.iconUrl || '/favicon.ico'" alt=""/><span :class="$style.brandName">{{ instance.name || i18n.ts._aiCommunity.title }}</span></MkA>
			<nav :class="$style.navigation" :aria-label="ft.mobileNavigation">
				<MkA to="/community" :class="[$style.navItem, { [$style.current]: communityCurrent }]" :aria-current="communityCurrent ? 'page' : undefined">{{ ft.mobileAll }}</MkA>
				<button type="button" class="_button" :class="[$style.navItem, { [$style.current]: createCurrent }]" :aria-label="workbenchText.title" :title="workbenchText.title" aria-haspopup="menu" @click="createMenu">{{ ft.mobileCreate }}</button>
				<button type="button" class="_button" :class="[$style.navItem, { [$style.current]: pathname === '/community/mine' }]" :aria-label="ft.profileManage" :title="ft.profileManage" @click="accountPage('/community/mine')">{{ ft.profileWorks }}</button>
			</nav>
		</div>
		<form :class="$style.search" role="search" @submit.prevent="search">
			<button type="submit" class="_button" :aria-label="t.searchAction" :title="t.searchAction"><i class="ti ti-search" aria-hidden="true"></i></button>
			<input v-model="query" type="search" :aria-label="ft.search" :placeholder="t.searchPlaceholder" maxlength="200" data-testid="desktop-community-search"/>
		</form>
		<div :class="$style.actions">
			<button type="button" class="_button" :class="[$style.iconButton, { [$style.current]: pathname === '/my/favorites' }]" :aria-label="ft.profileFavorites" :title="ft.profileFavorites" @click="accountPage('/my/favorites')"><i class="ti ti-bookmark" aria-hidden="true"></i></button>
			<button type="button" class="_button" :class="[$style.iconButton, { [$style.current]: messagesCurrent }]" :aria-label="ft.mobileMessages" :title="ft.mobileMessages" @click="accountPage('/my/notifications')"><i class="ti ti-bell" aria-hidden="true"></i><span v-if="$i?.hasUnreadNotification" :class="$style.badge" :aria-label="String($i.unreadNotificationsCount)"></span></button>
			<button type="button" class="_button" :class="$style.iconButton" :aria-label="i18n.ts.more" :title="i18n.ts.more" aria-haspopup="menu" @click="more"><i class="ti ti-dots" aria-hidden="true"></i></button>
			<button type="button" class="_button _buttonPrimary" :class="$style.publish" :aria-label="t.publish" :title="t.publish" data-testid="desktop-publish" @click="publish"><i class="ti ti-plus" aria-hidden="true"></i><span>{{ t.publish }}</span></button>
			<button v-if="$i" type="button" class="_button" :class="$style.account" :aria-label="`${i18n.ts.account}: @${$i.username}`" :title="`${i18n.ts.account}: @${$i.username}`" aria-haspopup="menu" @click="accountMenu"><MkAvatar :user="$i" :class="$style.avatar"/><i class="ti ti-chevron-down" aria-hidden="true"></i></button>
			<button v-else type="button" class="_button" :class="$style.login" @click="login">{{ i18n.ts.login }}</button>
		</div>
	</div>
</header>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { feedText as ft } from '@/pages/community/feed-copy.js';
import { communityText as t } from '@/pages/community/copy.js';
import { requestCommunityComposer } from '@/pages/community/compose.js';
import { workbenchText } from '@/utility/creation-pages.js';
import { getAccountMenu } from '@/accounts.js';
import { getHTMLElementOrNull } from '@/utility/get-dom-node-or-null.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import { useRouter } from '@/router.js';
import * as os from '@/os.js';

const emit = defineEmits<{ (event: 'widgets'): void }>();
const router = useRouter();
const currentPath = ref(router.getCurrentFullPath());
const pathname = computed(() => currentPath.value.split(/[?#]/)[0].replace(/\/$/, ''));
const publicFeedPath = (path: string) => /^\/community(?:\/(?:all|video|image|resource|knowledge|text|code|skill))?$/.test(path);
const communityCurrent = computed(() => publicFeedPath(pathname.value) || pathname.value.startsWith('/community/work/'));
const createCurrent = computed(() => pathname.value.startsWith('/create/') || pathname.value === '/community/ai');
const messagesCurrent = computed(() => pathname.value === '/my/notifications' || /^\/chat(?:\/|$)/.test(pathname.value));
const routeQuery = () => publicFeedPath(pathname.value) ? new URL(currentPath.value, window.location.origin).searchParams.get('q') ?? '' : '';
const query = ref(routeQuery());
router.useListener('change', ({ fullPath }) => { currentPath.value = fullPath; query.value = routeQuery(); });

function search() {
	const target = new URL(publicFeedPath(pathname.value) ? currentPath.value : '/community', window.location.origin);
	const value = query.value.trim().slice(0, 200);
	if (value) target.searchParams.set('q', value);
	else target.searchParams.delete('q');
	router.pushByPath(target.pathname + target.search);
}

async function login() {
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkSigninDialog.vue').then(x => x.default), { autoSet: true }, { closed: () => dispose() });
}

async function signup() {
	if (instance.disableRegistration) return;
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkSignupDialog.vue').then(x => x.default), {}, { closed: () => dispose() });
}

function accountPage(path: string) { if ($i) router.pushByPath(path); else void login(); }

function publish() { if ($i) requestCommunityComposer(() => router.pushByPath('/community/compose')); else void login(); }

async function accountMenu(event: MouseEvent) {
	if (!$i) return;
	const target = event.currentTarget;
	const items = await getAccountMenu({ withExtraOperation: true });
	os.popupMenu([{ type: 'link', text: ft.ownProfile, icon: 'ti ti-user', to: `/@${$i.username}` }, { type: 'link', text: i18n.ts.settings, icon: 'ti ti-settings', to: '/settings' }, { type: 'divider' }, ...items], target);
}

function createMenu(event: MouseEvent) {
	os.popupMenu([
		{ type: 'link', text: ft.makeVideo, icon: 'ti ti-video', to: '/create/video' },
		{ type: 'link', text: ft.makeImage, icon: 'ti ti-photo', to: '/create/image' },
		{ type: 'link', text: ft.makeText, icon: 'ti ti-file-text', to: '/create/text' },
	], event.currentTarget);
}

async function launchTools(target: HTMLElement) {
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkLaunchPad.vue').then(x => x.default), { anchorElement: target, includePinned: true }, { closed: () => dispose() });
}

function more(event: MouseEvent) {
	const target = getHTMLElementOrNull(event.currentTarget);
	if (!target) return;
	os.popupMenu([
		{ type: 'link', text: ft.mobileHome, icon: 'ti ti-home', to: '/' },
		...($i ? [
			{ type: 'link' as const, text: ft.ownProfile, icon: 'ti ti-user', to: `/@${$i.username}` },
			{ type: 'link' as const, text: i18n.ts.timeline, icon: 'ti ti-messages', to: '/timeline' },
			...($i.isAdmin || $i.isModerator ? [
				{ type: 'link' as const, text: t.review, icon: 'ti ti-shield-check', to: '/community/review' },
				{ type: 'link' as const, text: i18n.ts.controlPanel, icon: 'ti ti-dashboard', to: '/admin' },
			] : []),
			{ type: 'link' as const, text: i18n.ts.settings, icon: 'ti ti-settings', to: '/settings' },
			{ text: i18n.ts.widgets, icon: 'ti ti-apps', action: () => emit('widgets') },
			{ text: workbenchText.tools, icon: 'ti ti-grid-dots', action: () => launchTools(target) },
		] : [
			{ text: i18n.ts.settings, icon: 'ti ti-settings', action: () => accountPage('/settings') },
			{ text: i18n.ts.login, icon: 'ti ti-login', action: login },
			...(!instance.disableRegistration ? [{ text: i18n.ts.signup, icon: 'ti ti-user-plus', action: signup }] : []),
		]),
	], target);
}
</script>

<style lang="scss" module>
.header { flex: 0 0 auto; z-index: 32; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); }
.inner { display: grid; grid-template-columns: repeat(var(--community-grid-columns), minmax(0, 1fr)); align-items: center; gap: var(--community-grid-gap); min-height: 72px; padding: 12px var(--community-grid-margin); box-sizing: border-box; border-bottom: 1px solid var(--MI_THEME-divider); }
.header :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: -3px; }
.primary { grid-column: 1 / span 4; display: flex; align-items: center; gap: 16px; min-width: 0; }
.brand { display: flex; align-items: center; gap: 8px; min-width: 30px; color: inherit; text-decoration: none; img { flex: 0 0 30px; width: 30px; height: 30px; border-radius: var(--community-radius-small); } }
.brandName { min-width: 0; max-width: 14em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; font-weight: 650; }
.navigation { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.navItem { position: relative; display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 8px 12px; border-radius: var(--community-radius-small); color: inherit; text-decoration: none; white-space: nowrap; }
.navItem.current { color: var(--MI_THEME-accent); font-weight: 600; &::after { content: ''; position: absolute; inset-inline: 12px; bottom: 0; height: 2px; background: currentColor; } }
.actions { grid-column: 8 / span 3; display: flex; align-items: center; justify-content: flex-end; gap: 4px; min-width: 0; }
.iconButton { position: relative; display: grid; place-items: center; flex: 0 0 44px; width: 44px; height: 44px; border-radius: var(--community-radius-small); color: inherit; i { font-size: 20px; } }
.iconButton.current { background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); }
.publish { display: inline-flex; align-items: center; justify-content: center; gap: 8px; flex: 0 0 auto; min-width: 44px; min-height: 44px; padding: 8px 12px; border-radius: var(--community-radius-small); font-size: 13px; font-weight: 600; white-space: nowrap; i { font-size: 20px; } }
.badge { position: absolute; top: 7px; right: 7px; width: 6px; height: 6px; border: 2px solid var(--MI_THEME-panel); border-radius: 50%; background: var(--MI_THEME-accent); }
.search { grid-column: 5 / span 3; display: flex; align-items: center; min-width: 0; height: 44px; border-radius: var(--community-radius-small); background: var(--MI_THEME-buttonBg); &:focus-within { outline: 2px solid var(--MI_THEME-accent); outline-offset: -2px; } input { flex: 1; width: 100%; min-width: 0; height: 44px; padding: 0 14px 0 0; background: transparent; border: 0; outline: 0; font: inherit; font-size: 14px; color: inherit; &::placeholder { color: color-mix(in srgb, var(--MI_THEME-fg) 72%, var(--MI_THEME-panel)); opacity: 1; } } button { display: grid; place-items: center; flex: 0 0 44px; height: 44px; font-size: 20px; border-radius: var(--community-radius-small); } }
.account, .login { display: flex; align-items: center; justify-content: center; flex: 0 0 auto; gap: 6px; min-width: 44px; min-height: 44px; border-radius: 12px; color: inherit; font-size: 13px; }
.login { padding-inline: 12px; font-weight: 600; }
.avatar { width: 30px; height: 30px; }
@media (hover: hover) { .iconButton:hover, .navItem:hover, .login:hover, .account:hover { background: var(--MI_THEME-buttonHoverBg); } }
@media (max-width: 1399px) { .brandName { display: none; } .publish span { display: none; } }
@media (max-width: 1199px) {
	.inner { grid-template-columns: minmax(0, 1fr) auto; row-gap: 8px; }
	.primary { grid-column: 1; }
	.actions { grid-column: 2; }
	.search { grid-column: 1 / -1; grid-row: 2; }
}
@media (max-width: 700px) { .primary { gap: 8px; } .navItem { padding-inline: 8px; font-size: 12px; } .actions { gap: 0; } }
</style>
