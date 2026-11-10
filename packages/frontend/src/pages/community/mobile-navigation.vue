<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<nav :class="$style.navigation" :aria-label="t.mobileNavigation" data-testid="mobile-community-navigation">
	<MkA to="/community" :class="$style.current" aria-current="page">{{ t.mobileHome }}</MkA>
	<MkA to="/create/video">{{ t.mobileCreate }}</MkA>
	<button type="button" class="_button" :class="$style.publish" :aria-label="communityText.publish" @click="publish"><span><i class="ti ti-plus" aria-hidden="true"></i></span></button>
	<button type="button" class="_button" @click="accountPage('/my/notifications')">{{ t.mobileMessages }}<span v-if="$i?.hasUnreadNotification" :class="$style.badge">{{ $i.unreadNotificationsCount > 99 ? '99+' : $i.unreadNotificationsCount }}</span></button>
	<button type="button" class="_button" @click="accountPage($i ? `/@${$i.username}` : '/community/mine')">{{ t.mobileMe }}</button>
</nav>
</template>

<script setup lang="ts">
import { feedText as t } from './feed-copy.js';
import { communityText } from './copy.js';
import { requestCommunityComposer } from './compose.js';
import { $i } from '@/i.js';
import { mainRouter } from '@/router.js';
import * as os from '@/os.js';

async function login() {
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkSigninDialog.vue').then(x => x.default), { autoSet: true }, { closed: () => dispose() });
}

function accountPage(path: string) { if ($i) mainRouter.pushByPath(path); else void login(); }

function publish() { if ($i) requestCommunityComposer(() => mainRouter.push('/community/:module', { params: { module: 'compose' } })); else void login(); }
</script>

<style lang="scss" module>
@use './work-palette.scss';

.navigation { @include work-palette.immersive; flex: 0 0 auto; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); align-items: center; min-height: 58px; padding: 0 6px env(safe-area-inset-bottom, 0px); box-sizing: border-box; background: var(--work-stage); color: var(--work-stage-muted); border-top: 1px solid var(--work-stage-border); z-index: 2; }
.navigation > a, .navigation > button { position: relative; display: grid; place-items: center; min-height: 56px; min-width: 0; padding: 0 2px; text-decoration: none; font: inherit; font-size: 14px; font-weight: 600; color: inherit; }
.navigation .current { color: var(--work-stage-fg); }
.navigation :focus-visible { outline: 2px solid var(--work-stage-fg); outline-offset: -5px; }
.publish span { display: grid; place-items: center; width: 36px; height: 26px; border: 2px solid var(--work-stage-fg); border-radius: 7px; color: var(--work-stage-fg); font-size: 22px; box-shadow: -3px 0 var(--work-stage-cyan), 3px 0 var(--work-stage-accent); transition: transform 160ms ease-out; }
.publish:active span { transform: scale(.9); }
.badge { position: absolute; top: 7px; left: 58%; min-width: 14px; padding: 1px 4px; border-radius: 10px; background: var(--work-stage-accent); color: var(--work-stage-fg); font-size: 10px; line-height: 14px; }
@media (prefers-reduced-motion: reduce) { .publish span { transition: none; } }
</style>
