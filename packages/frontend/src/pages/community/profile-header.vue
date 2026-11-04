<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section :class="$style.root" :aria-label="t.profile">
	<div :class="$style.cover"><img v-if="safeWebUrl(profile.bannerUrl)" :src="safeWebUrl(profile.bannerUrl)" alt=""/></div>
	<div :class="$style.body">
		<div :class="$style.topline">
			<div :class="$style.avatar"><img v-if="safeWebUrl(profile.avatarUrl)" :src="safeWebUrl(profile.avatarUrl)" :alt="profile.name"/><span v-else aria-hidden="true">{{ Array.from(profile.name || profile.handle)[0] }}</span></div>
			<div :class="$style.actions">
				<a v-if="profile.isOwn" href="/settings/profile" @click.prevent="emit('navigate', '/settings/profile')">{{ t.editProfile }}</a>
				<slot name="actions"></slot>
				<a v-if="profile.detailsPath" :href="profile.detailsPath" @click.prevent="emit('navigate', profile.detailsPath)">{{ t.profileDetails }}</a>
			</div>
		</div>
		<h1>{{ profile.name || profile.handle }}</h1>
		<p :class="$style.handle">@{{ profile.handle }}</p>
		<div v-if="profile.description" :class="$style.bio"><slot name="description">{{ profile.description }}</slot></div>
		<p v-if="joinedDate" :class="$style.joined">{{ t.joined }} <time :datetime="profile.createdAt">{{ joinedDate }}</time></p>
		<div :class="$style.stats">
			<a v-if="profile.followingCount != null && profile.followingPath" :href="profile.followingPath" @click.prevent="emit('navigate', profile.followingPath)"><strong>{{ profile.followingCount.toLocaleString('zh-CN') }}</strong>{{ t.following }}</a>
			<a v-if="profile.followersCount != null && profile.followersPath" :href="profile.followersPath" @click.prevent="emit('navigate', profile.followersPath)"><strong>{{ profile.followersCount.toLocaleString('zh-CN') }}</strong>{{ t.followers }}</a>
		</div>
	</div>
</section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CommunityProfile } from './types.js';
import { communityText as t, safeWebUrl } from './copy.js';
const props = defineProps<{ profile: CommunityProfile; }>();
const emit = defineEmits<{ (event: 'navigate', path: string): void; }>();
const joinedDate = computed(() => Number.isFinite(Date.parse(props.profile.createdAt)) ? new Date(props.profile.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }) : '');
</script>

<style lang="scss" module>
.root { background: var(--MI_THEME-panel); border-radius: 16px; margin-bottom: 16px; }
.cover { height: clamp(180px, 22cqw, 300px); background: var(--MI_THEME-buttonBg); border-radius: 16px 16px 0 0; overflow: hidden; }
.cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.body { padding: 0 32px 24px; }
.topline { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.avatar { width: 144px; height: 144px; border: 6px solid var(--MI_THEME-panel); border-radius: 50%; background: var(--MI_THEME-buttonBg); margin-top: -64px; position: relative; display: grid; place-items: center; flex-shrink: 0; font-size: 52px; font-weight: 600; overflow: hidden; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; padding-top: 16px; }
.actions a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 10px 20px; border-radius: 999px; background: var(--MI_THEME-buttonBg); font-weight: 600; }
.actions a:hover { background: var(--MI_THEME-buttonHoverBg); }
.body h1 { font-size: 28px; line-height: 1.4; margin-top: 20px; overflow-wrap: anywhere; }
.handle { margin-top: 4px !important; overflow-wrap: anywhere; }
.bio { max-width: 75ch; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; margin-top: 20px; }
.joined { margin-top: 16px !important; font-size: 13px; }
.stats { display: flex; gap: 28px; flex-wrap: wrap; margin-top: 4px; }
.stats a { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; }
.stats a:hover { text-decoration: underline; }
.stats strong { font-variant-numeric: tabular-nums; }
@container (max-width: 600px) {
 .cover { height: 160px; }
 .body { padding: 0 20px 16px; }
 .topline { gap: 12px; flex-wrap: wrap; }
 .avatar { width: 104px; height: 104px; margin-top: -48px; border-width: 4px; font-size: 36px; }
 .actions { gap: 8px; padding-top: 12px; flex: 1; }
 .actions a { padding: 8px 14px; font-size: 13px; }
 .body h1 { font-size: 23px; margin-top: 12px; }
 .bio { margin-top: 16px; }
 .stats { gap: 20px; }
}
</style>
