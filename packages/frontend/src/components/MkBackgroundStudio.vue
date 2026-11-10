<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<template>
<div v-if="$i && state.enabled" :class="[$style.host, { [$style.offscreen]: !studioAnchor }]" :style="frameStyle" :aria-hidden="!studioAnchor" :inert="!studioAnchor">
	<MkCommunityStudio ref="studio" :origin="origin" :kind="state.kind" :title="workbenchText.title" :active="true" :defaultModel="defaultModels[state.kind]" :defaultModels="defaultModels" :remix="manualRemix" @identity="state.identity = $event" @ready="ready" @state="connectionState" @background="receive" @remixApplied="manualRemix = undefined"/>
</div>
<aside v-if="$i && task" ref="floating" :class="[$style.floating, { [$style.hidden]: state.hidden, [$style.dragging]: dragging }]" :style="position" :aria-label="t.title" data-testid="background-task-window">
	<button v-if="state.hidden" type="button" class="_button" :class="$style.restore" data-testid="background-restore" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="cancelGesture" @lostpointercapture="cancelGesture" @contextmenu.prevent @click="activateTask"><i class="ti ti-sparkles" aria-hidden="true"></i>{{ t.tasks }} · {{ state.tasks.length }}</button>
	<template v-else>
		<div :class="$style.top"><span>{{ t.generating }} <span v-if="state.tasks.length > 1">{{ taskIndex + 1 }} / {{ state.tasks.length }}</span></span><button type="button" class="_button" :class="$style.iconButton" :aria-label="t.hide" @click="state.hidden = true"><i class="ti ti-minus" aria-hidden="true"></i></button></div>
		<button type="button" class="_button" :class="$style.handle" data-testid="background-task-handle" aria-describedby="background-gesture-hint" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="cancelGesture" @lostpointercapture="cancelGesture" @contextmenu.prevent @click="activateTask">
			<i :class="task.state === 'complete' ? 'ti ti-circle-check' : task.state === 'error' ? 'ti ti-alert-circle' : 'ti ti-loader'" aria-hidden="true"></i>
			<span><strong>{{ task.state === 'complete' ? t.complete : task.state === 'error' ? t.error : task.kind === 'video' ? t.videoRunning : t.imageRunning }}</strong><span :class="$style.taskTitle">{{ task.title || task.model }}</span></span><i class="ti ti-arrow-up-right" aria-hidden="true"></i>
		</button>
		<p v-if="task.message" :class="$style.error" role="status">{{ task.message }}</p>
		<div :class="$style.actions"><button v-if="task.state === 'complete'" type="button" class="_button" :class="$style.primary" data-testid="background-open-result" @click="preview(task)">{{ t.open }}</button><button type="button" class="_button" @click="openTask(task)">{{ t.studio }}</button><template v-if="state.tasks.length > 1"><button type="button" class="_button" :class="$style.iconButton" :aria-label="t.previous" @click="taskIndex = (taskIndex + state.tasks.length - 1) % state.tasks.length"><i class="ti ti-chevron-left" aria-hidden="true"></i></button><button type="button" class="_button" :class="$style.iconButton" :aria-label="t.next" @click="taskIndex = (taskIndex + 1) % state.tasks.length"><i class="ti ti-chevron-right" aria-hidden="true"></i></button></template></div>
		<p id="background-gesture-hint" :class="$style.hint">{{ t.hint }}</p>
	</template>
</aside>
<MkModalWindow v-if="previewTask" ref="previewModal" :width="820" :height="640" @close="closePreview" @esc="closePreview" @closed="clearPreview">
	<template #header>{{ t.previewTitle }}</template>
	<div :class="$style.preview" data-testid="background-result"><p v-if="!files.length && !previewError" role="status">{{ t.loading }}</p><p v-if="previewError" role="alert">{{ previewError }}</p><div v-for="(file, index) in files" :key="file.url"><video v-if="file.type.startsWith('video/')" :src="file.url" controls playsinline preload="metadata"></video><img v-else :src="file.url" :alt="previewTask.title || t.imageAlt"/><a :href="file.url" :download="file.name" :class="$style.download">{{ t.download }}{{ files.length > 1 ? ` ${index + 1}` : '' }}<i class="ti ti-download" aria-hidden="true"></i></a></div></div>
	<template #footer><div :class="$style.actions"><MkButton v-if="previewError" @click="preview(previewTask)">{{ t.retryOpen }}</MkButton><MkButton @click="closePreview">{{ t.close }}</MkButton><MkButton primary @click="openTask(previewTask); closePreview()">{{ t.goStudio }}</MkButton></div></template>
</MkModalWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { url as siteUrl } from '@@/js/config.js';
import MkCommunityStudio from './MkCommunityStudio.vue';
import MkModalWindow from './MkModalWindow.vue';
import MkButton from './MkButton.vue';
import type { BackgroundTask } from '@/utility/background-studio.js';
import { backgroundStudio as state, studioAnchor, pendingBackground, manualRemix, viewBackgroundTask } from '@/utility/background-studio.js';
import { creationPages, workbenchText } from '@/utility/creation-pages.js';
import { instance } from '@/instance.js';
import { backgroundText as t } from '@/utility/studio-copy.js';
import { serializeStudioRemix } from '@/utility/studio-remix.js';
import { $i } from '@/i.js';
import { useRouter } from '@/router.js';
import * as os from '@/os.js';

const origin = new URL(siteUrl).origin, router = useRouter();
const studio = ref<InstanceType<typeof MkCommunityStudio>>();
const defaultModels = computed<Record<string, string>>(() => Object.fromEntries(creationPages.map(item => [item.key, instance.clientOptions?.[item.modelKey] ?? item.defaultModel])));
const frameStyle = ref({ top: '0px', left: '0px', width: '1000px', height: '700px' });
const floating = ref<HTMLElement>();
const taskIndex = ref(0), task = computed(() => state.tasks[Math.min(taskIndex.value, state.tasks.length - 1)]);
const point = ref<{ x: number; y: number }>();
const dragging = ref(false);
const position = computed(() => point.value ? { left: `${point.value.x}px`, top: `${point.value.y}px`, right: 'auto', bottom: 'auto' } : {});
const previewTask = ref<BackgroundTask>();
const previewModal = ref<InstanceType<typeof MkModalWindow>>();
const files = ref<{ url: string; type: string; name: string }[]>([]), previewError = ref('');
let resultTimer: number | undefined, observer: ResizeObserver | undefined, pressTimer: number | undefined;
let pointer: { id: number; x: number; y: number; left: number; top: number; target: HTMLElement } | undefined, suppressClick = false;
const sent = new Set<string>();
let disconnecting = false;

