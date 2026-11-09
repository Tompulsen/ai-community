<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section v-if="$i?.isAdmin" ref="root" :class="$style.root" :aria-labelledby="headingId" data-testid="admin-community-tags">
	<header :class="$style.heading"><div><h2 :id="headingId">{{ t.adminTitle }}</h2><p>{{ t.adminHint }}</p></div><button type="button" class="_button" :class="$style.refresh" :disabled="loading || !!busy" :aria-busy="loading" @click="load"><i class="ti ti-refresh" aria-hidden="true"></i>{{ t.refresh }}</button></header>
	<div :class="$style.categories" role="group" :aria-label="t.categoryLabel"><button v-for="value in communityTagCategories" :key="value" type="button" class="_button" :aria-pressed="category === value" :disabled="!!busy || !!editing" @click="category = value">{{ t.categories[value] }}<span>{{ tags.filter(tag => tag.category === value).length }}</span></button></div>
	<p v-if="loading && !loaded" role="status">{{ t.loading }}</p>
	<div v-if="loadFailed" :class="$style.error" role="alert"><p>{{ t.loadFailed }}</p><button type="button" class="_button" :class="$style.secondary" :disabled="loading || !!busy" @click="load">{{ t.retry }}</button></div>
	<form :class="$style.create" @submit.prevent="create">
		<label :for="nameId">{{ t.name }}<span>{{ t.categories[category] }}</span></label>
		<div :class="$style.createControls"><input :id="nameId" ref="newInput" v-model="name" :placeholder="t.namePlaceholder" :aria-describedby="nameHintId" :disabled="!loaded || loading || !!busy || !!editing" :aria-invalid="!!error && !editing" maxlength="48" autocomplete="off" data-testid="new-community-tag"/><button type="submit" class="_button" :class="$style.primary" :disabled="!loaded || loading || !!busy || !!editing || !name.trim()"><i class="ti ti-plus" aria-hidden="true"></i>{{ busy === 'create' ? t.adding : t.add }}</button></div>
		<p :id="nameHintId" :class="$style.hint">{{ t.nameHint }}</p>
	</form>
	<p v-if="notice" role="status" :class="$style.notice">{{ notice }}</p>
	<p v-if="error" role="alert" :class="$style.error">{{ error }}</p>
	<div v-if="loaded" :class="$style.list" :aria-busy="loading || !!busy">
		<p v-if="!currentTags.length" :class="$style.empty">{{ t.empty }}</p>
		<ul v-else>
			<li v-for="tag in currentTags" :key="tag.id" :data-tag-row="tag.id">
				<form v-if="editing === tag.id" :class="$style.editForm" @submit.prevent="rename(tag)">
					<label :class="$style.editLabel"><span>{{ t.name }}</span><input ref="editInputs" v-model="editName" :aria-label="t.editName(tag.name)" :disabled="!!busy" maxlength="48" autocomplete="off" data-testid="edit-community-tag"/></label>
					<div :class="$style.rowActions"><button type="submit" class="_button" :class="$style.primary" :disabled="!!busy || !editName.trim()">{{ busy === tag.id ? t.saving : t.save }}</button><button type="button" class="_button" :class="$style.secondary" :disabled="!!busy" @click="cancelEdit(tag.id)">{{ t.cancel }}</button></div>
				</form>
				<template v-else><span :class="$style.tagName"><i class="ti ti-tag" aria-hidden="true"></i>{{ tag.name }}</span><div :class="$style.rowActions"><button type="button" class="_button" :class="$style.secondary" :data-edit-tag="tag.id" :aria-label="t.editName(tag.name)" :disabled="!!busy || loading || !!editing" @click="startEdit(tag)"><i class="ti ti-pencil" aria-hidden="true"></i>{{ t.edit }}</button><button type="button" class="_button" :class="$style.delete" :aria-label="t.deleteName(tag.name)" :disabled="!!busy || loading || !!editing" @click="remove(tag)"><i class="ti ti-trash" aria-hidden="true"></i>{{ busy === tag.id ? t.deleting : t.delete }}</button></div></template>
			</li>
		</ul>
	</div>
