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
			<details :class="$style.prompt"><summary>{{ t.prompt }}</summary><p>{{ prompt || t.noPrompt }}</p></details>
			<p v-if="chooseMode" :class="$style.hint">{{ backgroundText.chooseHint }}</p>
			<h3>{{ t.question }}</h3><p :class="$style.hint">{{ t.hint }}</p>
			<div :class="$style.tools"><MkButton :disabled="uploading || selected.length >= 16 || ownReferences.length >= 16" data-testid="remix-upload" @click="uploadInput?.click()"><i class="ti ti-upload" aria-hidden="true"></i> {{ uploading ? t.uploading : t.upload }}</MkButton><span>{{ t.uploadHint }}</span><input ref="uploadInput" type="file" accept="image/*" multiple hidden data-testid="remix-upload-input" @change="uploadReferences"/></div>
			<p v-if="uploadError" role="alert">{{ uploadError }}</p>
			<p v-if="!savedReferences.length" :class="$style.hint" data-testid="remix-no-references">{{ t.noReferences }}</p>
			<div v-if="references.length" :class="$style.tools"><span aria-live="polite">{{ t.selected }} {{ selected.length }} / 16</span><MkButton small :disabled="uploading || references.length > 16" @click="selected = references.map(file => file.id)">{{ t.all }}</MkButton><MkButton small :disabled="uploading || !selected.length" @click="selected = []">{{ t.none }}</MkButton></div>
			<section v-for="group in referenceGroups" :key="group.key" :data-testid="`remix-${group.key}`">
				<h3>{{ group.label }} · {{ group.files.length }}</h3>
				<div :class="$style.grid">
					<div v-for="(file, index) in group.files" :key="file.id" :class="[$style.reference, { [$style.selected]: selected.includes(file.id) }]">
						<button v-if="file.isSensitive && !revealed.includes(file.id)" type="button" class="_button" :class="$style.reveal" @click="revealed.push(file.id)"><i class="ti ti-eye-off" aria-hidden="true"></i>{{ t.reveal }}</button>
						<label v-else :for="`remix-reference-${file.id}`" :class="$style.image"><img v-if="!failed.includes(file.id)" :src="safeWebUrl(file.thumbnailUrl) || safeWebUrl(file.url)" :alt="t.reference + ' ' + (index + 1)" @error="failed.push(file.id)"/><span v-else>{{ t.previewFailed }}</span></label>
						<label :class="$style.choice"><input :id="`remix-reference-${file.id}`" v-model="selected" type="checkbox" :value="file.id" :disabled="uploading || !selected.includes(file.id) && selected.length >= 16"/>{{ group.key === 'own' ? t.mine : t.reference }} {{ index + 1 }}</label>
						<button v-if="group.key === 'own'" type="button" class="_button" :class="$style.remove" :disabled="uploading" :aria-label="`${t.remove} ${file.name}`" @click="removeReference(file.id)"><i class="ti ti-x" aria-hidden="true"></i> {{ t.remove }}</button>
					</div>
				</div>
			</section>
		</template>
		<p v-if="error" role="alert">{{ error }}</p><MkButton v-if="error" @click="load">{{ t.retry }}</MkButton>
	</section>
	<template #footer><div :class="$style.footer"><MkButton :disabled="uploading" @click="cancel">{{ t.cancel }}</MkButton><template v-if="chooseMode && work"><MkButton :disabled="loading || uploading || applied || !prompt.trim() && !selected.length" data-testid="remix-workbench" @click="apply(true, 'workbench')">{{ backgroundText.workbenchMode }}</MkButton><MkButton v-if="work.category !== 'resource'" primary :disabled="loading || uploading || applied || !prompt.trim()" :title="!prompt.trim() ? backgroundText.needsPrompt : undefined" data-testid="remix-background" @click="apply(true, 'background')">{{ backgroundText.backgroundMode }}</MkButton></template><template v-else><MkButton v-if="work && prompt.trim() && selected.length" :disabled="uploading" @click="apply(false)">{{ t.promptOnly }}</MkButton><MkButton v-if="work" primary :disabled="loading || uploading || applied || !prompt.trim() && !selected.length" data-testid="remix-apply" @click="apply()">{{ selected.length ? t.use + '（' + selected.length + '）' : t.promptOnly }}</MkButton></template></div></template>
</MkModalWindow>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { CommunityFile, CommunityWork } from '@/pages/community/types.js';
import { createBrowserCommunityGateway } from '@/pages/community/browser-gateway.js';
import { remixReferenceFiles } from '@/utility/studio-remix.js';
import type { StudioRemix } from '@/utility/studio-remix.js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkButton from '@/components/MkButton.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { backgroundText } from '@/utility/studio-copy.js';
import { homeLanguage } from '@/pages/home/copy.js';
import { safeWebUrl } from '@/pages/community/copy.js';

