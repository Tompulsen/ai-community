/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { homeLanguage } from '@/pages/home/copy.js';

const zh = {
	save: '保存社区设置', saved: '社区设置已保存。', recommended: '发现作品', settings: '作品刷新', mode: '展示顺序', shuffle: '每次刷新换一批', latest: '最新发布优先',
	pool: '优先换新的作品数', mobile: '开启手机顶部下拉刷新',
	shuffleHint: '在最近的这些作品中重新排列，继续翻页可查看更早的作品。可填 20–1000，默认 200。',
	latestHint: '按发布时间排序；刷新会加载新发布的作品，没有新作品时顺序保持不变。',
	scope: '适用于社区发现和分类列表，保留搜索与标签条件；个人主页、作品管理和审核列表保持原有顺序。保存后刷新社区生效。',
	invalidPool: '请输入 20–1000 之间的整数。', pull: '下拉刷新作品', release: '松开刷新', refreshing: '正在刷新作品…', updated: '作品已刷新',
};
const en: typeof zh = {
	save: 'Save community settings', saved: 'Community settings saved.', recommended: 'Discover works', settings: 'Work feed refresh', mode: 'Display order', shuffle: 'Shuffle on refresh', latest: 'Newest first',
	pool: 'Recent works to shuffle', mobile: 'Enable pull to refresh on mobile',
	shuffleHint: 'Reorder this many recent works, then continue to older works. Enter 20–1000; the default is 200.',
	latestHint: 'Order by publication time. Refresh loads new work; the order stays the same when nothing new has been published.',
	scope: 'Applies to discovery and category feeds, preserving searches and tags. Profiles, work management and moderation keep their existing order. Refresh the community after saving.',
	invalidPool: 'Enter a whole number between 20 and 1000.', pull: 'Pull to refresh works', release: 'Release to refresh', refreshing: 'Refreshing works…', updated: 'Works refreshed',
};
export const refreshText = homeLanguage === 'zh-CN' ? zh : en;