</section>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import type { CommunityCategory, CommunityTag } from '@/pages/community/types.js';
import { tagText as t } from '@/pages/community/tag-copy.js';
import { clearCommunityTagsCache, communityTagCategories, loadCommunityTags, normalizeCommunityTagName, validCommunityTagName } from '@/pages/community/tags.js';
import { markCommunityUpdated } from '@/pages/community/updates.js';
import { $i } from '@/i.js';
import { confirm } from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const headingId = useId(), nameId = useId(), nameHintId = useId();
const root = ref<HTMLElement>(), newInput = ref<HTMLInputElement>(), editInputs = ref<HTMLInputElement[]>([]);
const category = ref<CommunityCategory>('image');
const tags = ref<CommunityTag[]>([]);
const currentTags = computed(() => tags.value.filter(tag => tag.category === category.value));
const name = ref(''), editing = ref(''), editName = ref('');
const loading = ref(false), loaded = ref(false), loadFailed = ref(false);
const busy = ref(''), notice = ref(''), error = ref('');
let controller: AbortController | undefined;
let disposed = false;

function message(cause: unknown) {
	const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
	if (code === 'COMMUNITY_TAG_CONFLICT') return t.duplicate;
	if (code === 'COMMUNITY_TAG_NOT_FOUND') return t.notFound;
	if (code === 'COMMUNITY_INVALID_TAGS') return t.invalidName;
	return t.saveFailed;
}

function validate(value: string, exceptId?: string) {
	if (!validCommunityTagName(value)) { error.value = t.invalidName; return false; }
	if (currentTags.value.some(tag => tag.id !== exceptId && tag.name === normalizeCommunityTagName(value))) { error.value = t.duplicate; return false; }
	return true;
}

async function load() {
	if (!$i?.isAdmin || loading.value || disposed) return;
	controller?.abort();
	const request = new AbortController(); controller = request;
	loading.value = true; loadFailed.value = false;
	try {
		const result = await loadCommunityTags(undefined, request.signal);
		if (!disposed && controller === request) { tags.value = result; loaded.value = true; }
	} catch { if (!disposed && !request.signal.aborted) loadFailed.value = true; } finally { if (controller === request) loading.value = false; }
}

function changed() {
	// A KeepAlive reactivation may have started a read before this mutation finished.
	controller?.abort(); loading.value = false;
	clearCommunityTagsCache(); markCommunityUpdated();
}

async function create() {
	if (!$i?.isAdmin || !loaded.value || loading.value || busy.value || editing.value || disposed) return;
	error.value = ''; notice.value = '';
	if (!validate(name.value)) return;
	busy.value = 'create';
	try {
		const tag = await misskeyApi<CommunityTag>('admin/community/tags/create', { category: category.value, name: normalizeCommunityTagName(name.value) });
		changed();
		if (disposed) return;
		tags.value = [...tags.value, tag]; name.value = ''; notice.value = t.created;
		await load();
	} catch (cause) { if (!disposed) error.value = message(cause); } finally { busy.value = ''; if (!disposed) { await nextTick(); newInput.value?.focus(); } }
}

async function startEdit(tag: CommunityTag) {
	if (busy.value || loading.value || !$i?.isAdmin) return;
	editing.value = tag.id; editName.value = tag.name; error.value = ''; notice.value = '';
	await nextTick(); editInputs.value[0]?.focus(); editInputs.value[0]?.select();
}

function focusEdit(id: string) {
	[...(root.value?.querySelectorAll<HTMLButtonElement>('[data-edit-tag]') ?? [])].find(button => button.dataset.editTag === id)?.focus();
}

async function cancelEdit(id: string) {
	editing.value = ''; error.value = '';
	await nextTick(); focusEdit(id);
}

async function rename(tag: CommunityTag) {
	if (!$i?.isAdmin || busy.value || disposed) return;
	error.value = ''; notice.value = '';
	if (!validate(editName.value, tag.id)) return;
	if (normalizeCommunityTagName(editName.value) === tag.name) { await cancelEdit(tag.id); return; }
	busy.value = tag.id;
	try {
		const updated = await misskeyApi<CommunityTag>('admin/community/tags/update', { tagId: tag.id, name: normalizeCommunityTagName(editName.value) });
		changed();
		if (disposed) return;
		tags.value = tags.value.map(item => item.id === tag.id ? updated : item); editing.value = ''; notice.value = t.updated;
		await load();
	} catch (cause) { if (!disposed) error.value = message(cause); } finally { busy.value = ''; if (!disposed) { await nextTick(); if (editing.value) editInputs.value[0]?.focus(); else focusEdit(tag.id); } }
}

