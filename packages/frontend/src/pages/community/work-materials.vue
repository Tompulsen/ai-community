<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<div v-if="groups.length" :class="$style.materials" data-testid="work-materials">
	<section v-for="group in groups" :key="group.key" :aria-label="group.label" :data-kind="group.key">
		<h3>{{ group.label }} <span>{{ group.files.length }}</span></h3>
		<div :class="$style.grid">
			<button v-for="(file, index) in group.files" :key="file.id" type="button" class="_button" :class="$style.thumbnail" :aria-label="`${group.label} ${index + 1}: ${file.isSensitive && !revealed.includes(file.id) ? t.reveal : file.name}`" @click="open(file)">
				<i v-if="file.isSensitive && !revealed.includes(file.id)" class="ti ti-eye-off" aria-hidden="true"></i>
				<img v-else-if="preview(file) && !failed.includes(file.id)" :src="preview(file)" :alt="file.name" loading="lazy" decoding="async" @error="failed.push(file.id)"/>
				<i v-else :class="file.type.startsWith('video/') ? 'ti ti-video' : 'ti ti-file'" aria-hidden="true"></i>
				<span>{{ index + 1 }}</span>
			</button>
		</div>
	</section>
</div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { safeWebUrl } from './copy.js';
import { workText as t } from './interactions-copy.js';
import { openWorkMedia } from './work-preview.js';
import type { CommunityFile, CommunityWork } from './types.js';
import { homeLanguage } from '@/pages/home/copy.js';

const props = defineProps<{ work: CommunityWork }>();
const revealed = ref<string[]>([]), failed = ref<string[]>([]);
const groups = computed(() => [
	{ key: 'output', label: homeLanguage === 'en-US' ? 'Created works' : '作品', files: props.work.files },
	{ key: 'reference', label: homeLanguage === 'en-US' ? 'References' : '参考图', files: props.work.referenceFiles ?? [] },
].filter(group => group.files.length));

function preview(file: CommunityFile) { return safeWebUrl(file.thumbnailUrl) ?? (file.type.startsWith('image/') ? safeWebUrl(file.url) : undefined); }

async function open(file: CommunityFile) {
	if (file.isSensitive && !revealed.value.includes(file.id)) { revealed.value.push(file.id); return; }
	await openWorkMedia(props.work, file.id, revealed.value);
}

watch(() => props.work, () => { revealed.value = []; failed.value = []; });
</script>
<style lang="scss" module>
.materials { min-width: 0; display: grid; align-content: start; gap: 16px; h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; line-height: 1.5; color: var(--MI_THEME-fg); span { margin-left: 4px; color: var(--MI_THEME-fgTransparentWeak); font-weight: 400; } } }
.grid { display: flex; flex-wrap: wrap; gap: 8px; }
.thumbnail { position: relative; display: grid; place-items: center; width: 68px; height: 68px; flex-shrink: 0; overflow: hidden; border-radius: 8px; background: var(--MI_THEME-bg); color: var(--MI_THEME-fg); border: 1px solid var(--MI_THEME-divider); cursor: zoom-in; img { width: 100%; height: 100%; object-fit: contain; } > i { font-size: 22px; } > span { position: absolute; right: 3px; bottom: 3px; background: var(--MI_THEME-panel); padding: 0 4px; border-radius: 3px; font-size: 11px; } &:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 2px; } &:hover { border-color: var(--MI_THEME-accent); } }
</style>
