/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { IdentifiableError } from '@/misc/identifiable-error.js';

export const uploadKinds = ['image', 'video', 'audio', 'document', 'other'] as const;
export type UploadKind = typeof uploadKinds[number];
export type UploadLimits = Record<UploadKind, number>;
const MiB = 1024 * 1024;
const limitParam = { type: 'integer', minimum: 1, maximum: 10240 } as const;
export const uploadLimitsParam = {
	type: 'object', additionalProperties: false,
	properties: { image: limitParam, video: limitParam, audio: limitParam, document: limitParam, other: limitParam },
	required: ['image', 'video', 'audio', 'document', 'other'],
} as const;

export const uploadSizeError = {
	message: 'Cannot upload the file because it exceeds the maximum file size.',
	code: 'MAX_FILE_SIZE_EXCEEDED',
	id: 'b9d8c348-33f0-4673-b9a9-5d4da058977a',
	httpStatusCode: 413,
} as const;

export class UploadSizeLimitError extends IdentifiableError {
	constructor(public info: { category: UploadKind | null; limitBytes: number }) {
		super('f9e4e5f3-4df4-40b5-b400-f236945f7073', 'Max file size exceeded.');
	}
}

export function getUploadLimits(value?: Partial<UploadLimits> | null): UploadLimits {
	const result = {} as UploadLimits;
	for (const kind of uploadKinds) {
		const n = value?.[kind];
		result[kind] = typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 10240 ? n : 20;
	}
	return result;
}

export function getUploadKind(mime: string): UploadKind {
	if (mime.startsWith('image/')) return 'image';
	if (mime.startsWith('video/') || mime === 'application/ogg') return 'video';
	if (mime.startsWith('audio/')) return 'audio';
	if (mime.startsWith('text/') || /^(application\/(pdf|json|ld\+json|xml|javascript|x-javascript|yaml|x-yaml|toml|rtf|msword|vnd\.ms-(excel|powerpoint|word)|vnd\.openxmlformats-officedocument\.|vnd\.oasis\.opendocument\.|epub\+zip|x-cfb))/.test(mime)) return 'document';
	return 'other';
}

export function getUploadTempLimit(value: Partial<UploadLimits> | undefined, serverLimit: number): number {
	return Math.min(serverLimit, Math.max(...Object.values(getUploadLimits(value))) * MiB);
}

// Unknown UTF-8 text includes Markdown, source code and Skill files. Inspect all
// bytes rather than trusting the extension or a client-supplied Content-Type.
async function isTextFile(path: string): Promise<boolean> {
	const decoder = new TextDecoder('utf-8', { fatal: true });
	try {
		for await (const chunk of createReadStream(path)) {
			if (/[\u0000-\u0008\u000b\u000e-\u001f]/u.test(decoder.decode(chunk, { stream: true }))) return false;
		}
		decoder.decode();
		return true;
	} catch (err) {
		if (err instanceof TypeError) return false;
		throw err;
	}
}

// Rendering intentionally ignores large SVGs. Upload classification still has
// to recognize their XML root without loading an entire image into memory.
async function sniffXmlRoot(path: string, size: number): Promise<'image' | 'text' | 'ambiguous'> {
	const file = await open(path, 'r');
	try {
		const buffer = Buffer.alloc(64 * 1024);
		const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
		// Unsupported UTF-16 XML and excessively long preambles must not gain a
		// larger document/binary allowance merely by hiding the SVG root.
		if ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff)) return 'ambiguous';
		let prefix = buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '').trimStart();
		while (prefix.startsWith('<?') || prefix.startsWith('<!--')) {
			const end = prefix.startsWith('<?') ? '?>' : '-->';
			const index = prefix.indexOf(end);
			if (index < 0) return 'ambiguous';
			prefix = prefix.slice(index + end.length).trimStart();
		}
		if (!prefix) return size > bytesRead ? 'ambiguous' : 'text';
		if (!prefix.startsWith('<')) return 'text';
		const root = /^<([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)(?=[\s/>])/.exec(prefix)?.[1];
		if (!root) return 'ambiguous';
		return root.split(':').at(-1)?.toLowerCase() === 'svg' ? 'image' : 'text';
	} finally { await file.close(); }
}

export async function validateUploadSize(path: string, size: number, mime: string, value: Partial<UploadLimits> | undefined, serverLimit: number): Promise<void> {
	const limits = getUploadLimits(value);
	let category = getUploadKind(mime);
	if (mime === 'application/octet-stream' || mime === 'application/xml' || mime === 'text/xml') {
		// Bound the amount of work before scanning a file without a known signature.
		const ceiling = Math.min(serverLimit, Math.max(limits.image, limits.document, limits.other) * MiB);
		if (size > ceiling) throw new UploadSizeLimitError({ category: null, limitBytes: ceiling });
		const root = await sniffXmlRoot(path, size);
		if (root === 'ambiguous') {
			const limitBytes = Math.min(serverLimit, limits.image * MiB, limits.document * MiB, limits.other * MiB);
			if (size > limitBytes) throw new UploadSizeLimitError({ category: null, limitBytes });
			return;
		}
		if (root === 'image') category = 'image';
		else if (await isTextFile(path)) category = 'document';
		else category = 'other';
	}
	const limitBytes = Math.min(serverLimit, limits[category] * MiB);
	if (size > limitBytes) throw new UploadSizeLimitError({ category, limitBytes });
}
