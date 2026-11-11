<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="[]">
	<div :class="$style.page" data-testid="lottery-admin">
		<header :class="$style.header"><div><h1>{{ t.adminTitle }}</h1><p>{{ t.adminIntro }}</p></div><MkA to="/community/lottery" :class="$style.link">{{ t.preview }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA></header>
		<p v-if="!$i?.isAdmin" role="alert">{{ t.adminOnly }}</p>
		<p v-else-if="loading" role="status">{{ t.loading }}</p>
		<div v-else-if="!draft" role="alert">{{ t.loadFailed }} <button type="button" :class="$style.secondary" @click="load">{{ t.retry }}</button></div>
		<template v-else>
			<form @submit.prevent="save">
				<div :class="$style.enableRow"><label><input v-model="draft.settings.enabled" type="checkbox" :disabled="saving"/>{{ t.enabled }}</label><span>{{ t.ruleHint }}</span></div>
				<section :class="$style.section" data-testid="lottery-design">
					<h2>{{ t.wheelDesign }}</h2><p :class="$style.hint">{{ t.wheelDesignHint }}</p>
					<div :class="$style.designLayout">
						<div :class="$style.designFields">
							<fieldset :class="$style.themes" :disabled="saving"><legend>{{ t.wheelTheme }}</legend><label v-for="(theme, key) in wheelThemes" :key="key" :class="{ [$style.chosenTheme]: draft.settings.wheel.theme === key }"><input v-model="draft.settings.wheel.theme" type="radio" name="wheel-theme" :value="key"/><span :style="{ background: theme.accent }" aria-hidden="true"></span>{{ t[key] }}</label></fieldset>
							<div :class="$style.fields"><label>{{ t.wheelHeading }}<input v-model="draft.settings.wheel.title" :placeholder="t.wheelTitle" maxlength="32" :disabled="saving" data-testid="wheel-title"/></label><label>{{ t.wheelButton }}<input v-model="draft.settings.wheel.buttonText" maxlength="8" required :disabled="saving" data-testid="wheel-button"/></label></div>
							<label :class="$style.description">{{ t.wheelDescription }}<textarea v-model="draft.settings.wheel.subtitle" :placeholder="t.wheelSubtitle" maxlength="120" rows="2" :disabled="saving"></textarea></label>
							<label :class="$style.description">{{ t.wheelRules }}<textarea v-model="draft.settings.wheel.rulesText" maxlength="2000" rows="4" :disabled="saving" aria-describedby="wheel-rules-help" data-testid="wheel-rules"></textarea></label><p id="wheel-rules-help" :class="$style.hint">{{ t.wheelRulesHint }}</p>
						</div>
						<div :class="$style.designPreview"><h3>{{ draft.settings.wheel.title || t.wheelTitle }}</h3><p>{{ draft.settings.wheel.subtitle || t.wheelSubtitle }}</p><LotteryWheel :prizes="previewPrizes" :appearance="draft.settings.wheel" :actionLabel="t.wheelPreview" preview/><p>{{ previewPrizes.length ? `${previewPrizes.length} ${t.wheelPreviewCount}` : t.wheelNoPrizes }}</p></div>
					</div>
				</section>
				<section :class="$style.section"><h2>{{ t.tasks }}</h2><div :class="$style.ruleGrid"><div v-for="key in ruleKeys" :key="key" :class="$style.rule"><label :class="$style.ruleTitle"><input v-model="draft.settings[key].enabled" type="checkbox" :disabled="saving"/>{{ t[key] }}</label><div :class="$style.fields"><label>{{ t.threshold }}<input v-model.number="draft.settings[key].threshold" type="number" min="1" max="1000000" step="1" required :disabled="saving" :data-testid="`lottery-${key}-threshold`"/></label><label>{{ t.tickets }}<input v-model.number="draft.settings[key].tickets" type="number" min="1" max="1000" step="1" required :disabled="saving"/></label></div></div></div><label :class="$style.mode">{{ t.likesMode }}<select v-model="draft.settings.likesMode" :disabled="saving"><option value="work">{{ t.workLikes }}</option><option value="total">{{ t.totalLikes }}</option></select></label></section>
				<section :class="$style.section"><div :class="$style.header"><h2>{{ t.prizes }}</h2><button type="button" :class="$style.secondary" :disabled="saving || draft.settings.prizes.length >= 30" @click="addPrize"><i class="ti ti-plus" aria-hidden="true"></i>{{ t.addPrize }}</button></div><p :class="$style.hint">{{ t.probabilityHint }}</p><p :class="$style.probabilityTotal" :data-valid="probabilityTotal === 100" role="status">{{ t.probabilityTotal }} <strong data-testid="probability-total">{{ probabilityTotal.toFixed(2) }}%</strong></p><p :class="$style.hint">{{ t.prizeHint }}</p><div :class="$style.prizes"><article v-for="(prize, index) in draft.settings.prizes" :key="prize.id" :class="$style.prize" :data-testid="`prize-editor-${index}`"><div :class="$style.prizeHeading"><label><input v-model="prize.enabled" type="checkbox" :disabled="saving" @change="probabilitiesEdited = true"/>{{ t.prizeEnabled }}</label><button type="button" :class="$style.link" :disabled="saving" :aria-label="`${t.remove} ${prize.name || index + 1}`" @click="removePrize(index)">{{ t.remove }}</button></div><div :class="$style.fields"><label>{{ t.prizeName }}<input v-model="prize.name" maxlength="80" required :disabled="saving"/></label><label>{{ t.kind }}<select v-model="prize.kind" :disabled="saving" @change="prize.amountCents = prize.kind === 'empty' ? 0 : 50"><option value="balance">{{ t.custom }}</option><option value="empty">{{ t.none }}</option></select></label><label v-if="prize.kind === 'balance'">{{ t.amount }}<input :value="prize.amountCents / 100" type="number" min="0.01" max="10000" step="0.01" required :disabled="saving" @input="prize.amountCents = Math.round(Number(($event.target as HTMLInputElement).value) * 100)"/></label><label>{{ t.probabilityInput }}<input v-model.number="percentages[prize.id]" type="number" min="0" max="100" step="0.01" required :disabled="saving || !prize.enabled" :data-testid="`prize-probability-${index}`" @input="probabilitiesEdited = true"/></label><label>{{ t.stock }}<input v-model.number="prize.stock" type="number" min="-1" max="1000000" step="1" required :disabled="saving"/></label><div :class="$style.odds"><span>{{ t.probability }}</span><strong>{{ probability(prize) }}%</strong></div></div><label :class="$style.description">{{ t.description }}<textarea v-model="prize.description" rows="2" maxlength="500" :disabled="saving"></textarea></label></article></div><p v-if="!draft.settings.prizes.length" :class="$style.empty">{{ t.emptyPool }}</p></section>
				<p v-if="saveError" :class="$style.error" role="alert">{{ saveError }}</p><p v-if="saved" role="status" :class="$style.saved">{{ t.saved }}</p><footer :class="$style.saveBar"><button type="submit" :class="$style.primary" :disabled="saving">{{ saving ? t.saving : t.save }}</button><button type="button" :class="$style.secondary" :disabled="saving" @click="reload">{{ t.reload }}</button></footer>
			</form>
			<section :class="$style.section"><div :class="$style.header"><h2>{{ t.allHistory }}</h2><button type="button" :class="$style.secondary" :disabled="recordsBusy" @click="loadRecords(false)">{{ t.refresh }}</button></div><p :class="$style.hint">{{ t.fulfillHint }}</p><p v-if="recordsError" role="alert">{{ t.historyFailed }}</p><p v-else-if="!records.length" :class="$style.empty">{{ t.noAdminHistory }}</p><article v-for="record in records" :key="record.id" :class="$style.record"><div><MkA :to="`/@${record.username}`">@{{ record.username || record.userId }}</MkA><time :datetime="record.createdAt">{{ new Date(record.createdAt).toLocaleString(homeLanguage) }}</time><code>{{ record.id }}</code></div><ul><li v-for="(prize, index) in record.prizes" :key="index"><strong>{{ prize.name }}</strong><span>{{ prize.status === 'fulfilled' ? t.fulfilled : prize.status === 'empty' ? t.empty : t.pending }}</span><small v-if="prize.amountCents">${{ (prize.amountCents / 100).toFixed(2) }}</small></li></ul><button v-if="record.prizes.some(p => p.status === 'pending')" type="button" :class="$style.secondary" :disabled="!!retrying" @click="retryCredit(record)">{{ t.fulfill }}</button></article><p v-if="creditError" role="alert">{{ t.fulfillFailed }}</p><button v-if="cursor" type="button" :class="$style.secondary" :disabled="recordsBusy" @click="loadRecords(true)">{{ t.more }}</button></section>
		</template>
	</div>
</PageWithHeader>
</template>

<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, toRaw, computed, watch } from 'vue';
import type { Endpoints } from 'misskey-js';
import LotteryWheel from '@/pages/community/LotteryWheel.vue';
import { defaultWheelSettings, wheelThemes, lotteryPercentages } from '@/pages/community/lottery-wheel.js';
import { lotteryText as t } from '@/pages/community/lottery-copy.js';
import { homeLanguage } from '@/pages/home/copy.js';
import { $i } from '@/i.js';
import { definePage } from '@/page.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import * as os from '@/os.js';

