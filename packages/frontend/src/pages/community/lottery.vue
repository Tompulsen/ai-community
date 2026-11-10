<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="[]">
	<div :class="$style.page" data-testid="lottery-page">
		<header :class="$style.heading">
			<div><MkA to="/community" :class="$style.back"><i class="ti ti-arrow-left" aria-hidden="true"></i> {{ t.back }}</MkA><h1><i class="ti ti-gift" aria-hidden="true"></i>{{ t.title }}</h1><p>{{ t.intro }}</p></div>
			<div :class="$style.actions"><MkA v-if="$i?.isAdmin" to="/admin/community-lottery" :class="$style.link">{{ t.adminTitle }}</MkA><button type="button" :class="$style.iconButton" :disabled="loading || busy" :aria-label="t.refresh" @click="load"><i class="ti ti-refresh" aria-hidden="true"></i></button></div>
		</header>
		<p v-if="loading && !state" role="status">{{ t.loading }}</p>
		<div v-if="loadError" :class="$style.notice" role="alert">{{ t.loadFailed }} <button type="button" :class="$style.link" @click="load">{{ t.retry }}</button></div>
		<template v-if="state">
			<section :class="$style.drawPanel" :aria-busy="busy">
				<div :class="$style.drawTop"><div :class="$style.balance"><span>{{ t.available }}</span><strong>{{ state.balance }}<small>{{ t.times }}</small></strong></div>
					<div :class="$style.drawActions"><div v-if="$i" :class="$style.segments" role="group" :aria-label="t.available"><button v-for="n in drawCounts" :key="n" type="button" :aria-pressed="count === n" :disabled="busy || !!pending" @click="count = n">×{{ n }}</button></div><button type="button" :class="$style.primary" :disabled="!$i ? false : busy || loading || loadError || (!pending && (!canDraw || !state.accountLinked || state.balance < count))" data-testid="lottery-draw" @click="$i ? draw() : login()"><i class="ti ti-gift" aria-hidden="true"></i>{{ !$i ? t.login : busy ? t.drawing : pending ? t.checkResult : t.draw }}</button></div>
				</div>
				<p v-if="!state.settings.enabled" :class="$style.hint">{{ t.paused }}</p><p v-else-if="!canDraw" :class="$style.hint">{{ t.emptyPool }}</p><p v-else-if="!$i" :class="$style.hint">{{ t.loginHint }}</p><p v-else-if="!state.accountLinked" :class="$style.hint">{{ t.accountRequired }} <MkA to="/create/text" :class="$style.link">{{ t.linkAccount }}</MkA></p><p v-else-if="!state.balance" :class="$style.hint">{{ t.noChances }}</p>
				<div v-if="state.settings.prizes.length" ref="viewport" :class="$style.reel" aria-hidden="true"><span :class="$style.pointer"></span><div ref="track" :class="$style.track"><div v-for="(prize, index) in reel" :key="index" :class="[$style.reelCard, { [$style.winner]: result && index === winnerIndex }]" :style="{ '--prize-color': prize.kind === 'empty' ? 'var(--MI_THEME-fg)' : 'var(--MI_THEME-accent)' }"><i :class="prize.kind === 'empty' ? 'ti ti-sparkles' : 'ti ti-gift'" aria-hidden="true"></i><strong>{{ prize.kind === 'balance' ? `$${(prize.amountCents / 100).toFixed(2)}` : prize.name }}</strong><span>{{ prize.name }}</span></div></div></div>
				<p v-if="state.settings.prizes.length" :class="$style.caption">{{ t.animationHint }}</p>
				<div v-if="drawError" :class="$style.notice" role="alert">{{ drawError }}</div>
				<section v-if="result" :class="$style.result" role="status" aria-live="polite" data-testid="lottery-result"><h2>{{ t.result }}</h2><ul><li v-for="(prize, index) in result.prizes" :key="index"><strong>{{ prize.name }}</strong><span>{{ statusText(prize.status) }}</span></li></ul><p>{{ t.resultHint }}</p></section>
			</section>
			<section :class="$style.tasks"><h2>{{ t.tasks }}</h2><div :class="$style.taskGrid"><div v-for="key in ruleKeys" :key="key" :class="$style.task"><h3><i :class="`ti ti-${key === 'invites' ? 'user-plus' : key === 'likes' ? 'heart' : 'users'}`" aria-hidden="true"></i>{{ t[key] }}</h3><p v-if="state.settings[key].enabled">{{ t.each }} <strong>{{ state.settings[key].threshold }}</strong> {{ key === 'likes' ? t.likesUnit : t.people }}，{{ t.reward }} <strong>{{ state.settings[key].tickets }}</strong> {{ t.times }}</p><p v-else>{{ t.disabled }}</p><small v-if="key === 'likes'">{{ state.settings.likesMode === 'work' ? t.workLikes : t.totalLikes }}</small><div :class="$style.progress"><span>{{ key === 'likes' && state.settings.likesMode === 'work' ? t.bestWork : t.current }} <b>{{ key === 'likes' && state.settings.likesMode === 'work' ? state.counts.bestWorkLikes : state.counts[key] }}</b></span><span>{{ t.earned }} <b>{{ state.earned[key] }}</b> {{ t.times }}</span></div></div></div>
				<p :class="$style.hint">{{ t.inviteHint }}</p><div v-if="state.inviteUrl" :class="$style.copyRow"><label :class="$style.srOnly" for="lottery-invite">{{ t.link }}</label><input id="lottery-invite" :value="state.inviteUrl" readonly @focus="($event.target as HTMLInputElement).select()"/><button type="button" :aria-label="t.copy" @click="copyInvite"><i class="ti ti-copy" aria-hidden="true"></i><span>{{ copied ? t.copied : t.copy }}</span></button></div><div v-else :class="$style.actions"><button type="button" :class="$style.secondary" @click="login">{{ t.login }}</button><button type="button" :class="$style.link" @click="signup">{{ t.signup }}</button></div><p v-if="copyError" role="status">{{ t.copyFailed }}</p>
			</section>
			<section><div :class="$style.sectionHeading"><h2>{{ t.prizes }}</h2><span>{{ t.probability }}</span></div><div v-if="state.settings.prizes.length" :class="$style.prizeGrid"><article v-for="prize in state.settings.prizes" :key="prize.id" :class="$style.prize"><div><span :class="$style.caption">{{ prize.kind === 'empty' ? t.none : t.custom }}</span><h3>{{ prize.name }}</h3><strong v-if="prize.kind === 'balance'" :class="$style.amount">${{ (prize.amountCents / 100).toFixed(2) }} <small>USD</small></strong><p>{{ prize.description }}</p></div><footer><span>{{ prize.stock === -1 ? t.unlimited : prize.stock === 0 ? t.soldOut : `${t.remaining} ${prize.stock}` }}</span><strong>{{ probability(prize) }}%</strong></footer></article></div><p v-else :class="$style.empty">{{ t.emptyPool }}</p><p :class="$style.caption">{{ t.stockHint }}</p></section>
			<details :class="$style.rules"><summary><i class="ti ti-info-circle" aria-hidden="true"></i>{{ t.rules }}</summary><p>{{ t.rulesBody }}</p></details>
			<section v-if="$i" :class="$style.history"><h2><i class="ti ti-history" aria-hidden="true"></i>{{ t.history }}</h2><div v-if="historyError" role="alert">{{ t.historyFailed }} <button type="button" :class="$style.link" @click="loadHistory(false)">{{ t.retry }}</button></div><p v-else-if="!records.length" :class="$style.empty">{{ t.noHistory }}</p><article v-for="record in records" :key="record.id" :class="$style.historyRow"><time :datetime="record.createdAt">{{ formatDate(record.createdAt) }}</time><div><div v-for="(prize, index) in record.prizes" :key="index" :class="$style.historyPrize"><strong>{{ prize.name }}</strong><span :class="$style.status">{{ statusText(prize.status) }}</span><p v-if="prize.note">{{ t.historyNote }}：{{ prize.note }}</p></div></div></article><button v-if="cursor" type="button" :class="$style.secondary" :disabled="historyBusy" @click="loadHistory(true)">{{ t.more }}</button></section>
		</template>
	</div>
