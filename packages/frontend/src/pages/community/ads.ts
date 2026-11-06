/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { entities } from 'misskey-js';
import { homeLanguage } from '@/pages/home/copy.js';

export const communityAdKeys = ['communityAd1', 'communityAd2', 'communityAd3', 'communityAd4'] as const;
export type CommunityAdKey = typeof communityAdKeys[number];
export type CommunityAd = NonNullable<entities.MetaClientOptions['communityAd1']>;
export const emptyAd = (): CommunityAd => ({ enabled: false, title: '', imageUrl: '', linkUrl: '' });

export function normalizeAdUrl(value: string, siteUrl: string, image = false): string | null {
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 2048 || /[\s\\\u0000-\u001f\u007f]/u.test(trimmed) || !/^https?:\/\//i.test(trimmed)) return null;
	try {
		const url = new URL(trimmed);
		if (!url.hostname || url.username || url.password) return null;
		if (image && url.protocol === 'http:' && url.origin !== new URL(siteUrl).origin) return null;
		return url.href;
	} catch { return null; }
}

export const adText = homeLanguage === 'en-US' ? {
	title: 'Sponsored', settings: 'Community ad slots', manage: 'Manage', empty: 'Space available',
	positions: ['Top left', 'Top right', 'Bottom left', 'Bottom right'],
	intro: 'Four fixed spaces below the community sidebar. Save each space separately. Only published ads appear to visitors.',
	image: 'Advertisement image', name: 'Ad title / image description', link: 'Destination URL',
	upload: 'Upload image', choose: 'Choose existing image', cancel: 'Cancel upload', remove: 'Remove image',
	imageHint: 'Square images recommended. PNG, JPEG, WebP, GIF or APNG, up to 20 MB. Animation is preserved.',
	linkHint: 'A full HTTP or HTTPS URL. Visitors open this link in a new tab.',
	enabled: 'Publish this ad', enabledHint: 'Changes take effect after saving. Turn this off and save to unpublish.',
	published: 'Published', draft: 'Not published', save: 'Save this slot', saved: 'Saved', retry: 'Retry',
	loadFailed: 'Could not load ad settings. Please retry.', saveFailed: 'Could not save. Your changes are still here; please retry.',
	invalid: 'Use a valid HTTPS image and an HTTP(S) destination without login credentials.',
	required: 'Add a title, image and destination before publishing.',
	titleTooLong: 'Keep the ad title within 80 characters.',
	invalidImage: 'Choose a non-sensitive PNG, JPEG, WebP, GIF or APNG image.', tooLarge: 'The image must be 20 MB or smaller.',
	uploadFailed: 'Upload failed. Please retry.', imageFailed: 'Image unavailable. Choose another image or check its URL.',
	adminOnly: 'Only administrators can edit these slots.', opens: 'opens in a new tab', preview: 'Preview',
} : {
	title: '广告', settings: '社区广告位', manage: '管理', empty: '广告位待上架',
	positions: ['左上', '右上', '左下', '右下'],
	intro: '四个固定广告位展示在社区右侧下方。每格独立保存，只有上架的广告才对访客展示。',
	image: '广告图片', name: '广告标题 / 图片说明', link: '跳转链接',
	upload: '上传图片', choose: '选择已有图片', cancel: '取消上传', remove: '移除图片',
	imageHint: '建议使用正方形图片。支持 PNG、JPEG、WebP、GIF、APNG，最大 20 MB，保留动图效果。',
	linkHint: '请填写完整的 HTTP 或 HTTPS 网址，点击广告后在新窗口打开。',
	enabled: '上架此广告', enabledHint: '保存后生效。关闭并保存即可下架。',
	published: '已上架', draft: '未上架', save: '保存此广告位', saved: '已保存', retry: '重试',
	loadFailed: '广告配置加载失败，请重试。', saveFailed: '保存失败，修改内容已保留，请重试。',
	invalid: '请使用有效的 HTTPS 图片地址与 HTTP(S) 跳转链接，网址不能包含登录凭据。',
	required: '上架前请填写标题、图片和跳转链接。',
	titleTooLong: '广告标题不能超过 80 个字符，请缩短后再保存。',
	invalidImage: '请选择未标记敏感内容的 PNG、JPEG、WebP、GIF 或 APNG 图片。', tooLarge: '图片大小不能超过 20 MB。',
	uploadFailed: '图片上传失败，请重试。', imageFailed: '图片无法加载，请更换图片或检查地址。',
	adminOnly: '仅管理员可编辑广告位。', opens: '在新窗口打开', preview: '预览',
};