type Config = Endpoints['admin/community/lottery/config']['res'];
type Record = Endpoints['admin/community/lottery/records']['res']['items'][number];
const ruleKeys = ['invites', 'likes', 'followers'] as const;
const draft = ref<Config>();
const percentages = ref<{ [id: string]: number }>({});
const probabilitiesEdited = ref(false);
const probabilityTotal = computed(() => (draft.value?.settings.prizes.filter(p => p.enabled).reduce((sum, p) => sum + Math.round(Number(percentages.value[p.id] ?? 0) * 100), 0) ?? 0) / 100);
const previewPrizes = computed(() => draft.value?.settings.prizes.filter(prize => prize.enabled) ?? []);
const loading = ref(false), saving = ref(false), saved = ref(false), saveError = ref('');
watch([draft, percentages], () => { saved.value = false; }, { deep: true, flush: 'sync' });
const records = ref<Record[]>([]), cursor = ref<string | null>(null), recordsBusy = ref(false), recordsError = ref(false), retrying = ref(''), creditError = ref(false);
let active = true, generation = 0;
let controller = new AbortController();

function signal() { return AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]); }

async function load() {
	if (!$i?.isAdmin || loading.value) return;
	const current = generation;
	loading.value = true;
	try { const data = await misskeyApi('admin/community/lottery/config', {}, undefined, signal()); if (active && current === generation) { draft.value = structuredClone({ ...data, settings: { ...data.settings, wheel: data.settings.wheel ?? defaultWheelSettings() } }); percentages.value = lotteryPercentages(data.settings.prizes); probabilitiesEdited.value = false; saveError.value = ''; saved.value = false; } } catch { if (active && current === generation) saveError.value = t.loadFailed; } finally { if (current === generation) loading.value = false; }
}

