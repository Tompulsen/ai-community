/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isProxy, ref } from 'vue';
import { remixReferenceFiles, serializeStudioRemix } from '../../src/utility/studio-remix.js';
import type { StudioRemix } from '../../src/utility/studio-remix.js';

describe('studio remix transfer', () => {
	it('never substitutes finished works for missing reference images', () => {
		const work = { files: [{ id: 'output', name: 'work.png', type: 'image/png', url: 'https://example.com/work.png' }], referenceFiles: [] };
		expect(remixReferenceFiles(work)).toEqual([]);
		expect(remixReferenceFiles({})).toEqual([]);
	});
	it('transfers only safe image files explicitly saved as references, in order', () => {
		const reference = { id: 'reference', name: 'reference.png', type: 'image/png', url: 'https://example.com/reference.png' };
		const second = { ...reference, id: 'second', url: 'https://example.com/second.png' };
		expect(remixReferenceFiles({ referenceFiles: [reference, { ...reference, id: 'video', type: 'video/mp4' }, { ...reference, id: 'unsafe', url: 'javascript:alert(1)' }, second] })).toEqual([reference, second]);
	});
	it('copies a deeply reactive work into a structured-cloneable message', () => {
		const work = ref<StudioRemix>({ requestId: 'request', sourceWorkId: 'work', kind: 'image', prompt: '完整提示词\n第二行', model: 'original-model', references: [{ url: 'https://example.com/reference.png', name: 'reference.png' }] });
		expect(isProxy(work.value)).toBe(true);
		expect(() => structuredClone({ work: work.value })).toThrow();
		const transfer = serializeStudioRemix(work.value);
		expect(structuredClone({ work: transfer }).work).toEqual(transfer);
		expect(isProxy(transfer.references[0])).toBe(false);
		work.value.references[0].name = 'changed.png';
		expect(transfer.references[0].name).toBe('reference.png');
	});
	it('preserves prompt-only requests and excludes unrelated object fields', () => {
		const work = { requestId: 'request', sourceWorkId: 'work', kind: 'text' as const, prompt: '原始文本', model: 'original-model', references: [], unrelated: 'not transferred' };
		expect(serializeStudioRemix(work)).toEqual({ requestId: 'request', sourceWorkId: 'work', kind: 'text', prompt: '原始文本', model: 'original-model', references: [] });
	});
});