</PageWithHeader>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';
import type { Endpoints } from 'misskey-js';
import { lotteryText as t } from './lottery-copy.js';
import { $i } from '@/i.js';
import { prefer } from '@/preferences.js';
import { homeLanguage } from '@/pages/home/copy.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { rememberLotteryInvite } from '@/utility/lottery-invite.js';
import { definePage } from '@/page.js';
import * as os from '@/os.js';

type Status = Endpoints['community/lottery/status']['res'];
type Draw = Endpoints['community/lottery/draw']['res'];
type Prize = Status['settings']['prizes'][number];
const drawCounts = [1, 3, 5] as const;
const ruleKeys = ['invites', 'likes', 'followers'] as const;
const state = ref<Status>();
const records = ref<Draw[]>([]);
const cursor = ref<string | null>(null);
const loading = ref(false), loadError = ref(false), busy = ref(false), historyBusy = ref(false), historyError = ref(false);
const copied = ref(false), copyError = ref(false), drawError = ref(''), count = ref<1 | 3 | 5>(1), result = ref<Draw>();
const viewport = ref<HTMLElement>(), track = ref<HTMLElement>();
const reel = ref<Prize[]>([]), winnerIndex = ref(-1);
const pending = ref<Endpoints['community/lottery/draw']['req']>();
let active = true, mounted = false, generation = 0;
let animation: Animation | undefined;
const controllers = new Set<AbortController>();
const storageKey = `community-lottery-pending:${$i?.id ?? ''}`;
const canDraw = computed(() => state.value?.settings.enabled && state.value.creditReady && state.value.settings.prizes.some(p => p.stock !== 0 && p.weight > 0));
const formatDate = (date: string) => new Date(date).toLocaleString(homeLanguage);
const statusText = (status: string) => status === 'fulfilled' ? t.fulfilled : status === 'empty' ? t.empty : t.pending;