function placeFrame() { const rect = studioAnchor.value?.getBoundingClientRect(); if (rect) frameStyle.value = { top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` }; }

function clampPoint(x: number, y: number) { const rect = floating.value?.getBoundingClientRect(); return { x: Math.max(8, Math.min(x, innerWidth - (rect?.width ?? 300) - 8)), y: Math.max(8, Math.min(y, innerHeight - (rect?.height ?? 190) - 8)) }; }

function resize() { placeFrame(); if (point.value) point.value = clampPoint(point.value.x, point.value.y); }

function cancelGesture() { window.clearTimeout(pressTimer); pointer = undefined; dragging.value = false; }

function pointerDown(event: PointerEvent) {
	if (!event.isPrimary || event.button !== 0 || pointer) return;
	const target = event.currentTarget as HTMLElement, rect = floating.value!.getBoundingClientRect();
	pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, target }; suppressClick = false;
	target.setPointerCapture(event.pointerId);
	if (!state.hidden) pressTimer = window.setTimeout(() => { suppressClick = true; state.hidden = true; cancelGesture(); }, 650);
}

function pointerMove(event: PointerEvent) {
	if (!pointer || pointer.id !== event.pointerId) return;
	const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
	if (!suppressClick && Math.hypot(dx, dy) < 7) return;
	dragging.value = true; suppressClick = true; window.clearTimeout(pressTimer); point.value = clampPoint(pointer.left + dx, pointer.top + dy);
}

function pointerUp(event: PointerEvent) { if (pointer?.id !== event.pointerId) return; const target = pointer.target; cancelGesture(); if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId); }

function activateTask(event: MouseEvent) { if (event.detail && suppressClick) { suppressClick = false; return; } if (state.hidden) state.hidden = false; else if (task.value) openTask(task.value); }

function openTask(value: BackgroundTask) { viewBackgroundTask(value); router.push('/create/:kind', { params: { kind: value.kind } }); void nextTick(flush); }

function flush() {
	for (const work of pendingBackground.value) if (!sent.has(work.requestId) && studio.value?.sendBackground({ action: 'submit', work: serializeStudioRemix(work) })) sent.add(work.requestId);
	if (state.openTask && studioAnchor.value) studio.value?.sendBackground({ action: 'open', requestId: state.openTask, kind: state.kind });
}

function ready() { studio.value?.sendBackground({ action: 'list' }); flush(); }

function connectionState(status: string) {
	if (status === 'loading') sent.clear();
	if (!['error', 'unlinked', 'authorize'].includes(status)) return;
	const message = status === 'unlinked' ? t.unlinked : status === 'authorize' ? t.authorize : t.connectionError;
	for (const item of state.tasks) if (item.state === 'running') { item.state = 'error'; item.message = message; }
	state.hidden = false;
}

function receive(data: Record<string, any>) {
	if (data.status === 'background-tasks' && Array.isArray(data.tasks)) {
		for (const value of data.tasks) {
			if (typeof value.id !== 'string' || typeof value.sessionId !== 'string' || !['image', 'video'].includes(value.kind) || !['running', 'complete', 'error'].includes(value.state) || typeof value.title !== 'string' || typeof value.model !== 'string') continue;
			let index = state.tasks.findIndex(item => item.id === value.id);
			if (index < 0) { state.tasks.push({ id: value.id, kind: value.kind, title: value.title.slice(0, 100), model: value.model, createdAt: Number(value.createdAt) || Date.now(), state: value.state }); index = state.tasks.length - 1; }
			const previous = state.tasks[index];
			state.tasks[index] = { ...previous, sessionId: value.sessionId, state: value.state, message: typeof value.message === 'string' ? value.message.slice(0, 300) : undefined };
			pendingBackground.value = pendingBackground.value.filter(item => item.requestId !== value.id);
			if (previous.state !== value.state && value.state === 'complete') { taskIndex.value = index; state.hidden = false; os.toast(value.kind === 'video' ? t.videoComplete : t.imageComplete); }
		}
	} else if (data.status === 'background-opened' && data.requestId === state.openTask) state.openTask = '';
	else if (data.status === 'background-error') {
		if (data.action === 'result' && data.requestId === previewTask.value?.id) { window.clearTimeout(resultTimer); previewError.value = String(data.message); } else { const item = state.tasks.find(item => item.id === data.requestId); if (item) { item.state = 'error'; item.message = String(data.message).slice(0, 300); pendingBackground.value = pendingBackground.value.filter(work => work.requestId !== item.id); state.hidden = false; } }
	} else if (data.status === 'background-result' && data.requestId === previewTask.value?.id) {
		window.clearTimeout(resultTimer);
		if (!Array.isArray(data.files) || !data.files.length || data.files.length > 16 || data.files.some((file: unknown) => !(file instanceof Blob) || !/^(image|video)\//.test(file.type) || file.size > 256 * 1024 * 1024)) { previewError.value = t.readError; return; }
		clearFiles(); previewError.value = '';
		files.value = data.files.map((blob: Blob, index: number) => ({ url: URL.createObjectURL(blob), type: blob.type, name: `creation-${index + 1}.${blob.type.split('/')[1].replace(/[^a-z0-9]/g, '') || 'bin'}` }));
	}
}

function clearFiles() { files.value.forEach(file => URL.revokeObjectURL(file.url)); files.value = []; }

function preview(value: BackgroundTask) {
	clearFiles(); previewTask.value = value; previewError.value = ''; window.clearTimeout(resultTimer);
	if (!studio.value?.sendBackground({ action: 'result', requestId: value.id })) { previewError.value = t.reconnecting; return; }
	resultTimer = window.setTimeout(() => { previewError.value = t.slow; }, 90000);
}

function closePreview() { previewModal.value?.close(); }

function clearPreview() { clearFiles(); window.clearTimeout(resultTimer); previewTask.value = undefined; }

function disconnect() { disconnecting = true; state.enabled = false; state.tasks = []; state.identity = ''; state.openTask = ''; pendingBackground.value = []; manualRemix.value = undefined; sent.clear(); clearPreview(); }

watch(studioAnchor, async value => { observer?.disconnect(); if (value) { observer = new ResizeObserver(placeFrame); observer.observe(value); await nextTick(); placeFrame(); flush(); } }, { immediate: true, flush: 'post' });
watch(pendingBackground, (value, previous) => { if (value.some(work => !previous.some(item => item.requestId === work.requestId))) taskIndex.value = 0; flush(); });
watch(() => state.refresh, () => studio.value?.refresh());
watch(() => state.tasks, value => { if ($i && !disconnecting) { try { localStorage.setItem(`community-background:${$i.id}`, JSON.stringify(value.slice(0, 50))); } catch { /* The studio also persists task history. */ } } }, { deep: true });
watch(() => [state.hidden, task.value?.state], () => nextTick(resize));
onMounted(() => {
	if ($i) { try { const saved = JSON.parse(localStorage.getItem(`community-background:${$i.id}`) || '[]'); if (Array.isArray(saved)) state.tasks = [...state.tasks, ...saved.filter(item => item && typeof item.id === 'string' && ['image', 'video'].includes(item.kind) && ['running', 'complete', 'error'].includes(item.state) && typeof item.title === 'string' && !state.tasks.some(task => task.id === item.id))].slice(0, 50); } catch { /* Ignore malformed local metadata. */ } if (state.tasks.length) { state.enabled = true; if (!studioAnchor.value && !state.openTask && !pendingBackground.value.length) state.kind = state.tasks[0].kind; } }
	window.addEventListener('resize', resize); window.addEventListener('scroll', placeFrame, true); window.addEventListener('blur', cancelGesture); window.addEventListener('community-studio-disconnect', disconnect);
});
onBeforeUnmount(() => { observer?.disconnect(); cancelGesture(); clearPreview(); window.removeEventListener('resize', resize); window.removeEventListener('scroll', placeFrame, true); window.removeEventListener('blur', cancelGesture); window.removeEventListener('community-studio-disconnect', disconnect); });
</script>

<style module lang="scss">
.host { position: fixed; z-index: 10; display: flex; min-width: 0; background: var(--MI_THEME-bg); }
.offscreen { left: -12000px !important; top: 0 !important; visibility: hidden; pointer-events: none; }
.floating { position: fixed; z-index: 12000; right: max(20px, env(safe-area-inset-right)); bottom: max(24px, calc(env(safe-area-inset-bottom) + 72px)); width: min(320px, calc(100vw - 24px)); box-sizing: border-box; border-radius: 14px; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); box-shadow: 0 8px 32px var(--MI_THEME-shadow); overflow: hidden; font-size: 13px; }
.top { display: flex; align-items: center; justify-content: space-between; padding: 0 4px 0 16px; min-height: 44px; border-bottom: 1px solid var(--MI_THEME-divider); > span { font-weight: 600; } }
.iconButton { display: inline-grid; place-items: center; flex: none; min-width: 44px; min-height: 44px; }
.handle, .restore { touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; cursor: grab; }
.dragging { box-shadow: 0 14px 40px var(--MI_THEME-shadow); .handle, .restore { cursor: grabbing; } }
.handle { display: flex; align-items: center; gap: 12px; width: 100%; padding: 16px; text-align: left; > i { font-size: 22px; color: var(--MI_THEME-accent); flex: none; } > i:last-child { margin-left: auto; font-size: 18px; } > span { display: grid; min-width: 0; gap: 6px; } strong { font-size: 15px; } }
.taskTitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 0 12px; > button { min-height: 44px; padding: 8px 10px; border-radius: 8px; } }
.primary { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); }
.hint { margin: 8px 16px 14px; font-size: 12px; line-height: 1.5; }
.error { margin: 0 16px 8px; overflow-wrap: anywhere; line-height: 1.5; max-height: 84px; overflow-y: auto; }
.hidden { width: auto; }
.restore { min-height: 48px; padding: 10px 16px; display: flex; align-items: center; gap: 8px; }
.preview { padding: 16px; overflow-wrap: anywhere; > div { display: grid; gap: 12px; margin-bottom: 16px; } img, video { display: block; width: 100%; max-height: 420px; object-fit: contain; border-radius: 8px; background: var(--MI_THEME-bg); } }
.download { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); border-radius: 8px; }
.floating button:hover { filter: brightness(.95); }
.floating :focus-visible, .download:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: -3px; }
@media (max-width: 400px) { .floating { right: 12px; } }
</style>
