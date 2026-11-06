/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { entities } from 'misskey-js';
import { homeLanguage } from '@/pages/home/copy.js';
import { instance, fetchInstance } from '@/instance.js';

export const uploadKinds = ['image', 'video', 'audio', 'document', 'other'] as const;
export type UploadKind = typeof uploadKinds[number];
export type UploadLimits = NonNullable<entities.MetaClientOptions['uploadLimits']>;
export const MiB = 1024 * 1024;

export function getUploadLimits(value = instance.clientOptions?.uploadLimits): UploadLimits {
	const result = {} as UploadLimits;
	for (const kind of uploadKinds) {
		const n = value?.[kind];
		result[kind] = typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 10240 ? n : 20;
	}
	return result;
}

export function getBrowserUploadKind(mime: string, name: string): UploadKind {
	if (mime.startsWith('image/')) return 'image';
	if (mime.startsWith('video/') || mime === 'application/ogg') return 'video';
	if (mime.startsWith('audio/')) return 'audio';
	if (mime.startsWith('text/') || /^(application\/(pdf|json|ld\+json|xml|javascript|x-javascript|yaml|x-yaml|toml|rtf|msword|vnd\.ms-(excel|powerpoint|word)|vnd\.openxmlformats-officedocument\.|vnd\.oasis\.opendocument\.|epub\+zip|x-cfb))/.test(mime)) return 'document';
	if (!mime || mime === 'application/octet-stream') {
		const ext = name.split('.').pop()?.toLowerCase() ?? '';
		if (/^(png|jpe?g|webp|gif|apng|avif|svg|bmp|tiff?|heic|heif)$/.test(ext)) return 'image';
		if (/^(mp4|webm|mov|mkv|avi|m4v)$/.test(ext)) return 'video';
		if (/^(mp3|wav|flac|aac|m4a|ogg|opus)$/.test(ext)) return 'audio';
		if (/^(txt|md|mdx|pdf|docx?|xlsx?|pptx?|odt|csv|json|ya?ml|xml|js|ts|tsx|jsx|vue|html|css|py|go|rs|sh|sql|toml|skill)$/.test(ext)) return 'document';
	}
	return 'other';
}

let refresh: Promise<entities.MetaDetailed> | undefined;
export function refreshUploadLimits(): Promise<entities.MetaDetailed> {
	if (!refresh) {
		refresh = new Promise<entities.MetaDetailed>((resolve, reject) => {
			const timeout = window.setTimeout(() => reject(new Error('Upload settings timed out')), 5000);
			fetchInstance(true).then(resolve, reject).finally(() => window.clearTimeout(timeout));
		}).finally(() => { refresh = undefined; });
	}
	return refresh;
}

export function effectiveUploadLimit(kind: UploadKind, accountLimitMb = Infinity): number {
	return Math.min(getUploadLimits()[kind] * MiB, instance.maxFileSize ?? Infinity, accountLimitMb * MiB);
}

export function preflightUploadLimit(mime: string, name: string, accountLimitMb: number): { category: UploadKind | null; limitBytes: number } {
	const category = getBrowserUploadKind(mime, name);
	// A blank MIME or a generic binary MIME cannot distinguish README/Skill text
	// from media. Video containers can also contain audio only. Let the server
	// identify those cases without rejecting them against an incorrect lower cap.
	const candidates = !mime || mime === 'application/octet-stream' ? uploadKinds : mime.startsWith('video/') || mime === 'application/ogg' ? ['video', 'audio'] as const : [category];
	return {
		category: candidates.length === 1 ? category : null,
		limitBytes: Math.max(...candidates.map(kind => effectiveUploadLimit(kind, accountLimitMb))),
	};
}

const english = homeLanguage === 'en-US';
export const uploadText = english ? {
	title: 'Upload limits', intro: 'Set the maximum size of each uploaded file. Changes apply to new uploads after saving.',
	labels: { image: 'Images', video: 'Videos', audio: 'Audio', document: 'Documents / code / Skills', other: 'Other files / archives' },
	details: { image: 'Photos and animated images, including GIF and APNG.', video: 'Video files such as MP4, WebM and MOV.', audio: 'Audio files such as MP3, WAV and M4A.', document: 'PDF, Office documents, text, Markdown and source code.', other: 'ZIP, RAR, 7z and other binary files.' },
	adminOnly: 'Only administrators can change upload limits.', loadFailed: 'Could not load upload limits. Please retry.', retry: 'Retry',
	save: 'Save limits', saving: 'Saving…', saved: 'Saved. New uploads use these limits.', saveFailed: 'Could not save. Your changes are still here; please retry.',
	invalid: 'Enter a whole number between 1 and 10,240 MB.', current: 'Effective server limit',
	boundary: 'Account limits still apply. The server identifies the actual file type. Rejected temporary uploads are cleaned up; existing files are kept.',
	units: '1 MB = 1,048,576 bytes. Each value applies to one file.', hint: 'Maximum size per file',
	tooLarge: 'This file exceeds the upload limit.', serverRejected: 'The server rejected this upload because it is too large. Refresh the limits and try a smaller file.',
	failed: 'Upload failed. Check the connection and try again.', file: 'File', max: 'Maximum', size: 'Selected file',
} : {
	title: '上传限制', intro: '分别设置每个文件的最大上传大小。保存后应用于新上传的文件。',
	labels: { image: '图片', video: '视频', audio: '音频', document: '文档 / 代码 / Skill', other: '其他文件 / 压缩包' },
	details: { image: '照片与动态图片，包括 GIF、APNG。', video: 'MP4、WebM、MOV 等视频文件。', audio: 'MP3、WAV、M4A 等音频文件。', document: 'PDF、Office 文档、文本、Markdown 与源代码。', other: 'ZIP、RAR、7z 等压缩包及其他二进制文件。' },
	adminOnly: '仅管理员可修改上传限制。', loadFailed: '上传限制加载失败，请重试。', retry: '重试',
	save: '保存上传限制', saving: '正在保存…', saved: '已保存，新上传的文件将使用这些限制。', saveFailed: '保存失败，修改内容已保留，请重试。',
	invalid: '请输入 1～10,240 MB 之间的整数。', current: '服务器实际允许',
	boundary: '实际上传还受账户限额约束。服务器会识别真实文件类型；失败的临时上传会清理，已有文件保留。',
	units: '1 MB = 1,048,576 字节，每项限制针对单个文件。', hint: '单个文件上传上限',
	tooLarge: '文件大小超过上传限制。', serverRejected: '服务器拒绝了超限文件，请刷新限制后选择更小的文件重试。',
	failed: '上传失败，请检查网络后重试。', file: '文件', max: '最大允许', size: '所选文件',
};

export function uploadLimitMessage(name: string, limitBytes: number, category?: string | null, size?: number): string {
	const kind = uploadKinds.find(k => k === category);
	const format = (bytes: number) => new Intl.NumberFormat(english ? 'en-US' : 'zh-CN', { maximumFractionDigits: 2 }).format(bytes / MiB);
	return `${name}\n${kind ? uploadText.labels[kind] : uploadText.file} · ${uploadText.max} ${format(limitBytes)} MB${size == null ? '' : ` · ${uploadText.size} ${format(size)} MB`}`;
}