async function reload() { const { canceled } = await os.confirm({ type: 'warning', text: t.reloadConfirm }); if (!canceled && active) await load(); }

function addPrize() {
	if (!draft.value || saving.value) return;
	const id = crypto.randomUUID();
	draft.value.settings.prizes.push({ id, name: '', description: '', amountCents: 50, kind: 'balance', weight: 1, stock: -1, enabled: true });
	percentages.value[id] = 0; probabilitiesEdited.value = true; saved.value = false;
}

function removePrize(index: number) {
	if (!draft.value || saving.value) return;
	const [removed] = draft.value.settings.prizes.splice(index, 1);
	delete percentages.value[removed.id]; probabilitiesEdited.value = true;
}

function probability(prize: Config['settings']['prizes'][number]) {
	const weight = (p: typeof prize) => probabilitiesEdited.value ? Number(percentages.value[p.id] ?? 0) : p.weight;
	const total = draft.value?.settings.prizes.filter(p => p.enabled && p.stock !== 0).reduce((n, p) => n + weight(p), 0) ?? 0;
	return (total && prize.enabled && prize.stock !== 0 ? weight(prize) / total * 100 : 0).toFixed(2);
}

async function save() {
	if (!draft.value || saving.value) return;
	const payload = structuredClone(toRaw(draft.value));
	if (probabilitiesEdited.value) {
		const enabled = payload.settings.prizes.filter(p => p.enabled);
		if (enabled.length && (probabilityTotal.value !== 100 || enabled.some(p => { const value = Number(percentages.value[p.id]); return !Number.isFinite(value) || value < .01 || value > 100 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7; }))) {
			saveError.value = t.probabilityInvalid; return;
		}
		for (const prize of enabled) prize.weight = Math.round(percentages.value[prize.id] * 100);
	}
	const current = generation;
	saving.value = true; saveError.value = ''; saved.value = false;
	try { const data = await misskeyApi('admin/community/lottery/update', payload, undefined, signal()); if (active && current === generation) { draft.value = structuredClone({ ...data, settings: { ...data.settings, wheel: data.settings.wheel ?? defaultWheelSettings() } }); percentages.value = lotteryPercentages(data.settings.prizes); probabilitiesEdited.value = false; saved.value = true; } } catch (error) { if (active && current === generation) { const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''; saveError.value = code === 'LOTTERY_CONFLICT' ? t.conflict : code === 'LOTTERY_UNAVAILABLE' ? t.creditUnavailable : ['INVALID_PARAM', 'LOTTERY_INVALID'].includes(code) ? t.invalid : t.saveFailed; } } finally { if (current === generation) saving.value = false; }
}