async function remove(tag: CommunityTag) {
	if (!$i?.isAdmin || busy.value || editing.value || disposed) return;
	busy.value = tag.id; error.value = ''; notice.value = '';
	let removed = false;
	try {
		const { canceled } = await confirm({ type: 'warning', title: t.deleteTitle(tag.name), text: t.deleteHint });
		if (canceled || disposed || !$i?.isAdmin) return;
		await misskeyApi('admin/community/tags/delete', { tagId: tag.id });
		changed();
		if (disposed) return;
		removed = true; tags.value = tags.value.filter(item => item.id !== tag.id); notice.value = t.deleted;
		await load();
	} catch (cause) { if (!disposed) error.value = message(cause); } finally { busy.value = ''; if (!disposed && removed) { await nextTick(); newInput.value?.focus(); } }
}

watch(category, () => { name.value = ''; error.value = ''; notice.value = ''; });
watch([name, editName], () => { error.value = ''; });
onMounted(load);
onActivated(load);
onBeforeUnmount(() => { disposed = true; controller?.abort(); });
</script>

<style lang="scss" module>
.root { margin: 28px 0; padding: 24px 0; border-top: 1px solid var(--MI_THEME-divider); border-bottom: 1px solid var(--MI_THEME-divider); color: var(--MI_THEME-fg); container-type: inline-size; }
.root, .root * { box-sizing: border-box; }
.root :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
.root button, .root input { font: inherit; }
.root button { min-height: 44px; border-radius: 8px; cursor: pointer; }
.root button:disabled { opacity: .5; cursor: not-allowed; }
.heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; h2 { margin: 0 0 8px; font-size: 18px; } p { margin: 0; line-height: 1.7; max-width: 65ch; } }
.refresh, .secondary, .primary, .delete { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; white-space: nowrap; }
.refresh, .secondary { background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-fg); &:hover:not(:disabled) { background: var(--MI_THEME-buttonHoverBg); } }
.primary { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-weight: 600; &:hover:not(:disabled) { filter: brightness(.95); } }
.categories { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; button { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; } button:hover:not(:disabled) { background: var(--MI_THEME-buttonBg); } button[aria-pressed='true'] { background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); font-weight: 600; } span { font-size: 12px; font-variant-numeric: tabular-nums; } }
.create { max-width: 700px; margin-bottom: 20px; label { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; font-weight: 600; span { font-weight: normal; } } }
.createControls { display: flex; align-items: flex-start; gap: 12px; input { flex: 1; min-width: 0; } }
.root input { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid var(--MI_THEME-inputBorder); border-radius: 8px; background: var(--MI_THEME-input); color: var(--MI_THEME-fg); caret-color: var(--MI_THEME-accent); &::placeholder { color: color-mix(in srgb, var(--MI_THEME-fg) 70%, var(--MI_THEME-panel)); } &:disabled { opacity: .6; } }
.hint { margin: 8px 0 0; font-size: 13px; line-height: 1.6; }
.error, .notice { margin: 12px 0; line-height: 1.7; overflow-wrap: anywhere; }
.error { color: var(--MI_THEME-error); }
.list ul { list-style: none; margin: 0; padding: 0; }
.list li { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--MI_THEME-divider); }
.tagName { display: inline-flex; align-items: baseline; gap: 8px; min-width: 0; overflow-wrap: anywhere; i { flex-shrink: 0; } }
.rowActions { display: flex; flex-shrink: 0; align-items: center; flex-wrap: wrap; gap: 8px; }
.delete { color: var(--MI_THEME-error); &:hover:not(:disabled) { background: color-mix(in srgb, var(--MI_THEME-error) 8%, transparent); } }
.editForm { display: flex; flex: 1; align-items: flex-end; gap: 12px; min-width: 0; }
.editLabel { flex: 1; min-width: 0; span { display: block; font-size: 13px; margin-bottom: 8px; } }
.empty { padding: 20px 0; margin: 0; }
@container (max-width: 600px) { .heading { flex-wrap: wrap; } .createControls { gap: 8px; } .list li { align-items: flex-start; flex-wrap: wrap; gap: 8px; } .rowActions { margin-left: auto; } .editForm { flex-wrap: wrap; } .editLabel { flex-basis: 100%; } .root input { font-size: 16px; } }
</style>
