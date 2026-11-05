<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section :class="$style.gallery" :aria-label="t.preview" data-testid="work-gallery">
	<div v-if="selected?.isSensitive && !revealed" :class="$style.message"><i class="ti ti-eye-off" aria-hidden="true"></i><p>{{ t.sensitive }}</p><button type="button" class="_button" @click="revealed = true">{{ t.reveal }}</button></div>
	<div v-else-if="failed" :class="$style.message"><p>{{ t.noPreview }}</p><button type="button" class="_button" @click="failed = false">{{ t.retry }}</button></div>
	<video v-else-if="selected?.type.startsWith('video/') && safeWebUrl(selected.url)" :key="selected.id" :src="safeWebUrl(selected.url)" controls playsinline preload="metadata" :aria-label="selected.name || work.title" @error="failed = true"></video>
	<img v-else-if="selected && safeWebUrl(selected.url)" :key="selected.id" :src="safeWebUrl(selected.url)" :alt="selected.name || work.title" decoding="async" @error="failed = true"/>
	<div v-else :class="[$style.message, $style.textWork]"><i class="ti ti-file-text" aria-hidden="true"></i><h2>{{ work.title }}</h2><p>{{ work.text }}</p><a v-for="file in work.files" :key="file.id" :href="safeWebUrl(file.url)" target="_blank" rel="noopener noreferrer"><i class="ti ti-file-download" aria-hidden="true"></i> {{ file.name }}</a></div>
	<template v-if="media.length > 1"><button type="button" class="_button" :class="[$style.switch, $style.previous]" :aria-label="t.previous" :disabled="index === 0" @click="index--"><i class="ti ti-chevron-left" aria-hidden="true"></i></button><button type="button" class="_button" :class="[$style.switch, $style.next]" :aria-label="t.next" :disabled="index === media.length - 1" @click="index++"><i class="ti ti-chevron-right" aria-hidden="true"></i></button><span :class="$style.counter" aria-live="polite">{{ index + 1 }} / {{ media.length }}</span></template>
</section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { CommunityWork } from './types.js';
import { safeWebUrl } from './copy.js';
import { workText as t } from './interactions-copy.js';

const props = defineProps<{ work: CommunityWork }>();
const index = ref(0);
const failed = ref(false);
const revealed = ref(false);
const media = computed(() => props.work.files.filter(file => file.type.startsWith('image/') || file.type.startsWith('video/')));
const selected = computed(() => media.value[index.value]);
watch(() => props.work.id, () => { index.value = 0; });
watch(() => selected.value?.id, () => { failed.value = false; revealed.value = false; });
</script>

<style lang="scss" module>
@use './work-palette.scss';

.gallery { @include work-palette.stage; position: relative; display: flex; align-items: center; justify-content: center; width: 100%; min-width: 0; height: 100%; min-height: 300px; color: var(--work-stage-fg); background: var(--work-stage); overflow: hidden; > img, > video { display: block; width: 100%; height: 100%; min-height: 0; object-fit: contain; } }
.gallery :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
.switch { position: absolute; top: calc(50% - 24px); display: grid; place-items: center; width: 48px; height: 48px; background: color-mix(in srgb, var(--work-stage) 80%, transparent); color: var(--work-stage-fg); border-radius: 50%; font-size: 24px; &:disabled { opacity: .25; cursor: default; } }
.previous { left: 16px; } .next { right: 16px; }
.counter { position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%); background: var(--work-stage); padding: 6px 12px; border-radius: 20px; font-variant-numeric: tabular-nums; font-size: 13px; }
.message { padding: 28px 60px; text-align: center; max-height: 100%; overflow: auto; box-sizing: border-box; > i { font-size: 36px; } button, a { display: inline-block; color: inherit; border: 1px solid currentColor; border-radius: 8px; padding: 10px 16px; min-height: 44px; box-sizing: border-box; } }
.textWork { max-width: 76ch; text-align: left; p { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; } a { margin: 8px 8px 0 0; overflow-wrap: anywhere; } }
@media (max-width: 700px) { .gallery { min-height: 260px; } .switch { width: 44px; height: 44px; } .previous { left: 8px; } .next { right: 8px; } .message { padding: 24px; } }
</style>
