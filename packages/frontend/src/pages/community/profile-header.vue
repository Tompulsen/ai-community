<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section v-if="mobile" :class="[$style.root, $style.mobile]" :aria-label="t.profile" data-testid="mobile-profile-header">
	<div :class="$style.mobileHero">
		<img v-if="safeWebUrl(profile.bannerUrl)" :class="$style.mobileBanner" :src="safeWebUrl(profile.bannerUrl)" alt=""/>
		<div :class="$style.mobileIdentity">
			<div :class="$style.mobileAvatar"><img v-if="safeWebUrl(profile.avatarUrl)" :src="safeWebUrl(profile.avatarUrl)" :alt="profile.name"/><span v-else aria-hidden="true">{{ Array.from(profile.name || profile.handle)[0] }}</span></div>
			<div :class="$style.mobileName"><h1>{{ profile.name || profile.handle }}</h1><p>@{{ profile.handle }}</p><a v-if="profile.detailsPath" :href="profile.detailsPath" @click.prevent="emit('navigate', profile.detailsPath)">{{ t.profileDetails }}<i class="ti ti-chevron-right" aria-hidden="true"></i></a></div>
		</div>
	</div>
	<div :class="$style.mobileBody">
		<div :class="$style.mobileStats">
			<a v-if="profile.followingCount != null && profile.followingPath" :href="profile.followingPath" @click.prevent="emit('navigate', profile.followingPath)"><strong>{{ profile.followingCount.toLocaleString('zh-CN') }}</strong><span>{{ t.following }}</span></a>
			<a v-if="profile.followersCount != null && profile.followersPath" :href="profile.followersPath" @click.prevent="emit('navigate', profile.followersPath)"><strong>{{ profile.followersCount.toLocaleString('zh-CN') }}</strong><span>{{ t.followers }}</span></a>
			<a v-if="profile.isOwn" href="/settings/profile" :class="$style.mobileEdit" @click.prevent="emit('navigate', '/settings/profile')"><i class="ti ti-edit" aria-hidden="true"></i>{{ t.editProfile }}</a>
		</div>
		<div v-if="profile.description" :class="$style.mobileBio"><slot name="description">{{ profile.description }}</slot></div>
		<a v-else-if="profile.isOwn" href="/settings/profile" :class="$style.addBio" @click.prevent="emit('navigate', '/settings/profile')">{{ ft.profileAddBio }}<i class="ti ti-pencil" aria-hidden="true"></i></a>
		<p v-if="joinedDate" :class="$style.mobileJoined">{{ t.joined }} <time :datetime="profile.createdAt">{{ joinedDate }}</time></p>
		<div v-if="!profile.isOwn" :class="$style.mobileFollow"><slot name="actions"></slot></div>
		<nav v-if="profile.isOwn" :class="$style.profileShortcuts" :aria-label="ft.profileTools">
			<a href="/community/mine" @click.prevent="emit('navigate', '/community/mine')"><i class="ti ti-layout-grid" aria-hidden="true"></i>{{ ft.profileManage }}</a>
			<a href="/my/favorites" @click.prevent="emit('favorites')"><i class="ti ti-star" aria-hidden="true"></i>{{ ft.profileFavorites }}</a>
			<a href="/create/video" @click.prevent="emit('navigate', '/create/video')"><i class="ti ti-wand" aria-hidden="true"></i>{{ ft.mobileCreate }}</a>
			<a href="/settings" @click.prevent="emit('navigate', '/settings')"><i class="ti ti-settings" aria-hidden="true"></i>{{ ft.profileSettings }}</a>
		</nav>
	</div>
</section>
<section v-else :class="$style.root" :aria-label="t.profile">
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
import { feedText as ft } from './feed-copy.js';
const props = defineProps<{ profile: CommunityProfile; mobile?: boolean }>();
const emit = defineEmits<{ (event: 'navigate', path: string): void; (event: 'favorites'): void; }>();
const joinedDate = computed(() => Number.isFinite(Date.parse(props.profile.createdAt)) ? new Date(props.profile.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }) : '');
</script>