async function request<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
	const controller = new AbortController(); controllers.add(controller);
	try { return await fn(AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])); } finally { controllers.delete(controller); }
}

function rememberPending() { try { if (pending.value) sessionStorage.setItem(storageKey, JSON.stringify(pending.value)); else sessionStorage.removeItem(storageKey); } catch { /* In-memory retry still preserves the request until navigation. */ } }

function resetReel() { const prizes = state.value?.settings.prizes ?? []; reel.value = Array.from({ length: prizes.length ? Math.max(10, prizes.length) : 0 }, (_, i) => prizes[i % prizes.length]); if (track.value) track.value.style.transform = 'translateX(0)'; winnerIndex.value = -1; }

function probability(prize: Prize) { const total = state.value?.settings.prizes.filter(p => p.stock !== 0).reduce((n, p) => n + p.weight, 0) ?? 0; return (total && prize.stock !== 0 ? prize.weight / total * 100 : 0).toFixed(2); }

async function load() {
	if (loading.value || busy.value) return;
	const current = generation;
	loading.value = true; loadError.value = false;
	try { const data = await request(signal => misskeyApi('community/lottery/status', {}, undefined, signal)); if (active && current === generation) { state.value = data; if (!result.value) resetReel(); } } catch { if (active && current === generation) loadError.value = true; } finally { if (current === generation) loading.value = false; }
	if (active && current === generation && $i) void loadHistory(false);
}

async function loadHistory(more: boolean) {
	if (!$i || historyBusy.value) return;
	const current = generation;
	historyBusy.value = true; historyError.value = false;
	try { const data = await request(signal => misskeyApi('community/lottery/records', { untilId: more ? cursor.value ?? undefined : undefined }, undefined, signal)); if (active && current === generation) { records.value = more ? [...records.value, ...data.items] : data.items; cursor.value = data.nextCursor; } } catch { if (active && current === generation) historyError.value = true; } finally { if (current === generation) historyBusy.value = false; }
}

