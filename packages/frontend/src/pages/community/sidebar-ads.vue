<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section :class="$style.module" :aria-labelledby="headingId" data-testid="community-ads">
	<header :class="$style.heading"><h2 :id="headingId">{{ t.title }}</h2><MkA v-if="$i?.isAdmin" to="/admin/community-ads">{{ t.manage }}<i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA></header>
	<div :class="$style.grid">
		<div v-for="(slot, index) in slots" :key="slot.key" :class="$style.slot" :data-testid="`community-ad-${index + 1}`">
			<a v-if="slot.ad" :href="slot.ad.linkUrl" target="_blank" rel="noopener noreferrer sponsored" :class="$style.card" :aria-label="`${slot.ad.title} · ${t.title} · ${t.opens}`">
				<div :class="$style.media"><img v-if="failed[slot.key] !== slot.image" :src="slot.image" :alt="slot.ad.title" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="failed[slot.key] = slot.image"/><span v-else :class="$style.fallback"><i class="ti ti-photo-off" aria-hidden="true"></i>{{ t.imageFailed }}</span></div>
				<span :class="$style.caption"><strong>{{ slot.ad.title }}</strong><i class="ti ti-arrow-up-right" aria-hidden="true"></i></span>
			</a>
			<div v-else :class="$style.empty"><i class="ti ti-photo-plus" aria-hidden="true"></i><span>{{ t.empty }}</span><small>{{ t.positions[index] }}</small></div>
		</div>
	</div>
</section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, useId } from 'vue';
import { url as siteUrl } from '@@/js/config.js';
import { adText as t, communityAdKeys, normalizeAdUrl } from './ads.js';
import { instance } from '@/instance.js';
import { $i } from '@/i.js';
import { prefer } from '@/preferences.js';
import { getStaticImageUrl } from '@/utility/media-proxy.js';

const headingId = useId();
const failed = reactive<Record<string, string>>({});
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduceMotion = ref(motionPreference.matches);
const updateMotion = () => { reduceMotion.value = motionPreference.matches; };
motionPreference.addEventListener('change', updateMotion);
onBeforeUnmount(() => { motionPreference.removeEventListener('change', updateMotion); });
const slots = computed(() => communityAdKeys.map(key => {
	const value = instance.clientOptions[key];
	const imageUrl = value && normalizeAdUrl(value.imageUrl, siteUrl, true);
	const linkUrl = value && normalizeAdUrl(value.linkUrl, siteUrl);
	const ad = value?.enabled && value.title.trim() && imageUrl && linkUrl ? { ...value, imageUrl, linkUrl } : null;
	return { key, ad, image: ad ? (reduceMotion.value || prefer.s.disableShowingAnimatedImages ? getStaticImageUrl(ad.imageUrl) : ad.imageUrl) : '' };
}));
</script>

<style lang="scss" module>
.module { min-width: 0; padding: 20px; background: var(--MI_THEME-panel); border: 1px solid var(--MI_THEME-divider); border-radius: 12px; }
.heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; h2 { margin: 0; font-size: 14px; font-weight: 650; } a { display: inline-flex; align-items: center; gap: 4px; min-height: 32px; font-size: 12px; color: var(--MI_THEME-accent); } }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.slot { min-width: 0; }
.card { display: block; overflow: hidden; color: var(--MI_THEME-fg); background: var(--MI_THEME-bg); border: 1px solid var(--MI_THEME-divider); border-radius: 8px; text-decoration: none; transition: border-color .18s ease; &:hover { border-color: var(--MI_THEME-accent); .caption i { transform: translate(2px, -2px); } } &:active { transform: translateY(1px); } }
.media { aspect-ratio: 1; overflow: hidden; display: flex; align-items: center; justify-content: center; img { display: block; width: 100%; height: 100%; object-fit: cover; } }
.caption { display: flex; align-items: center; gap: 6px; padding: 10px 8px; font-size: 12px; strong { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; } i { flex-shrink: 0; transition: transform .18s ease; } }
.empty { aspect-ratio: 1; min-height: 120px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 10px 4px; text-align: center; border: 1px dashed var(--MI_THEME-divider); border-radius: 8px; background: var(--MI_THEME-bg); color: var(--MI_THEME-fg); font-size: 12px; i { font-size: 23px; color: var(--MI_THEME-accent); } small { font-size: 11px; } }
.fallback { display: flex; flex-direction: column; gap: 8px; padding: 12px; text-align: center; font-size: 11px; line-height: 1.5; i { font-size: 22px; } }
.module a:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { .card, .caption i { transition: none; transform: none !important; } }
</style>