<style lang="scss" module>
.root { background: var(--MI_THEME-panel); border: 1px solid var(--MI_THEME-divider); border-radius: 12px; margin-bottom: 24px; }
.cover { height: clamp(180px, 22cqw, 300px); background: var(--community-stage, var(--MI_THEME-buttonBg)); border-radius: 12px 12px 0 0; overflow: hidden; }
.cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.body { padding: 0 32px 24px; }
.topline { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.avatar { width: 144px; height: 144px; border: 6px solid var(--MI_THEME-panel); border-radius: 50%; background: var(--MI_THEME-buttonBg); margin-top: -64px; position: relative; display: grid; place-items: center; flex-shrink: 0; font-size: 52px; font-weight: 600; overflow: hidden; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; padding-top: 16px; }
.actions a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 10px 20px; border-radius: 8px; background: var(--MI_THEME-buttonBg); font-weight: 600; }
.actions a:hover { background: var(--MI_THEME-buttonHoverBg); }
.body h1 { font-size: 28px; font-weight: 650; letter-spacing: -.02em; line-height: 1.4; margin-top: 20px; overflow-wrap: anywhere; }
.handle { margin-top: 4px !important; overflow-wrap: anywhere; }
.bio { max-width: 75ch; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; margin-top: 20px; }
.joined { margin-top: 16px !important; font-size: 13px; }
.stats { display: flex; gap: 28px; flex-wrap: wrap; margin-top: 4px; }
.stats a { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; }
.stats a:hover { text-decoration: underline; }
.stats strong { font-variant-numeric: tabular-nums; }
.root.mobile { border: 0; border-radius: 0; margin: 0; }
.mobileHero { position: relative; padding: 28px 20px 38px; overflow: hidden; background: var(--MI_THEME-accentedBg); }
.mobileBanner { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .2; }
.mobileIdentity { position: relative; display: flex; align-items: center; gap: 18px; }
.mobileAvatar { display: grid; place-items: center; flex: 0 0 92px; width: 92px; height: 92px; border: 3px solid var(--MI_THEME-panel); border-radius: 50%; overflow: hidden; background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-accent); font-size: 34px; font-weight: 600; img { width: 100%; height: 100%; object-fit: cover; } }
.mobileName { min-width: 0; h1 { margin: 0; font-size: 25px; line-height: 1.4; font-weight: 700; overflow-wrap: anywhere; } p { margin: 4px 0 0; font-size: 13px; overflow-wrap: anywhere; } a { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; font-size: 12px; color: var(--MI_THEME-accent); } }
.mobileBody { position: relative; margin-top: -18px; padding: 16px 18px 10px; border-radius: 20px 20px 0 0; background: var(--MI_THEME-panel); }
.mobileStats { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 24px; > a { display: flex; align-items: baseline; gap: 6px; min-height: 44px; padding-block: 4px; } strong { font-size: 23px; line-height: 1.5; font-variant-numeric: tabular-nums; } span { font-size: 13px; color: var(--MI_THEME-fgTransparentWeak); } .mobileEdit { align-items: center; margin-left: auto; padding: 8px 12px; border-radius: 10px; background: var(--MI_THEME-buttonBg); font-size: 12px; font-weight: 600; } }
.mobileBio { margin-top: 10px; overflow-wrap: anywhere; line-height: 1.7; }
.addBio { display: flex; align-items: center; gap: 8px; min-height: 44px; font-size: 14px; color: var(--MI_THEME-fgTransparentWeak); }
.mobileJoined { margin: 6px 0 10px; font-size: 12px; color: var(--MI_THEME-fgTransparentWeak); }
.mobileFollow { display: flex; margin: 16px 0 6px; > button { width: 100%; min-height: 44px; border: 0; border-radius: 10px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-size: 15px; } }
.profileShortcuts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 10px 0 2px; a { display: flex; align-items: center; flex-direction: column; gap: 7px; min-height: 64px; padding-block: 6px; font-size: 12px; text-align: center; } i { font-size: 25px; color: var(--MI_THEME-accent); } }
.mobile a:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 2px; }
@media (max-width: 360px) { .mobileHero { padding-inline: 16px; } .mobileIdentity { gap: 12px; } .mobileAvatar { flex-basis: 80px; width: 80px; height: 80px; } .mobileName h1 { font-size: 22px; } .mobileStats { gap: 8px 14px; } .mobileStats .mobileEdit { padding-inline: 8px; } }
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