const props = defineProps<{ submissionId: string; chooseMode?: boolean }>();
const emit = defineEmits<{ (event: 'apply', value: StudioRemix, mode: 'workbench' | 'background'): void; (event: 'closed'): void }>();
const t = homeLanguage === 'en-US'
	? { title: 'Create a remix', loading: 'Loading the original prompt and references…', model: 'Original model', unknown: 'Not recorded', question: 'Reference images for this remix', prompt: 'View full prompt', selected: 'Selected', all: 'Select all', none: 'Clear', reference: 'Reference', original: 'Author’s reference images', mine: 'My reference', upload: 'Upload my reference images', uploading: 'Uploading…', uploadHint: 'Up to 16 images, 32 MB each.', tooLarge: 'Each reference image must be no larger than 32 MB.', remove: 'Remove', uploadFailed: 'Upload failed. Please try again.', imagesOnly: 'Please choose image files.', limit: 'Select up to 16 reference images. Deselect or remove some images first.', noReferences: 'The author provided no reference images. Upload your own images or import only the prompt.', noPrompt: 'No prompt was provided.', reveal: 'Show sensitive image', hint: 'Select the author’s references or upload your own. Your images are used for this remix and do not change the original work.', previewFailed: 'Preview unavailable', retry: 'Retry', cancel: 'Cancel', use: 'Import with references', promptOnly: 'Import prompt only', failed: 'This work could not be loaded. Please retry.' }
	: { title: '制作同款', loading: '正在读取提示词和参考图…', model: '原作品模型', unknown: '未记录', question: '本次制作使用的参考图', prompt: '查看完整提示词', selected: '已选择', all: '全选', none: '清空', reference: '参考图', original: '作者参考图', mine: '我的参考图', upload: '上传我的参考图', uploading: '正在上传…', uploadHint: '最多选择 16 张，每张不超过 32 MB。', tooLarge: '参考图不能超过 32 MB，请压缩后重新上传。', remove: '移除', uploadFailed: '上传失败，请重新选择图片重试。', imagesOnly: '请选择图片文件。', limit: '本次最多选择 16 张参考图，请先取消勾选或移除部分图片。', noReferences: '作者未提供参考图。你可以上传自己的图片，或仅导入提示词。', noPrompt: '作者未提供提示词。', reveal: '显示敏感图片', hint: '可选择作者参考图，也可上传自己的图片。自行上传的图片只用于本次制作，不会改动原作品。', previewFailed: '暂时无法预览', retry: '重试', cancel: '取消', use: '导入提示词和参考图', promptOnly: '仅导入提示词', failed: '无法读取这份作品，请重试。' };
const modal = ref<InstanceType<typeof MkModalWindow>>();
const work = ref<CommunityWork>();
const uploadInput = ref<HTMLInputElement>();
const ownReferences = ref<CommunityFile[]>([]), uploading = ref(false), uploadError = ref('');
const savedReferences = computed(() => work.value ? remixReferenceFiles(work.value) : []);
const references = computed(() => [...savedReferences.value, ...ownReferences.value]);
const referenceGroups = computed(() => [
	{ key: 'original', label: t.original, files: savedReferences.value },
	{ key: 'own', label: t.mine, files: ownReferences.value },
].filter(group => group.files.length));
const prompt = computed(() => work.value?.generation?.prompt ?? work.value?.text ?? '');
const windowHeight = computed(() => loading.value || !work.value ? 240 : Math.min(740, 470 + Math.ceil(references.value.length / 3) * 200));
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
	} catch { if (controller === active && !closed) error.value = t.failed; } finally { window.clearTimeout(timeout); if (controller === active) loading.value = false; }
}

async function uploadReferences(event: Event) {
	const input = event.target as HTMLInputElement, files = Array.from(input.files ?? []);
	input.value = '';
	if (!files.length || uploading.value || applied.value || closed) return;
	uploadError.value = '';
	if (files.some(file => !file.type.startsWith('image/'))) { uploadError.value = t.imagesOnly; return; }
	if (files.some(file => file.size > 32 * 1024 * 1024)) { uploadError.value = t.tooLarge; return; }
	if (files.length + selected.value.length > 16 || files.length + ownReferences.value.length > 16) { uploadError.value = t.limit; return; }
	uploading.value = true;
	try {
		const uploaded = await createBrowserCommunityGateway().uploadFiles!(files);
		if (closed) return;
		if (uploaded.some(file => (file.size ?? 0) > 32 * 1024 * 1024)) { uploadError.value = t.tooLarge; return; }
		if (uploaded.length + selected.value.length > 16 || uploaded.length + ownReferences.value.length > 16) { uploadError.value = t.limit; return; }
		const valid = remixReferenceFiles({ referenceFiles: uploaded }).filter(file => !references.value.some(existing => existing.id === file.id));
		if (valid.length !== uploaded.length || new Set(valid.map(file => file.id)).size !== valid.length) { uploadError.value = t.uploadFailed; return; }
		ownReferences.value.push(...valid);
		selected.value.push(...valid.map(file => file.id));
	} catch { if (!closed) uploadError.value = t.uploadFailed; } finally { uploading.value = false; }
}

function removeReference(id: string) {
	ownReferences.value = ownReferences.value.filter(file => file.id !== id);
	selected.value = selected.value.filter(value => value !== id);
	uploadError.value = '';
}

function cancel() { if (uploading.value) return; closed = true; controller?.abort(); modal.value?.close(); }

function apply(withReferences = true, mode: 'workbench' | 'background' = 'workbench') {
	const value = work.value; if (!value || loading.value || uploading.value || closed || applied.value) return;
	applied.value = true;
	emit('apply', { requestId: crypto.randomUUID(), sourceWorkId: value.id, kind: value.category === 'resource' ? 'text' : value.category, prompt: value.generation?.prompt ?? value.text, model: value.generation?.model || value.model, references: withReferences ? references.value.filter(file => selected.value.includes(file.id)).map(file => ({ url: file.url, name: file.name })) : [] }, mode);
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
.remove { display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%; min-height: 44px; border-top: 1px solid var(--MI_THEME-divider); font-size: 13px; }
.body :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
@media (max-width: 400px) { .body { padding: 16px; } .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
