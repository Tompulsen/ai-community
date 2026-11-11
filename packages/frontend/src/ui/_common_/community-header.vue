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
				<button type="button" class="_button" :class="[$style.navItem, { [$style.current]: pathname === '/community/mine' }]" @click="accountPage('/community/mine')">{{ ft.myWorks }}</button>
				<MkA to="/community/lottery" :class="[$style.navItem, { [$style.current]: pathname === '/community/lottery' }]" :aria-current="pathname === '/community/lottery' ? 'page' : undefined">{{ ft.activity }}</MkA>
				<button type="button" class="_button" :class="[$style.navItem, { [$style.current]: communityMenuCurrent }]" aria-haspopup="menu" data-testid="community-menu" @click="communityMenu">{{ ft.community }}<i class="ti ti-chevron-down" aria-hidden="true"></i></button>
			</nav>
		</div>
		<div :class="$style.actions">
			<button type="button" class="_button _buttonPrimary" :class="$style.publish" :aria-label="t.publish" :title="t.publish" data-testid="desktop-publish" @click="publish"><i class="ti ti-plus" aria-hidden="true"></i><span>{{ t.publish }}</span></button>
			<button type="button" class="_button" :class="[$style.iconButton, { [$style.current]: messagesCurrent }]" :aria-label="ft.mobileMessages" :title="ft.mobileMessages" @click="accountPage('/my/notifications')"><i class="ti ti-bell" aria-hidden="true"></i><span v-if="$i?.hasUnreadNotification" :class="$style.badge" :aria-label="String($i.unreadNotificationsCount)"></span></button>
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
const communityMenuCurrent = computed(() => /^\/(?:announcements|explore|timeline)(?:\/|$)/.test(pathname.value));
router.useListener('change', ({ fullPath }) => { currentPath.value = fullPath; });

async function login() {
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkSigninDialog.vue').then(x => x.default), { autoSet: true }, { closed: () => dispose() });
}

function accountPage(path: string) { if ($i) router.pushByPath(path); else void login(); }

function publish() { if ($i) requestCommunityComposer(() => router.pushByPath('/community/compose')); else void login(); }

async function accountMenu(event: MouseEvent) {
	if (!$i) return;
	const target = event.currentTarget;
	const items = await getAccountMenu({ withExtraOperation: true });
	os.popupMenu([
		...items,
		{ type: 'divider' },
		{ type: 'link', text: ft.profileFavorites, icon: 'ti ti-bookmark', to: '/my/favorites' },
		{ type: 'link', text: i18n.ts.settings, icon: 'ti ti-settings', to: '/settings' },
		...($i.isAdmin || $i.isModerator ? [
			{ type: 'divider' as const },
			{ type: 'label' as const, text: ft.management },
			{ type: 'link' as const, text: t.review, icon: 'ti ti-shield-check', to: '/community/review' },
			{ type: 'link' as const, text: i18n.ts.controlPanel, icon: 'ti ti-dashboard', to: '/admin' },
		] : []),
	], target);
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

function communityMenu(event: MouseEvent) {
	const target = event.currentTarget;
	if (!(target instanceof HTMLElement)) return;
	const discoveryPath = new URL(publicFeedPath(pathname.value) ? currentPath.value : '/community', window.location.origin);
	discoveryPath.searchParams.set('panel', 'community');
	os.popupMenu([
		{ type: 'link', text: ft.allAnnouncements, icon: 'ti ti-speakerphone', to: '/announcements' },
		{ type: 'link', text: ft.creators, icon: 'ti ti-users', to: discoveryPath.pathname + discoveryPath.search },
		{ type: 'link', text: ft.mobileHome, icon: 'ti ti-home', to: '/' },
		...($i ? [
			{ type: 'link' as const, text: i18n.ts.timeline, icon: 'ti ti-messages', to: '/timeline' },
			{ type: 'divider' as const },
			{ text: workbenchText.tools, icon: 'ti ti-grid-dots', action: () => launchTools(target) },
			{ text: i18n.ts.widgets, icon: 'ti ti-apps', action: () => emit('widgets') },
		] : []),
	], target);
}
</script>

<style lang="scss" module>
.header { flex: 0 0 auto; z-index: 32; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); }
.inner { display: flex; justify-content: space-between; align-items: center; gap: 24px; min-height: 64px; padding: 10px var(--community-grid-margin); box-sizing: border-box; border-bottom: 1px solid var(--MI_THEME-divider); }
.header :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: -3px; }
.primary { display: flex; align-items: center; gap: 24px; min-width: 0; }
.brand { display: flex; align-items: center; gap: 8px; min-width: 30px; color: inherit; text-decoration: none; img { flex: 0 0 30px; width: 30px; height: 30px; border-radius: var(--community-radius-small); } }
.brandName { min-width: 0; max-width: 14em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; font-weight: 650; }
.navigation { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.navItem { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 8px 10px; border-radius: var(--community-radius-small); color: inherit; text-decoration: none; white-space: nowrap; i { font-size: 12px; } }
.navItem.current { color: var(--MI_THEME-accent); font-weight: 600; &::after { content: ''; position: absolute; inset-inline: 12px; bottom: 0; height: 2px; background: currentColor; } }
.actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-shrink: 0; }
.iconButton { position: relative; display: grid; place-items: center; flex: 0 0 44px; width: 44px; height: 44px; border-radius: var(--community-radius-small); color: inherit; i { font-size: 20px; } }
.iconButton.current { background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); }
.publish { display: inline-flex; align-items: center; justify-content: center; gap: 8px; flex: 0 0 auto; min-width: 44px; min-height: 44px; padding: 8px 12px; border-radius: var(--community-radius-small); font-size: 13px; font-weight: 600; white-space: nowrap; i { font-size: 20px; } }
.badge { position: absolute; top: 7px; right: 7px; width: 6px; height: 6px; border: 2px solid var(--MI_THEME-panel); border-radius: 50%; background: var(--MI_THEME-accent); }
.account, .login { display: flex; align-items: center; justify-content: center; flex: 0 0 auto; gap: 6px; min-width: 44px; min-height: 44px; border-radius: 12px; color: inherit; font-size: 13px; }
.login { padding-inline: 12px; font-weight: 600; }
.avatar { width: 30px; height: 30px; }
@media (hover: hover) { .iconButton:hover, .navItem:hover, .login:hover, .account:hover { background: var(--MI_THEME-buttonHoverBg); } }
@media (max-width: 1199px) { .brandName, .publish span { display: none; } .primary { gap: 16px; } }
@media (max-width: 959px) { .inner { gap: 16px; } .primary { gap: 12px; } .navItem { padding-inline: 8px; font-size: 13px; } }
@media (max-width: 700px) { .primary { gap: 8px; } .navItem { padding-inline: 8px; font-size: 12px; } .actions { gap: 0; } }
</style>
