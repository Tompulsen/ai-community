/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStudioShare, validateStudioWork } from '../../src/utility/studio-share.js';

vi.mock('@/utility/upload-limits.js', () => ({ effectiveUploadLimit: () => 100000, refreshUploadLimits: async () => {} }));
vi.mock('@/utility/drive.js', () => ({ uploadFile: vi.fn() }));
vi.mock('@/pages/home/copy.js', () => ({ homeLanguage: 'zh-CN' }));

const work = { destination: 'source-comment', resultId: 'result-1', category: 'resource', title: '同款', text: '生成结果', model: 'model', generation: { prompt: '', model: 'model', sourceWorkId: 'source1' }, files: [] };
const requestId = '11111111-1111-4111-8111-111111111111';
afterEach(() => vi.unstubAllGlobals());

describe('direct result share protocol', () => {
	it('requires saved source and stable result, while allowing attachment-only prompts', () => {
		expect(validateStudioWork(work)).toBe(true);
		for (const generation of [undefined, {}, { ...work.generation, prompt: 12 }, { ...work.generation, sourceWorkId: undefined }]) expect(validateStudioWork({ ...work, generation })).toBe(false);
		expect(validateStudioWork({ ...work, resultId: undefined })).toBe(false);
		expect(validateStudioWork({ ...work, files: [null] })).toBe(false);
		expect(validateStudioWork({ ...work, files: [{ name: 'ref.png', role: 'reference', blob: new Blob(['x'], { type: 'image/png' }) }] })).toBe(false);
	});
	it.each(['destination', 'source', 'result', 'malformed'])('rejects %s changes after binding the request and frees the bridge', async (change) => {
		vi.stubGlobal('window', { setTimeout, clearTimeout });
		const send = vi.fn();
		const bridge = useStudioShare(() => ({ userId: 'user', subject: '1', token: 'test', context: 'ctx', attempt: 'attempt', accountLimitMb: 32 }), send);
		await bridge.receive({ status: 'share-request', requestId, destination: 'source-comment', resultId: 'result-1', sourceWorkId: 'source1' });
		const content = structuredClone(work);
		if (change === 'destination') content.destination = 'community';
		if (change === 'source') content.generation.sourceWorkId = 'different';
		if (change === 'result') content.resultId = 'other';
		if (change === 'malformed') Object.assign(content.generation, { prompt: 12 });
		await bridge.receive({ status: 'share-content', requestId, work: content });
		expect(send).toHaveBeenLastCalledWith({ requestId, phase: 'finished', outcome: 'error', code: 'invalid' });
		expect(bridge.phase.value).toBe('');
		expect(bridge.draft.value).toBeUndefined();
	});
});