async function draw() {
	if (!$i || busy.value || !state.value) return;
	if (!pending.value && (!canDraw.value || !state.value.accountLinked || state.value.balance < count.value)) return;
	const current = generation;
	busy.value = true; drawError.value = ''; result.value = undefined;
	if (!pending.value) pending.value = { requestId: crypto.randomUUID(), count: count.value };
	rememberPending();
	try {
		const data = await request(signal => misskeyApi('community/lottery/draw', pending.value!, undefined, signal));
		if (!active || current !== generation) return;
		const prizes = state.value.settings.prizes;
		const winner = data.prizes[data.prizes.length - 1];
		const stop: Prize = { id: winner.prizeId, name: winner.name, description: winner.description, stock: -1, weight: 1, enabled: true, amountCents: winner.amountCents, kind: winner.status === 'empty' ? 'empty' : 'balance' };
		reel.value = [...Array.from({ length: 28 }, (_, i) => prizes[i % prizes.length] ?? stop), stop, ...Array.from({ length: 5 }, (_, i) => prizes[i % prizes.length] ?? stop)];
		winnerIndex.value = 28;
		await nextTick();
		const card = track.value?.children[28] as HTMLElement | undefined;
		if (track.value && viewport.value && card) {
			const target = viewport.value.clientWidth / 2 - card.offsetLeft - card.offsetWidth / 2;
			animation?.cancel();
			if (prefer.s.animation && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
				animation = track.value.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${target}px)` }], { duration: 2800, easing: 'cubic-bezier(.12,.65,.12,1)', fill: 'forwards' });
				await animation.finished.catch(() => {});
			}
			if (active && current === generation) { track.value.style.transform = `translateX(${target}px)`; animation?.cancel(); }
		}
		if (!active || current !== generation) return;
		result.value = data; pending.value = undefined; rememberPending();
	} catch (error) {
		if (!active || current !== generation) return;
		const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
		if (['LOTTERY_ACCOUNT_REQUIRED', 'LOTTERY_INSUFFICIENT', 'LOTTERY_UNAVAILABLE', 'LOTTERY_INVALID', 'LOTTERY_FORBIDDEN', 'INVALID_PARAM'].includes(code)) { pending.value = undefined; rememberPending(); drawError.value = code === 'LOTTERY_ACCOUNT_REQUIRED' ? t.accountRequired : code === 'LOTTERY_INSUFFICIENT' ? t.insufficient : t.drawFailed; } else drawError.value = t.uncertain;
	} finally { if (current === generation) { busy.value = false; if (active) void load(); } }
}

async function copyInvite() { if (!state.value?.inviteUrl) return; copyError.value = false; try { await navigator.clipboard.writeText(state.value.inviteUrl); if (active) copied.value = true; } catch { if (active) copyError.value = true; } }

function login() { const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkSigninDialog.vue')), { autoSet: true }, { closed: () => dispose() }); }

function signup() { const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkSignupDialog.vue')), { autoSet: true }, { closed: () => dispose() }); }

function deactivate() { active = false; generation++; loading.value = false; busy.value = false; historyBusy.value = false; animation?.cancel(); for (const c of controllers) c.abort(); }

onMounted(() => { mounted = true; rememberLotteryInvite(); try { const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'); if (saved && /^[a-zA-Z0-9_-]{16,64}$/.test(saved.requestId) && [1, 3, 5].includes(saved.count)) { pending.value = saved; count.value = saved.count; } } catch { /* Ignore invalid local state. */ } void load(); });
onActivated(() => { const wasInactive = !active; active = true; if (mounted && wasInactive) void load(); });
onDeactivated(deactivate);
onBeforeUnmount(deactivate);
definePage(() => ({ title: t.title, icon: 'ti ti-gift', needWideArea: true }));
</script>

<style lang="scss" module>
.page { max-width: 1240px; margin-inline: auto; padding: 28px 32px 56px; color: var(--MI_THEME-fg); --lottery-muted: color-mix(in srgb, var(--MI_THEME-fg) 72%, var(--MI_THEME-panel)); font-variant-numeric: tabular-nums; }
.page button, .page input { font: inherit; }
.page button { cursor: pointer; }
.page button:disabled { cursor: not-allowed; opacity: .65; }
.page :is(button, input, a, summary):focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
.heading, .actions, .drawTop, .drawActions, .sectionHeading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.heading { margin-bottom: 26px; align-items: flex-start; }
.heading h1 { display: flex; gap: 12px; align-items: center; font-size: 30px; margin: 20px 0 8px; letter-spacing: -.025em; }
.heading h1 i { color: var(--MI_THEME-accent); }
.heading p { margin: 0; color: var(--lottery-muted); }
.back, .link { color: var(--MI_THEME-accent); background: none; border: 0; text-decoration: none; font-size: 13px; padding: 0; }
.back { color: var(--lottery-muted); }
.iconButton { width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid var(--MI_THEME-divider); background: var(--MI_THEME-panel); color: inherit; border-radius: 8px; }
.drawPanel { padding: 24px; border-radius: 12px; background: color-mix(in srgb, var(--MI_THEME-accent) 4%, var(--MI_THEME-panel)); }
.balance { display: grid; gap: 8px; }
.balance > span { font-size: 13px; color: var(--lottery-muted); }
.balance strong { font-size: 36px; color: var(--MI_THEME-accent); line-height: 1; }
.balance small { margin-left: 10px; font-size: 13px; font-weight: 400; color: var(--lottery-muted); }
.primary, .secondary { border-radius: 8px; padding: 12px 20px; min-height: 44px; border: 1px solid transparent; display: inline-flex; align-items: center; justify-content: center; gap: 9px; }
.primary { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-weight: 600; }
.secondary { background: var(--MI_THEME-panel); border-color: var(--MI_THEME-divider); color: inherit; }
.primary:active:not(:disabled) { transform: translateY(1px); }
.segments { display: flex; background: var(--MI_THEME-panel); border: 1px solid var(--MI_THEME-divider); border-radius: 8px; padding: 3px; }
.segments button { border: 0; background: none; color: var(--lottery-muted); border-radius: 5px; min-width: 44px; height: 36px; }
.segments [aria-pressed='true'] { background: color-mix(in srgb, var(--MI_THEME-accent) 10%, var(--MI_THEME-panel)); color: var(--MI_THEME-accent); font-weight: 600; }
.hint { color: var(--lottery-muted); font-size: 13px; line-height: 1.75; margin: 16px 0; }
.reel { overflow: hidden; position: relative; padding: 16px 0 12px; margin-top: 14px; }
.track { display: flex; gap: 12px; position: relative; will-change: transform; }
.reelCard { flex: 0 0 152px; box-sizing: border-box; min-height: 150px; background: var(--MI_THEME-panel); border: 1px solid var(--MI_THEME-divider); border-bottom: 3px solid var(--prize-color); border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 18px 10px; gap: 10px; text-align: center; }
.reelCard i { font-size: 25px; color: var(--prize-color); }
.reelCard strong { font-size: 20px; overflow-wrap: anywhere; color: var(--prize-color); }
.reelCard span { font-size: 12px; color: var(--lottery-muted); line-height: 1.5; max-height: 36px; overflow: hidden; }
.winner { background: color-mix(in srgb, var(--MI_THEME-accent) 8%, var(--MI_THEME-panel)); border-color: var(--MI_THEME-accent); }
.pointer { position: absolute; z-index: 1; left: calc(50% - 8px); top: 0; width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-top: 14px solid var(--MI_THEME-accent); }
.amount { display: block; color: var(--MI_THEME-accent); margin-top: 10px; font-size: 26px; }.amount small { font-size: 12px; font-weight: 400; color: var(--lottery-muted); }
.caption { font-size: 12px; color: var(--lottery-muted); line-height: 1.7; }
.notice { padding: 14px; border-radius: 8px; border: 1px solid var(--MI_THEME-divider); background: var(--MI_THEME-panel); line-height: 1.7; margin-block: 12px; }
.result { background: var(--MI_THEME-panel); padding: 18px; margin-top: 16px; border-radius: 8px; }
.result h2 { margin-top: 0; }.result ul { list-style: none; padding: 0; margin: 0; }.result li { display: flex; justify-content: space-between; gap: 16px; padding-block: 8px; }.result p { font-size: 13px; color: var(--lottery-muted); }
.page h2 { font-size: 18px; margin: 0 0 20px; }.page h2 i { margin-right: 8px; }
.tasks { padding-block: 30px; }
.taskGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
.task h3 { font-size: 15px; margin: 0 0 12px; display: flex; align-items: center; gap: 8px; }.task p { font-size: 13px; line-height: 1.7; margin-block: 8px; }.task small { color: var(--lottery-muted); font-size: 12px; }.progress { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--lottery-muted); }.progress b { color: var(--MI_THEME-fg); }
.copyRow { display: flex; border: 1px solid var(--MI_THEME-divider); border-radius: 8px; background: var(--MI_THEME-panel); overflow: hidden; }.copyRow input { min-width: 0; width: 100%; padding: 14px; border: 0; background: transparent; color: inherit; font-size: 13px; }.copyRow button { flex-shrink: 0; padding: 12px 16px; background: transparent; color: inherit; border: 0; border-left: 1px solid var(--MI_THEME-divider); display: flex; align-items: center; gap: 8px; }
.sectionHeading { align-items: baseline; }.sectionHeading span { font-size: 12px; color: var(--lottery-muted); }
.prizeGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 16px; }.prize { background: var(--MI_THEME-panel); border: 1px solid var(--MI_THEME-divider); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; }.prize > div { padding: 18px; }.prize h3 { font-size: 24px; margin: 12px 0 8px; letter-spacing: -.02em; overflow-wrap: anywhere; }.prize p { font-size: 13px; color: var(--lottery-muted); margin: 0; line-height: 1.7; }.prize footer { padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: color-mix(in srgb, var(--MI_THEME-fg) 3%, var(--MI_THEME-panel)); font-size: 12px; }.prize footer strong { color: var(--MI_THEME-accent); }
.rules { border-block: 1px solid var(--MI_THEME-divider); margin-top: 24px; padding: 18px 0; }.rules summary { cursor: pointer; font-size: 13px; }.rules summary i { margin-right: 8px; }.rules p { max-width: 80ch; color: var(--lottery-muted); font-size: 13px; line-height: 1.8; }
.history { padding-top: 28px; }.empty { padding: 32px 0; color: var(--lottery-muted); font-size: 13px; text-align: center; }.historyRow { display: grid; grid-template-columns: 185px 1fr; gap: 20px; padding: 18px 0; border-bottom: 1px solid var(--MI_THEME-divider); }.historyRow time { color: var(--lottery-muted); font-size: 12px; }.historyPrize { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; padding-bottom: 6px; font-size: 14px; }.historyPrize p { width: 100%; margin: 0; font-size: 12px; color: var(--lottery-muted); overflow-wrap: anywhere; }.status { font-size: 12px; color: var(--lottery-muted); margin-left: auto; }.history > button { margin-top: 16px; }
.srOnly { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); overflow: hidden; white-space: nowrap; }
@media (max-width: 700px) { .page { padding: 20px 16px 40px; }.heading { gap: 10px; }.heading h1 { font-size: 25px; }.heading .actions { gap: 10px; flex-wrap: wrap; justify-content: flex-end; }.heading .actions > a { font-size: 12px; }.drawPanel { padding: 18px 14px; }.drawTop { align-items: flex-start; }.drawActions { flex-direction: column; align-items: stretch; gap: 10px; }.primary { padding: 12px; }.balance strong { font-size: 32px; }.reelCard { flex-basis: 132px; min-height: 140px; }.reelCard strong { font-size: 18px; }.taskGrid { grid-template-columns: minmax(0, 1fr); gap: 20px; }.task { padding-bottom: 16px; border-bottom: 1px solid var(--MI_THEME-divider); }.task h3 { margin-bottom: 6px; }.copyRow button span { display: none; }.historyRow { grid-template-columns: 1fr; gap: 10px; }.page h2 { font-size: 17px; }.prizeGrid { gap: 12px; } }
@media (prefers-reduced-motion: reduce) { .primary:active:not(:disabled) { transform: none; } }
</style>
