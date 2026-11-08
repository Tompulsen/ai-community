<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<MkModalWindow ref="modal" :width="580" :height="windowHeight" @close="cancel" @esc="cancel" @closed="emit('closed')">
	<template #header>{{ t.title }}</template>
	<section :class="$style.body" data-testid="remix-options">
		<p v-if="loading" role="status">{{ t.loading }}</p>
		<template v-else-if="work">
			<h2>{{ work.title }}</h2>
			<p :class="$style.model">{{ t.model }}：<strong>{{ work.generation?.model || work.model || t.unknown }}</strong></p>
			<details :class="$style.prompt"><summary>{{ t.prompt }}</summary><p>{{ work.generation?.prompt ?? work.text }}</p></details>
			<template v-if="references.length">
				<h3>{{ t.question }}</h3><p :class="$style.hint">{{ t.hint }}</p>
				<div :class="$style.tools"><span aria-live="polite">{{ t.selected }} {{ selected.length }} / {{ references.length }}</span><MkButton small @click="selected = references.map(file => file.id)">{{ t.all }}</MkButton><MkButton small :disabled="!selected.length" @click="selected = []">{{ t.none }}</MkButton></div>
				<div :class="$style.grid">
					<div v-for="(file, index) in references" :key="file.id" :class="[$style.reference, { [$style.selected]: selected.includes(file.id) }]">
						<button v-if="file.isSensitive && !revealed.includes(file.id)" type="button" class="_button" :class="$style.reveal" @click="revealed.push(file.id)"><i class="ti ti-eye-off" aria-hidden="true"></i>{{ t.reveal }}</button>
						<label v-else :for="`remix-reference-${file.id}`" :class="$style.image"><img v-if="!failed.includes(file.id)" :src="safeWebUrl(file.thumbnailUrl) || safeWebUrl(file.url)" :alt="t.reference + ' ' + (index + 1)" @error="failed.push(file.id)"/><span v-else>{{ t.previewFailed }}</span></label>
						<label :class="$style.choice"><input :id="`remix-reference-${file.id}`" v-model="selected" type="checkbox" :value="file.id"/>{{ t.reference }} {{ index + 1 }}</label>
					</div>
				</div>
			</template>
		</template>
		<p v-if="error" role="alert">{{ error }}</p><MkButton v-if="error" @click="load">{{ t.retry }}</MkButton>
	</section>
	<template #footer><div :class="$style.footer"><MkButton @click="cancel">{{ t.cancel }}</MkButton><MkButton v-if="work && selected.length" @click="apply(false)">{{ t.promptOnly }}</MkButton><MkButton v-if="work" primary :disabled="loading || applied" data-testid="remix-apply" @click="apply()">{{ selected.length ? t.use + '（' + selected.length + '）' : t.promptOnly }}</MkButton></div></template>
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
import { safeWebUrl } from '@/pages/community/copy.js';

const props = defineProps<{ submissionId: string }>();
const emit = defineEmits<{ (event: 'apply', value: StudioRemix): void; (event: 'closed'): void }>();
const t = homeLanguage === 'en-US'
	? { title: 'Create a remix', loading: 'Loading the original prompt and references…', model: 'Original model', unknown: 'Not recorded', question: 'Include reference images?', prompt: 'View full prompt', selected: 'Selected', all: 'Select all', none: 'Clear', reference: 'Reference', reveal: 'Show sensitive image', hint: 'Select any images to include. Leave them unselected to import only the prompt. Nothing is generated automatically.', previewFailed: 'Preview unavailable', retry: 'Retry', cancel: 'Cancel', use: 'Import with references', promptOnly: 'Import prompt only', failed: 'This work could not be loaded. Please retry.' }
	: { title: '制作同款', loading: '正在读取提示词和参考图…', model: '原作品模型', unknown: '未记录', question: '需要带入参考图吗？', prompt: '查看完整提示词', selected: '已选择', all: '全选', none: '清空', reference: '参考图', reveal: '显示敏感图片', hint: '点选需要的图片；不选择则只导入提示词。导入后由你确认生成。', previewFailed: '暂时无法预览', retry: '重试', cancel: '取消', use: '导入提示词和参考图', promptOnly: '仅导入提示词', failed: '无法读取这份作品，请重试。' };
const modal = ref<InstanceType<typeof MkModalWindow>>();
const work = ref<CommunityWork>();
const references = computed(() => (work.value?.referenceFiles ?? []).filter(file => file.type.startsWith('image/') && safeWebUrl(file.url)));
const windowHeight = computed(() => loading.value || !work.value ? 240 : Math.min(680, 370 + Math.ceil(references.value.length / 3) * 170));
const selected = ref<string[]>([]), revealed = ref<string[]>([]), failed = ref<string[]>([]), loading = ref(true), error = ref(''), applied = ref(false);
let controller: AbortController | undefined;
let closed = false;

async function load() {
	controller?.abort(); const active = new AbortController(); controller = active; loading.value = true; error.value = ''; work.value = undefined; selected.value = []; revealed.value = []; failed.value = [];
	const timeout = window.setTimeout(() => active.abort(), 15000);
	try {
		const value = await misskeyApi('community/works/show', { submissionId: props.submissionId }, undefined, active.signal);
		if (controller !== active || closed || active.signal.aborted) return;
		work.value = value; loading.value = false;
		if (!references.value.length) apply(false);
	} catch { if (controller === active && !closed) error.value = t.failed; } finally { window.clearTimeout(timeout); if (controller === active) loading.value = false; }
}

function cancel() { closed = true; controller?.abort(); modal.value?.close(); }

function apply(withReferences = true) {
	const value = work.value; if (!value || loading.value || closed || applied.value) return;
	applied.value = true;
	emit('apply', { requestId: crypto.randomUUID(), sourceWorkId: value.id, kind: value.category === 'resource' ? 'text' : value.category, prompt: value.generation?.prompt ?? value.text, model: value.generation?.model || value.model, references: withReferences ? references.value.filter(file => selected.value.includes(file.id)).map(file => ({ url: file.url, name: file.name })) : [] });
	modal.value?.close();
}

onMounted(load); onBeforeUnmount(() => { closed = true; controller?.abort(); });
</script>
<style module lang="scss">
.body { padding: 20px; line-height: 1.6; overflow-wrap: anywhere; h2 { font-size: 18px; margin: 0 0 8px; } h3 { font-size: 15px; margin: 20px 0 4px; } }
.model { margin: 0 0 12px; font-size: 13px; }
.prompt { font-size: 13px; summary { cursor: pointer; min-height: 32px; color: var(--MI_THEME-accent); } p { margin: 8px 0; max-height: 120px; overflow: auto; white-space: pre-wrap; } }
.hint { margin: 0 0 12px; font-size: 13px; }
.tools, .footer { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tools { margin-bottom: 12px; > span { margin-right: auto; font-size: 13px; } }
.footer { justify-content: flex-end; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 12px; }
.reference { min-width: 0; border: 1px solid var(--MI_THEME-divider); border-radius: 10px; overflow: hidden; }
.selected { border-color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); }
.image, .reveal { display: flex; align-items: center; justify-content: center; width: 100%; height: 120px; cursor: pointer; background: var(--MI_THEME-panel); img { width: 100%; height: 100%; object-fit: contain; } }
.reveal { flex-direction: column; gap: 8px; font-size: 12px; }
.choice { display: flex; align-items: center; gap: 8px; padding: 0 10px; min-height: 44px; cursor: pointer; font-size: 13px; input { width: 18px; height: 18px; accent-color: var(--MI_THEME-accent); } }
.body :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
@media (max-width: 400px) { .body { padding: 16px; } .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