async function loadRecords(more: boolean) {
	if (!$i?.isAdmin || recordsBusy.value) return;
	const current = generation;
	recordsBusy.value = true; recordsError.value = false;
	try { const data = await misskeyApi('admin/community/lottery/records', { untilId: more ? cursor.value ?? undefined : undefined }, undefined, signal()); if (active && current === generation) { records.value = more ? [...records.value, ...data.items] : data.items; cursor.value = data.nextCursor; } } catch { if (active && current === generation) recordsError.value = true; } finally { if (current === generation) recordsBusy.value = false; }
}

async function retryCredit(record: Record) {
	if (retrying.value) return;
	const { canceled } = await os.confirm({ type: 'question', text: t.fulfillConfirm });
	if (canceled || !active) return;
	const current = generation;
	retrying.value = record.id; creditError.value = false;
	try { await misskeyApi('admin/community/lottery/fulfill', { drawId: record.id }, undefined, signal()); if (active && current === generation) await loadRecords(false); } catch { if (active && current === generation) creditError.value = true; } finally { if (current === generation) retrying.value = ''; }
}

onMounted(() => { void load(); void loadRecords(false); });

function deactivate() { active = false; generation++; controller.abort(); loading.value = false; saving.value = false; recordsBusy.value = false; retrying.value = ''; }

onActivated(() => { if (active) return; active = true; controller = new AbortController(); if (!draft.value) void load(); void loadRecords(false); });
onDeactivated(deactivate);
onBeforeUnmount(deactivate);
definePage(() => ({ title: t.adminTitle, icon: 'ti ti-gift' }));
</script>

