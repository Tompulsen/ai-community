/* SPDX-License-Identifier: AGPL-3.0-only */
import { reactive, shallowRef } from 'vue';
import { serializeStudioRemix } from './studio-remix.js';
import type { StudioRemix } from './studio-remix.js';

export type BackgroundTask = { id: string; sessionId?: string; kind: 'image' | 'video'; title: string; model: string; createdAt: number; state: 'running' | 'complete' | 'error'; message?: string };
export const studioAnchor = shallowRef<HTMLElement>();
export const pendingBackground = shallowRef<StudioRemix[]>([]);
export const manualRemix = shallowRef<StudioRemix>();
export const backgroundStudio = reactive({ enabled: false, kind: 'image', identity: '', openTask: '', refresh: 0, hidden: false, tasks: [] as BackgroundTask[] });

export function queueBackgroundRemix(work: StudioRemix) {
	if (work.kind === 'text' || backgroundStudio.tasks.some(task => task.id === work.requestId)) return;
	pendingBackground.value = [...pendingBackground.value, serializeStudioRemix(work)];
	backgroundStudio.tasks.unshift({ id: work.requestId, kind: work.kind, title: work.prompt.trim().split('\n')[0].slice(0, 60), model: work.model, createdAt: Date.now(), state: 'running' });
	backgroundStudio.kind = work.kind;
	backgroundStudio.hidden = false;
	backgroundStudio.enabled = true;
}

export function viewBackgroundTask(task: BackgroundTask) {
	backgroundStudio.kind = task.kind;
	backgroundStudio.openTask = task.sessionId ? task.id : '';
	backgroundStudio.enabled = true;
}
