/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref, shallowRef } from 'vue';
import type { CommunityComposerDraft, CommunityFile, CommunityGateway } from '@/pages/community/types.js';
import { effectiveUploadLimit, refreshUploadLimits } from '@/utility/upload-limits.js';
import { uploadFile } from '@/utility/drive.js';
import { studioShareText as t } from '@/utility/studio-share-copy.js';

type Identity = { userId: string; subject: string; token: string; context: string; attempt: string; accountLimitMb: number };
type ShareWork = Omit<CommunityComposerDraft, 'files' | 'referenceFiles' | 'generation'> & { generation?: { prompt: string; model: string; sourceWorkId?: string }; files: { name: string; blob: Blob; role?: 'reference' }[] };
const MAX_MEDIA = 256 * 1024 * 1024;
const validResult = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const validSource = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9]{1,32}$/.test(id);
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id);
export function validateStudioWork(value: unknown): value is ShareWork {
	if (!value || typeof value !== 'object') return false;
	const work = value as ShareWork;
	if (work.destination !== undefined && !['community', 'source-comment'].includes(work.destination)) return false;
	if (work.destination === 'source-comment' && (work.category === 'video' || Array.isArray(work.files) && work.files.some(file => file?.blob instanceof Blob && file.blob.type.startsWith('video/')))) return false;
	if (work.destination === 'source-comment' && (!validResult(work.resultId) || typeof work.generation?.prompt !== 'string' || !validSource(work.generation.sourceWorkId))) return false;
	return ['image', 'video', 'resource'].includes(work.category) && typeof work.title === 'string' && work.title.length <= 100 && typeof work.text === 'string' && work.text.length <= 2500 && typeof work.model === 'string' && work.model.length <= 100 && Array.isArray(work.files) && work.files.length <= 32 && work.files.every(file => file && typeof file.name === 'string' && /^[^/\\\x00-\x1f]{1,180}$/.test(file.name) && (file.role === undefined || file.role === 'reference' && work.destination !== 'source-comment') && file.blob instanceof Blob && (file.role !== 'reference' || file.blob.type.startsWith('image/')) && file.blob.size > 0 && /^(image\/(png|jpeg|webp|gif|avif|apng|bmp|x-ms-bmp)|video\/(mp4|webm|quicktime|x-matroska)|text\/markdown)$/.test(file.blob.type)) && work.files.filter(file => file.role === 'reference').length <= 16 && work.files.filter(file => file.role !== 'reference').length <= 16 && (!work.generation || (typeof work.generation.prompt === 'string' && work.generation.prompt.length <= 100000 && typeof work.generation.model === 'string' && work.generation.model.trim().length > 0 && work.generation.model.length <= 100 && (work.generation.sourceWorkId === undefined || validSource(work.generation.sourceWorkId)))) && (work.category === 'resource' ? !!work.text.trim() || work.files.length > 0 : work.files.some(file => file.role !== 'reference' && file.blob.type.startsWith(work.category + '/')));
}