<style lang="scss" module>
.page { max-width: 1200px; margin-inline: auto; padding: 28px 32px 56px; font-variant-numeric: tabular-nums; --muted: color-mix(in srgb, var(--MI_THEME-fg) 72%, var(--MI_THEME-panel)); }
.page h1 { margin: 0 0 8px; font-size: 26px; }.page h2 { margin: 0; font-size: 18px; }.page button, .page input, .page select, .page textarea { font: inherit; }.page button { cursor: pointer; }.page :disabled { opacity: .65; cursor: not-allowed; }.page :is(input, select, textarea, button, a):focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }.page input[type='checkbox'] { width: 18px; height: 18px; accent-color: var(--MI_THEME-accent); }
.header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }.header p, .hint { color: var(--muted); font-size: 13px; line-height: 1.7; margin: 10px 0 20px; }.link { background: none; border: 0; padding: 0; color: var(--MI_THEME-accent); font-size: 13px; text-decoration: none; }
.enableRow { margin-top: 24px; padding: 20px; background: var(--MI_THEME-panel); border: 1px solid var(--MI_THEME-divider); border-radius: 12px; display: grid; gap: 12px; }.enableRow label, .ruleTitle, .prizeHeading label { display: flex; align-items: center; gap: 10px; font-weight: 600; }.enableRow span { font-size: 13px; color: var(--muted); line-height: 1.7; }
.section { margin-top: 32px; }.ruleGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-top: 20px; }.rule { min-width: 0; }.ruleTitle { margin-bottom: 14px; }.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }.fields label, .mode, .description { display: grid; gap: 8px; font-size: 13px; }.fields input, .fields select, .description textarea, .mode select { min-width: 0; width: 100%; box-sizing: border-box; padding: 10px 12px; min-height: 42px; border: 1px solid var(--MI_THEME-divider); border-radius: 8px; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); }.mode { margin-top: 20px; max-width: 340px; }
.prizes { display: grid; gap: 16px; }.prize { border: 1px solid var(--MI_THEME-divider); background: var(--MI_THEME-panel); border-radius: 12px; padding: 20px; }.prizeHeading { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 20px; font-size: 14px; }.prize .fields { grid-template-columns: repeat(3, minmax(0, 1fr)); }.odds { display: flex; flex-direction: column; justify-content: space-between; padding-block: 0 12px; font-size: 13px; }.odds strong { font-size: 20px; color: var(--MI_THEME-accent); }.description { margin-top: 16px; }.description textarea { resize: vertical; }
.primary, .secondary { min-height: 42px; padding: 10px 18px; border: 1px solid var(--MI_THEME-divider); border-radius: 8px; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); display: inline-flex; align-items: center; justify-content: center; gap: 8px; }.primary { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); border-color: var(--MI_THEME-accent); }.saveBar { margin-top: 24px; display: flex; gap: 12px; }.saved { color: var(--MI_THEME-accent); }.error { padding: 14px; border: 1px solid var(--MI_THEME-divider); border-radius: 8px; line-height: 1.7; }.empty { padding: 30px 0; text-align: center; color: var(--muted); font-size: 13px; }
.record { display: grid; grid-template-columns: 210px 1fr auto; align-items: start; gap: 20px; padding: 18px 0; border-bottom: 1px solid var(--MI_THEME-divider); }.record > div { display: grid; gap: 6px; font-size: 14px; }.record time, .record code { color: var(--muted); font-size: 12px; }.record ul { padding: 0; margin: 0; list-style: none; }.record li { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; font-size: 13px; }.record li span { color: var(--muted); }.record li small { margin-left: auto; font-size: 13px; }.record button { font-size: 12px; }.section > button { margin-top: 16px; }
@media (max-width: 800px) { .ruleGrid { grid-template-columns: 1fr; gap: 24px; }.prize .fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }.record { grid-template-columns: 1fr; gap: 12px; } }
@media (max-width: 500px) { .page { padding: 20px 14px 40px; }.header { align-items: flex-start; flex-wrap: wrap; }.page h1 { font-size: 24px; }.prize { padding: 16px; }.prize .fields { grid-template-columns: 1fr; }.odds { gap: 8px; }.saveBar { flex-wrap: wrap; } }

.designLayout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, .85fr); align-items: start; gap: 40px; }
.designFields { min-width: 0; }.designPreview { background: color-mix(in srgb, var(--MI_THEME-accent) 4%, var(--MI_THEME-panel)); border-radius: 12px; padding: 24px; min-width: 0; text-align: center; }
.designPreview h3 { margin: 0 0 8px; font-size: 22px; overflow-wrap: anywhere; }.designPreview > p { font-size: 13px; line-height: 1.7; color: var(--muted); margin: 0 0 24px; overflow-wrap: anywhere; }.designPreview > p:last-child { margin: 18px 0 0; }
.themes { display: flex; gap: 10px; flex-wrap: wrap; padding: 0; margin: 0 0 22px; border: 0; }.themes legend { margin-bottom: 12px; font-size: 13px; }.themes label { min-height: 44px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--MI_THEME-divider); border-radius: 8px; padding: 8px 12px; font-size: 13px; cursor: pointer; }.themes .chosenTheme { border-color: var(--MI_THEME-accent); background: color-mix(in srgb, var(--MI_THEME-accent) 8%, var(--MI_THEME-panel)); }.themes span { width: 18px; height: 18px; border-radius: 50%; }.themes input { margin: 0; accent-color: var(--MI_THEME-accent); }
@media (max-width: 800px) { .designLayout { grid-template-columns: minmax(0, 1fr); gap: 20px; }.designPreview { max-width: 460px; width: 100%; box-sizing: border-box; margin-inline: auto; }.designFields .fields { grid-template-columns: minmax(0, 1fr); } }
.probabilityTotal { display: flex; align-items: baseline; gap: 12px; font-size: 14px; }.probabilityTotal strong { font-size: 22px; }.probabilityTotal[data-valid="false"] strong { color: var(--MI_THEME-error); }
</style>
