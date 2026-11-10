<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<header :class="$style.header" :data-motion="prefer.s.animation" data-testid="desktop-community-navigation">
	<div :class="$style.inner">
		<MkA to="/community" :class="$style.brand"><img :src="instance.iconUrl || '/favicon.ico'" alt=""/><span>{{ i18n.ts._aiCommunity.title }}</span></MkA>
		<nav :class="$style.navigation" :aria-label="ft.mobileNavigation">
			<MkA to="/community" :class="{ [$style.current]: communityCurrent }" :aria-current="communityCurrent ? 'page' : undefined"><i class="ti ti-compass" aria-hidden="true"></i>{{ ft.mobileAll }}</MkA>
			<MkA to="/create/text" :class="{ [$style.current]: createCurrent }" :aria-current="createCurrent ? 'page' : undefined"><i class="ti ti-sparkles" aria-hidden="true"></i>{{ workbenchText.title }}</MkA>
		</nav>
		<form :class="$style.search" role="search" @submit.prevent="search">
			<input v-model="query" type="search" :aria-label="ft.search" :placeholder="t.searchPlaceholder" maxlength="200" data-testid="desktop-community-search"/>
			<button type="submit" class="_button" :aria-label="t.searchAction" :title="t.searchAction"><i class="ti ti-search" aria-hidden="true"></i></button>
		</form>
		<div :class="$style.actions">
			<button type="button" class="_button" :class="[$style.utility, { [$style.current]: pathname === '/my/favorites' }]" :aria-label="ft.profileFavorites" :title="ft.profileFavorites" @click="accountPage('/my/favorites')"><i class="ti ti-bookmark" aria-hidden="true"></i><span>{{ ft.profileFavorites }}</span></button>
			<button type="button" class="_button" :class="[$style.utility, { [$style.current]: messagesCurrent }]" :aria-label="ft.mobileMessages" :title="ft.mobileMessages" @click="accountPage('/my/notifications')"><i class="ti ti-bell" aria-hidden="true"></i><span>{{ ft.mobileMessages }}</span><b v-if="$i?.hasUnreadNotification" :class="$style.badge">{{ $i.unreadNotificationsCount > 99 ? '99+' : $i.unreadNotificationsCount }}</b></button>
			<button type="button" class="_button" :class="[$style.utility, { [$style.current]: pathname === '/community/mine' }]" :aria-label="ft.profileManage" :title="ft.profileManage" @click="accountPage('/community/mine')"><i class="ti ti-folders" aria-hidden="true"></i><span>{{ ft.profileManage }}</span></button>
			<button type="button" class="_button" :class="$style.utility" :aria-label="i18n.ts.more" :title="i18n.ts.more" aria-haspopup="menu" @click="more"><i class="ti ti-dots" aria-hidden="true"></i></button>
			<button type="button" class="_button" :class="$style.publish" data-testid="desktop-publish" @click="publish"><i class="ti ti-plus" aria-hidden="true"></i>{{ t.publish }}</button>
			<button v-if="$i" type="button" class="_button" :class="$style.account" :aria-label="`${i18n.ts.account}: @${$i.username}`" :title="`${i18n.ts.account}: @${$i.username}`" aria-haspopup="menu" @click="accountMenu"><MkAvatar :user="$i" :class="$style.avatar"/></button>
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
import { prefer } from '@/preferences.js';
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
			{ text: i18n.ts.login, icon: 'ti ti-login', action: login },
			...(!instance.disableRegistration ? [{ text: i18n.ts.signup, icon: 'ti ti-user-plus', action: signup }] : []),
		]),
	], target);
}
</script>

<style lang="scss" module>
.header { flex: 0 0 auto; z-index: 32; background: var(--MI_THEME-navBg); color: var(--MI_THEME-navFg); border-bottom: 1px solid var(--MI_THEME-divider); }
.inner { display: flex; align-items: center; gap: clamp(12px, 1.6vw, 28px); min-height: 72px; max-width: 1960px; margin-inline: auto; padding: 10px clamp(20px, 3vw, 56px); box-sizing: border-box; }
.header :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: -3px; }
.brand { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; min-height: 44px; color: inherit; text-decoration: none; font-size: 18px; font-weight: 750; letter-spacing: -.03em; img { width: 32px; height: 32px; border-radius: 9px; } }
.navigation { display: flex; align-items: center; flex: 0 0 auto; gap: 4px; a { display: flex; align-items: center; gap: 7px; min-height: 44px; padding: 0 10px; border-radius: 8px; color: inherit; text-decoration: none; font-size: 14px; white-space: nowrap; } i { font-size: 19px; } }
.header .current { color: var(--MI_THEME-accent); font-weight: 650; }
.navigation .current { background: var(--MI_THEME-accentedBg); }
.search { display: flex; align-items: center; flex: 1; min-width: 140px; max-width: 580px; height: 44px; margin-inline: auto; border: 1px solid var(--MI_THEME-divider); border-radius: 10px; background: var(--MI_THEME-buttonBg); &:focus-within { border-color: var(--MI_THEME-accent); background: var(--MI_THEME-panel); } input { width: 100%; min-width: 0; padding: 10px 0 10px 14px; background: transparent; border: 0; outline: 0; font: inherit; font-size: 14px; color: var(--MI_THEME-fg); &::placeholder { color: var(--MI_THEME-fgTransparentWeak); opacity: 1; } } button { display: grid; place-items: center; flex: 0 0 44px; height: 44px; font-size: 21px; color: var(--MI_THEME-fg); border-radius: 8px; } }
.actions { display: flex; align-items: center; flex: 0 0 auto; gap: 8px; }
.utility { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-width: 44px; height: 48px; padding: 0 5px; border-radius: 8px; font-size: 11px; color: inherit; white-space: nowrap; i { font-size: 21px; } }
.badge { position: absolute; top: 0; left: 55%; min-width: 14px; padding: 1px 4px; border-radius: 12px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-size: 10px; line-height: 14px; }
.publish { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 42px; padding: 0 16px; border-radius: 8px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-size: 14px; font-weight: 600; white-space: nowrap; transition: transform 160ms ease; i { font-size: 20px; } &:active { transform: scale(.97); } }
.account, .login { display: grid; place-items: center; min-width: 44px; min-height: 44px; border-radius: 8px; color: inherit; font-size: 13px; }
.avatar { width: 32px; height: 32px; }
@media (hover: hover) { .utility:hover, .login:hover, .account:hover, .navigation a:hover { background: var(--MI_THEME-buttonHoverBg); } .publish:hover { filter: brightness(.95); } }
@media (max-width: 1279px) { .inner { gap: 12px; } .utility span { display: none; } .actions { gap: 2px; } .brand { font-size: 16px; gap: 8px; } .navigation a { padding-inline: 8px; } }
@media (max-width: 1000px) { .inner { flex-wrap: wrap; gap: 6px 12px; padding: 8px 20px 12px; } .search { order: 4; flex-basis: 100%; max-width: none; } .actions { margin-left: auto; } .navigation { gap: 0; } .brand span { display: none; } }
.header[data-motion='false'] .publish { transition: none; }
@media (prefers-reduced-motion: reduce) { .publish { transition: none; } }
</style>
