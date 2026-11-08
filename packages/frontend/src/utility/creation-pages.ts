/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { i18n } from '@/i18n.js';
import { homeLanguage } from '@/pages/home/copy.js';

export const creationText = homeLanguage === 'en-US' ? {
	community: 'Community', text: 'Text studio', image: 'Image studio', video: 'Video studio',
	settings: 'Creation links', description: 'Set a destination for each creation tool. Save to enable its entry. Leave a URL empty to show an unconfigured state.',
	url: 'Creation page URL', urlHint: 'Use a complete external HTTPS URL. Leave it empty to disable the destination. Links are public; do not include passwords or private tokens.',
	mode: 'Open mode', embed: 'Open in the workspace', newTab: 'Open in a new window',
	modeHint: 'Use a new window for sites that need their own login or do not allow embedding.',
	invalidUrl: 'Enter an external HTTPS URL of up to 2,048 characters, without credentials or a link back to this site.',
	notConfigured: 'This studio is not set up yet', emptyHint: 'An administrator needs to configure its destination before you can use it.',
	configure: 'Configure creation links', open: 'Open in a new window',
	externalHint: 'This creation tool opens in a separate window.', embedHint: 'If the page does not display correctly, open it in a new window.',
	loadError: 'Creation settings could not load. Please try again.', saveError: 'Changes could not be saved. Your edits are still here. Please try again.',
	saved: 'Creation links saved', adminOnly: 'Only administrators can change creation links.', preview: 'Open the saved creation page',
} : i18n.ts._creationLinks;

export const creationPages = [
	{ key: 'text', title: creationText.text, icon: 'ti ti-file-text', urlKey: 'creationTextUrl', modeKey: 'creationTextMode', modelKey: 'creationTextModel', defaultModel: 'gpt-6.1-sol' },
	{ key: 'image', title: creationText.image, icon: 'ti ti-photo', urlKey: 'creationImageUrl', modeKey: 'creationImageMode', modelKey: 'creationImageModel', defaultModel: 'gpt-image-2.6' },
	{ key: 'video', title: creationText.video, icon: 'ti ti-video', urlKey: 'creationVideoUrl', modeKey: 'creationVideoMode', modelKey: 'creationVideoModel', defaultModel: '' },
] as const;

export const creationModelText = homeLanguage === 'en-US' ? {
	title: 'Default creation models', label: 'Default model ID',
	hint: 'Each entry opens a new chat. Remixes use the original work’s model first. Enter an exact model ID available to your users.',
	empty: 'Leave empty to let users select a model', invalid: 'Use a model ID of up to 100 characters without spaces.', saved: 'Default models saved',
} : {
	title: '制作默认模型', label: '默认模型 ID',
	hint: '进入制作页时自动新建聊天；制作同款优先采用原作品模型。请填写用户有权调用的准确模型 ID。',
	empty: '留空时由用户手动选择模型', invalid: '模型 ID 最多 100 个字符，不能包含空白字符。', saved: '默认模型已保存',
};

export type CreationMode = 'embed' | 'newTab';

const embedZh = {
	workspace: '站内工作区', reload: '重新载入', help: '页面打不开？', closeHelp: '收起说明',
	loading: '正在载入制作页面…', slowTitle: '连接时间较长', failedTitle: '暂时无法载入页面',
	waitHint: '页面仍未显示时，可以重新载入，或在新窗口继续使用。', continuePreview: '继续查看内嵌页面',
	helpTitle: '页面空白或提示“拒绝连接”？',
	helpHint: '目标网站需要允许在本站内展示。若仍无法使用，可先在新窗口打开；目标网站可能还需要单独登录。',
	adminHint: '请在目标网站的响应配置中允许以下本站来源，再重新载入。',
	modeHint: '站内展示需要目标网站允许嵌入，并兼容浏览器的跨站登录与存储规则；选择此模式不会自动修改目标网站。',
	setupTitle: '配置站内嵌入许可',
	setupHint: '在目标网站现有的 Content-Security-Policy 响应头中，把下方来源加入 frame-ancestors。保留原有来源和其他指令，并检查服务器与 CDN 是否重复设置了限制。',
	originLabel: '需要允许嵌入的本站来源', copyOrigin: '复制本站来源', copied: '已复制', copyFailed: '复制失败，请选中下方来源手动复制。',
	sessionHint: '社区账户和目标网站账户相互独立；站内嵌入不会传递社区的密码或登录令牌。',
};
const embedEn: typeof embedZh = {
	workspace: 'Embedded workspace', reload: 'Reload page', help: 'Page not opening?', closeHelp: 'Hide help',
	loading: 'Loading the creation page…', slowTitle: 'This is taking longer than expected', failedTitle: 'The page could not load',
	waitHint: 'If the page is still missing, reload it or continue in a new window.', continuePreview: 'Continue viewing the embedded page',
	helpTitle: 'Blank page or a refused connection?',
	helpHint: 'The destination must allow this site to embed it. You can also open it in a new window. The destination may require its own sign-in.',
	adminHint: 'Allow the following site origin in the destination’s response configuration, then reload.',
	modeHint: 'Embedding requires permission from the destination and compatibility with cross-site sign-in and storage rules. This setting does not change the destination’s configuration.',
	setupTitle: 'Allow embedded access',
	setupHint: 'Add the origin below to frame-ancestors in the destination’s existing Content-Security-Policy response header. Preserve existing origins and other directives, and check for additional restrictions from the server or CDN.',
	originLabel: 'Site origin to allow', copyOrigin: 'Copy site origin', copied: 'Copied', copyFailed: 'Could not copy. Select the origin below and copy it manually.',
	sessionHint: 'Community and destination accounts are separate. Embedding does not forward community passwords or sign-in tokens.',
};
export const creationEmbedText = homeLanguage === 'en-US' ? embedEn : embedZh;

// Keep the browser check consistent with backend/misc/creation-url.ts.
export function normalizeCreationUrl(value: string, siteUrl: string): string | null {
	const trimmed = value.trim();
	if (trimmed.length > 2048 || !/^https:\/\/[^/]/i.test(trimmed) || /[\s\\]/u.test(trimmed)) return null;
	try {
		const target = new URL(trimmed);
		if (!target.hostname || target.username || target.password || target.origin === new URL(siteUrl).origin) return null;
		return target.href.length <= 2048 ? target.href : null;
	} catch {
		return null;
	}
}
