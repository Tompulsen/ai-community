<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<MkModalWindow ref="modal" :width="560" :height="620" @close="cancel" @esc="cancel" @closed="emit('closed')">
	<template #header>{{ t.title }}</template>
	<section :class="$style.body" data-testid="remix-options">
		<p v-if="loading" role="status">{{ t.loading }}</p>
		<template v-else-if="work">
			<h2>{{ work.title }}</h2><p>{{ t.model }}：<strong>{{ work.generation?.model || work.model || t.unknown }}</strong></p>
			<p>{{ references.length ? t.question : t.empty }}</p>
			<div v-if="references.length" :class="$style.tools"><MkButton small @click="selected = references.map(file => file.id)">{{ t.all }}</MkButton><MkButton small @click="selected = []">{{ t.none }}</MkButton></div>
			<div :class="$style.grid"><label v-for="(file, index) in references" :key="file.id"><img v-if="!file.isSensitive || revealed.includes(file.id)" :src="file.thumbnailUrl || file.url" :alt="t.reference + ' ' + (index + 1)"/><button v-else type="button" class="_button" @click="revealed.push(file.id)">{{ t.reveal }}</button><span><input v-model="selected" type="checkbox" :value="file.id"/>{{ t.reference }} {{ index + 1 }}</span></label></div>
			<p>{{ t.hint }}</p>
		</template>
		<p v-if="error" role="alert">{{ error }}</p><MkButton v-if="error" @click="load">{{ t.retry }}</MkButton>
	</section>
	<template #footer><div :class="$style.footer"><MkButton @click="cancel">{{ t.cancel }}</MkButton><MkButton v-if="work" primary @click="apply">{{ selected.length ? t.use : t.promptOnly }}</MkButton></div></template>
</MkModalWindow>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { CommunityWork } from '@/pages/community/types.js';
import type { StudioRemix } from '@/utility/studio-remix.js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkButton from '@/components/MkButton.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { homeLanguage } from '@/pages/home/copy.js';
const props = defineProps<{ submissionId: string }>();
const emit = defineEmits<{ (event: 'apply', value: StudioRemix): void; (event: 'closed'): void }>();
const t = homeLanguage === 'en-US' ? { title: 'Create a remix', loading: 'Loading original creation…', model: 'Original model', unknown: 'Not recorded', question: 'Use the original reference images? Select the ones you need.', empty: 'No reference images were saved for this work.', all: 'Select all', none: 'Clear selection', reference: 'Reference', reveal: 'Show sensitive image', hint: 'The prompt and model will be filled in. Review them before generating.', retry: 'Retry', cancel: 'Cancel', use: 'Use selected references', promptOnly: 'Use prompt only', failed: 'This work could not be loaded. Please retry.' } : { title: '制作同款', loading: '正在读取原作品…', model: '原作品模型', unknown: '未记录', question: '是否采用原作品的参考图？可逐张选择。', empty: '这份作品未保存生成参考图。', all: '全选', none: '取消全选', reference: '参考图', reveal: '显示敏感图片', hint: '提示词和模型将自动填入制作区，确认后再生成。', retry: '重试', cancel: '取消', use: '采用所选参考图', promptOnly: '仅带入提示词', failed: '无法读取这份作品，请重试。' };
const modal = ref<InstanceType<typeof MkModalWindow>>();
const work = ref<CommunityWork>();
const references = computed(() => work.value?.referenceFiles ?? []);
const selected = ref<string[]>([]), revealed = ref<string[]>([]), loading = ref(true), error = ref('');
let controller: AbortController | undefined;

async function load() {
	controller?.abort(); const active = new AbortController(); controller = active; loading.value = true; error.value = '';
	try { const value = await misskeyApi('community/works/show', { submissionId: props.submissionId }, undefined, active.signal); if (controller !== active) return; work.value = value; selected.value = (value.referenceFiles ?? []).map(file => file.id); } catch { if (!active.signal.aborted) error.value = t.failed; } finally { if (controller === active) loading.value = false; }
}

function cancel() { controller?.abort(); modal.value?.close(); }

function apply() {
	const value = work.value; if (!value) return;
	emit('apply', { requestId: crypto.randomUUID(), sourceWorkId: value.id, kind: value.category === 'resource' ? 'text' : value.category, prompt: value.generation?.prompt ?? value.text, model: value.generation?.model || value.model, references: references.value.filter(file => selected.value.includes(file.id)).map(file => ({ url: file.url, name: file.name })) });
	modal.value?.close();
}

onMounted(load); onBeforeUnmount(() => { controller?.abort(); });
</script>
<style module lang="scss">
.body { padding: 20px; line-height: 1.6; overflow-wrap: anywhere; h2 { font-size: 18px; margin: 0 0 16px; } }
.tools, .footer { display: flex; gap: 12px; flex-wrap: wrap; }
.footer { padding: 16px; justify-content: flex-end; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 12px; margin: 16px 0; label { min-width: 0; padding: 8px; border: 1px solid var(--MI_THEME-divider); border-radius: 12px; } img { width: 100%; height: 120px; object-fit: contain; } span { display: flex; align-items: center; gap: 8px; min-height: 44px; } input { accent-color: var(--MI_THEME-accent); } button { min-height: 120px; } }
.body :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
</style>