/** The caller authenticates frame origin/source/context/attempt/subject before dispatching. */
export function useStudioShare(identity: () => Identity | undefined, send: (value: object) => void) {
	const phase = ref<'' | 'preparing' | 'uploading' | 'editing' | 'error'>('');
	const progress = ref(0);
	const draft = shallowRef<CommunityComposerDraft>();
	const notice = ref('');
	let task: { destination: 'community' | 'source-comment'; resultId?: string; sourceWorkId?: string; id: string; actor: Identity; controller: AbortController; timer?: number; content?: ShareWork; files: CommunityFile[]; receiving: boolean } | undefined;

	function current(expected = task) {
		const actor = identity();
		return !!expected && task === expected && !expected.controller.signal.aborted && !!actor && ['userId', 'subject', 'token', 'context', 'attempt'].every(key => actor[key as keyof Identity] === expected.actor[key as keyof Identity]);
	}

	function assertCurrent() { if (!current()) throw new Error(t.invalid); }

	function reset() {
		task?.controller.abort(); window.clearTimeout(task?.timer); task = undefined; phase.value = ''; draft.value = undefined; progress.value = 0;
	}

	function finish(outcome: string, code?: string) {
		if (task && current()) send({ requestId: task.id, phase: 'finished', outcome, code });
		reset();
	}

	function limits(actor: Identity) {
		return { image: Math.min(MAX_MEDIA, effectiveUploadLimit('image', actor.accountLimitMb)), video: Math.min(MAX_MEDIA, effectiveUploadLimit('video', actor.accountLimitMb)), document: Math.min(MAX_MEDIA, effectiveUploadLimit('document', actor.accountLimitMb)) };
	}

	function withinLimits(work: ShareWork, actor: Identity) {
		const cap = limits(actor);
		return work.files.every(file => file.blob.size <= cap[file.blob.type.startsWith('image/') ? 'image' : file.blob.type.startsWith('video/') ? 'video' : 'document']);
	}

	async function upload() {
		const active = task;
		if (!current(active) || !active?.content || phase.value === 'uploading') return;
		phase.value = 'uploading';
		send({ requestId: active.id, phase: 'uploading' });
		try {
			await refreshUploadLimits();
			if (!current(active)) return;
			if (!withinLimits(active.content, active.actor)) { finish('error', 'tooLarge'); return; }
			const source = active.content.files, total = source.reduce((sum, file) => sum + file.blob.size, 0);
			let done = source.slice(0, active.files.length).reduce((sum, file) => sum + file.blob.size, 0);
			for (let index = active.files.length; index < source.length; index++) {
				const file = source[index];
				const upload = uploadFile(file.blob, { name: file.name, onProgress: ({ loaded }) => { if (current(active)) progress.value = Math.min(99, Math.round((done + loaded) / Math.max(total, 1) * 100)); } });
				active.controller.signal.addEventListener('abort', upload.abort, { once: true });
				const timer = window.setTimeout(upload.abort, 180000);
				try {
					const result = await upload.filePromise;
					if (!current(active)) return;
					// Drive's self-upload response omits userId unless withUser is requested.
					// The request is bound to the captured account; submission rechecks file ownership.
					if (result.userId != null && result.userId !== active.actor.userId) throw new Error(t.invalid);
					active.files.push(result); done += file.blob.size;
				} finally { window.clearTimeout(timer); active.controller.signal.removeEventListener('abort', upload.abort); }
			}
			if (!current(active)) return;
			draft.value = { destination: active.destination, resultId: active.resultId, category: active.content.category, title: active.content.title, text: active.content.text, model: active.content.generation?.model ?? active.content.model, files: active.files.filter((_, index) => source[index].role !== 'reference'), referenceFiles: active.files.filter((_, index) => source[index].role === 'reference'), generation: active.content.generation ? { ...active.content.generation, referenceFileIds: active.files.filter((_, index) => source[index].role === 'reference').map(file => file.id) } : null };
			phase.value = 'editing'; progress.value = 100;
			send({ requestId: active.id, phase: 'editing' });
		} catch {
			if (current(active)) { phase.value = 'error'; send({ requestId: active.id, phase: 'retry' }); }
		}
	}

	async function receive(data: { status: string; requestId?: unknown; work?: unknown; destination?: unknown; resultId?: unknown; sourceWorkId?: unknown }) {
		if (!validId(data.requestId)) return;
		if (data.status === 'share-request') {
			if (data.destination !== undefined && !['community', 'source-comment'].includes(String(data.destination)) || data.destination === 'source-comment' && (!validResult(data.resultId) || !validSource(data.sourceWorkId))) { send({ requestId: data.requestId, phase: 'finished', outcome: 'error', code: 'invalid' }); return; }
			if (task) { if (task.id !== data.requestId) send({ requestId: data.requestId, phase: 'finished', outcome: 'error', code: 'busy' }); return; }
			const actor = identity(); if (!actor) return;
			const active: NonNullable<typeof task> = { destination: data.destination === 'source-comment' ? 'source-comment' : 'community', resultId: validResult(data.resultId) ? data.resultId : undefined, sourceWorkId: validSource(data.sourceWorkId) ? data.sourceWorkId : undefined, id: data.requestId, actor, controller: new AbortController(), files: [], receiving: false };
			task = active;
			phase.value = 'preparing'; notice.value = '';
			active.timer = window.setTimeout(() => { if (current(active)) finish('error', 'timeout'); }, 180000);
			try {
				await refreshUploadLimits();
				if (current(active)) send({ requestId: active.id, phase: 'ready', limits: limits(actor) });
			} catch { if (current(active)) finish('error'); }
		} else if (task?.id === data.requestId && current()) {
			if (data.status === 'share-cancel' && phase.value !== 'editing') { finish('canceled'); return; }
			if (data.status !== 'share-content' || task.receiving || phase.value !== 'preparing') return;
			task.receiving = true; window.clearTimeout(task.timer);
			if (!validateStudioWork(data.work) || (data.work.destination ?? 'community') !== task.destination || task.destination === 'source-comment' && (data.work.resultId !== task.resultId || data.work.generation?.sourceWorkId !== task.sourceWorkId)) { finish('error', 'invalid'); return; }
			if (!withinLimits(data.work, task.actor)) { finish('error', 'tooLarge'); return; }
			task.content = data.work;
			await upload();
		}
	}

	function published(work: Awaited<ReturnType<CommunityGateway['submit']>>) {
		if (!current()) { reset(); return; }
		notice.value = work.status === 'pending' ? t.pending : ['published', 'approved'].includes(work.status) ? task?.destination === 'source-comment' ? t.directSent : t.published : t.statusUpdated;
		if (task?.destination !== 'source-comment' && work.sourceCommentStatus && work.sourceCommentStatus !== 'none') notice.value += ' ' + t.sourceStatus[work.sourceCommentStatus];
		finish(work.status);
	}

	return { phase, progress, draft, notice, receive, retry: upload, cancel: () => finish('canceled'), stop: () => { reset(); notice.value = ''; }, assertCurrent, published };
}
