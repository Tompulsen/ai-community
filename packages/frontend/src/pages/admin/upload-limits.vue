<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="[]">
	<div :class="$style.settings">
		<SearchMarker path="/admin/upload-limits" :label="t.title" :keywords="['upload', 'size', 'storage', '上传', '暂存']" icon="ti ti-cloud-upload">
			<div class="_gaps_m" data-testid="upload-limits" :aria-busy="loading">
				<p :class="$style.intro">{{ t.intro }}</p>
				<p v-if="!$i?.isAdmin" role="alert">{{ t.adminOnly }}</p>
				<MkLoading v-else-if="loading"/>
				<div v-else-if="loadFailed" role="alert" class="_gaps_s"><p>{{ t.loadFailed }}</p><MkButton @click="load">{{ t.retry }}</MkButton></div>
				<form v-else-if="loaded" novalidate @submit.prevent="save">
					<div :class="$style.fields">
						<div v-for="kind in uploadKinds" :key="kind" :class="$style.row">
							<div>
								<label :for="`upload-limit-${kind}`" :class="$style.label">{{ t.labels[kind] }}</label>
								<p :id="`upload-hint-${kind}`" :class="$style.caption">{{ t.details[kind] }}</p>
							</div>
							<div :class="$style.field">
								<div :class="[$style.control, { [$style.invalid]: touched[kind] && invalid(kind) }]">
									<input :id="`upload-limit-${kind}`" v-model.number="draft[kind]" :data-testid="`limit-${kind}`" type="number" inputmode="numeric" min="1" max="10240" step="1" required :disabled="saving" :aria-invalid="touched[kind] && invalid(kind)" :aria-describedby="`upload-hint-${kind} upload-status-${kind}`" @blur="touched[kind] = true">
									<span aria-hidden="true">MB</span>
								</div>
								<p :id="`upload-status-${kind}`" :class="[$style.caption, { [$style.error]: touched[kind] && invalid(kind) }]" :role="touched[kind] && invalid(kind) ? 'alert' : undefined">
									{{ touched[kind] && invalid(kind) ? t.invalid : `${t.current} ${effective(kind)} MB` }}
								</p>
							</div>
						</div>
					</div>
					<p :class="$style.caption">{{ t.units }}</p>
					<p :class="$style.note">{{ t.boundary }}</p>
					<div :class="$style.actions">
						<MkButton primary type="submit" :disabled="saving || !dirty">{{ saving ? t.saving : t.save }}</MkButton>
						<p v-if="saveFailed" role="alert" :class="$style.error">{{ t.saveFailed }}</p>
						<p v-else-if="saved && !dirty" role="status">{{ t.saved }}</p>
					</div>
				</form>
			</div>
		</SearchMarker>
	</div>
</PageWithHeader>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import type { UploadKind, UploadLimits } from '@/utility/upload-limits.js';
import { getUploadLimits, MiB, refreshUploadLimits, uploadKinds, uploadText as t } from '@/utility/upload-limits.js';
import { instance } from '@/instance.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { $i } from '@/i.js';
import { definePage } from '@/page.js';
import MkButton from '@/components/MkButton.vue';

const draft = reactive<Record<UploadKind, number | string>>(getUploadLimits());
const touched = reactive<Partial<Record<UploadKind, boolean>>>({});
const original = ref('');
const loading = ref(false);
const loaded = ref(false);
const loadFailed = ref(false);
const saving = ref(false);
const saved = ref(false);
const saveFailed = ref(false);
let disposed = false;
const dirty = computed(() => original.value !== JSON.stringify(draft));

function invalid(kind: UploadKind) { return typeof draft[kind] !== 'number' || !Number.isInteger(draft[kind]) || Number(draft[kind]) < 1 || Number(draft[kind]) > 10240; }

function effective(kind: UploadKind) { return invalid(kind) ? '—' : Math.min(Number(draft[kind]), instance.maxFileSize / MiB).toLocaleString(undefined, { maximumFractionDigits: 2 }); }

async function load() {
	if (!$i?.isAdmin || loading.value) return;
	loading.value = true; loadFailed.value = false;
	try {
		const [meta] = await Promise.all([misskeyApi('admin/meta'), refreshUploadLimits()]);
		if (disposed) return;
		Object.assign(draft, getUploadLimits(meta.clientOptions.uploadLimits));
		original.value = JSON.stringify(draft);
		loaded.value = true;
	} catch { if (!disposed) loadFailed.value = true; } finally { loading.value = false; }
}

async function save() {
	if (!$i?.isAdmin || saving.value || !loaded.value || !dirty.value) return;
	for (const kind of uploadKinds) touched[kind] = true;
	if (uploadKinds.some(invalid)) return;
	const limits = { ...draft } as UploadLimits;
	saving.value = true; saveFailed.value = false; saved.value = false;
	try {
		await misskeyApi('admin/update-meta', { clientOptions: { uploadLimits: limits } });
		if (disposed) return;
		instance.clientOptions = { ...instance.clientOptions, uploadLimits: limits };
		original.value = JSON.stringify(limits);
		saved.value = true;
	} catch { if (!disposed) saveFailed.value = true; } finally { saving.value = false; }
}

onMounted(load);
onBeforeUnmount(() => { disposed = true; });
definePage(() => ({ title: t.title, icon: 'ti ti-cloud-upload' }));
</script>

<style lang="scss" module>
.settings { max-width: 1000px; padding: 24px 32px 48px; margin-inline: auto; container-type: inline-size; }
.intro { margin: 0; line-height: 1.7; }
.fields { border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); background: var(--MI_THEME-panel); }
.row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, 250px); gap: 24px; padding: 20px; align-items: start; }
.row + .row { border-top: 1px solid var(--MI_THEME-divider); }
.label { display: inline-block; font-weight: 600; line-height: 1.5; margin-block: 4px; }
.field { min-width: 0; }
.caption { font-size: .85em; line-height: 1.6; margin: 6px 0 0; overflow-wrap: anywhere; }
.control { display: flex; align-items: center; gap: 8px; min-height: 44px; padding-inline: 12px; border: 1px solid var(--MI_THEME-inputBorder); border-radius: 8px; background: var(--MI_THEME-bg); }
.control:focus-within { outline: 2px solid var(--MI_THEME-accent); outline-offset: 2px; }
.control input { min-width: 0; width: 100%; padding: 10px 0; border: none; background: transparent; color: inherit; font: inherit; font-variant-numeric: tabular-nums; caret-color: var(--MI_THEME-accent); }
.control input:focus { outline: none; }
.control.invalid { border-color: var(--MI_THEME-error); }
.note { line-height: 1.7; margin: 20px 0; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.actions p { margin: 0; line-height: 1.6; }
.error { color: var(--MI_THEME-error); }
@container (max-width: 560px) { .row { grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 16px; } }
@media (max-width: 600px) { .settings { padding: 20px 16px 32px; } }
</style>
