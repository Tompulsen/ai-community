<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<nav :class="$style.navigation" :aria-label="t.mobileNavigation" data-testid="mobile-community-navigation">
	<MkA to="/community" :class="{ [$style.current]: homeCurrent }" :aria-current="homeCurrent ? 'page' : undefined">{{ t.mobileHome }}</MkA>
	<MkA to="/create/video" :class="{ [$style.current]: createCurrent }" :aria-current="createCurrent ? 'page' : undefined">{{ t.mobileCreate }}</MkA>
	<button type="button" class="_button" :class="$style.publish" :aria-label="communityText.publish" @click="publish"><span><i class="ti ti-plus" aria-hidden="true"></i></span></button>
	<button type="button" class="_button" :class="{ [$style.current]: messagesCurrent }" :aria-current="messagesCurrent ? 'page' : undefined" @click="accountPage('/my/notifications')">{{ t.mobileMessages }}<span v-if="$i?.hasUnreadNotification || $i?.hasUnreadChatMessages" :class="$style.badge">{{ $i.unreadNotificationsCount > 99 ? '99+' : $i.unreadNotificationsCount || '•' }}</span></button>
	<button type="button" class="_button" :class="{ [$style.current]: ownProfile }" :aria-current="ownProfile ? 'page' : undefined" @click="accountPage($i ? `/@${$i.username}` : '/community/mine')">{{ t.mobileMe }}</button>
</nav>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { feedText as t } from './feed-copy.js';
import { communityText } from './copy.js';
import { requestCommunityComposer } from './compose.js';
import { $i } from '@/i.js';
import { mainRouter } from '@/router.js';
import * as os from '@/os.js';

const currentPath = ref(mainRouter.getCurrentFullPath());
mainRouter.useListener('change', ({ fullPath }) => { currentPath.value = fullPath; });
const pathname = computed(() => currentPath.value.split(/[?#]/)[0].replace(/\/$/, ''));
const homeCurrent = computed(() => pathname.value.startsWith('/community') && !ownProfile.value);
const createCurrent = computed(() => pathname.value.startsWith('/create/'));
const messagesCurrent = computed(() => pathname.value === '/my/notifications' || /^\/chat(?:\/|$)/.test(pathname.value));
const ownProfile = computed(() => /^\/settings(?:\/|$)/.test(pathname.value) || pathname.value === '/community/mine' || (!!$i && [`/@${$i.username}`, `/@${$i.username}/community`].includes(pathname.value)));

async function login() {
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkSigninDialog.vue').then(x => x.default), { autoSet: true }, { closed: () => dispose() });
}

function accountPage(path: string) { if ($i) mainRouter.pushByPath(path); else void login(); }

function publish() { if ($i) requestCommunityComposer(() => mainRouter.push('/community/:module', { params: { module: 'compose' } })); else void login(); }
</script>

<style lang="scss" module>
.navigation { flex: 0 0 auto; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); align-items: center; min-height: 58px; padding: 0 6px env(safe-area-inset-bottom, 0px); box-sizing: border-box; background: var(--MI_THEME-navBg, var(--MI_THEME-panel)); color: var(--MI_THEME-navFg, var(--MI_THEME-fg)); border-top: 1px solid var(--MI_THEME-divider); z-index: 2; }
.navigation > a, .navigation > button { position: relative; display: grid; place-items: center; min-height: 56px; min-width: 0; padding: 0 2px; text-decoration: none; font: inherit; font-size: 14px; font-weight: 600; color: inherit; }
.navigation .current { color: var(--MI_THEME-accent); }
.navigation :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: -5px; }
.navigation > :is(a, button):active { background: var(--MI_THEME-buttonBg); border-radius: 10px; }
.publish span { display: grid; place-items: center; width: 44px; height: 36px; border-radius: 10px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-size: 24px; transition: transform 160ms ease-out; }
.publish:active span { transform: scale(.9); }
.badge { position: absolute; top: 7px; left: 58%; min-width: 14px; padding: 1px 4px; border-radius: 10px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-size: 10px; line-height: 14px; }
@media (prefers-reduced-motion: reduce) { .publish span { transition: none; } }
</style>
