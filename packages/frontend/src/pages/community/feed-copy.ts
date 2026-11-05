/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { homeLanguage } from '@/pages/home/copy.js';

const zh = {
	latest: '最新作品', all: '全部', video: '视频', image: '图片', resource: '文本 · 代码 · Skill', filters: '作品分类', refresh: '刷新作品',
	search: '搜索社区', searchPlaceholder: '作品、内容或创作者', searchAction: '搜索', clearSearch: '清空搜索',
	sidebar: '发现社区', announcements: '最新公告', allAnnouncements: '全部公告', noAnnouncements: '暂时没有新的公告。',
	creators: '优质分享者', creatorsHint: '从近期公开作品中，发现互动活跃的创作者。', noCreators: '还没有可推荐的分享者。新的公开作品会让这里热闹起来。',
	follow: '关注', following: '已关注', followPending: '等待批准', followingBusy: '正在处理…', followConfirm: '关注 {name}？',
	followFailed: '关注未能完成，请稍后重试。', followUncertain: '关注结果尚未确认，请先刷新状态。', refreshFollow: '刷新状态', ownProfile: '我的主页',
	loading: '正在加载…', loadFailed: '暂时无法加载，请重试。', retry: '重试', showDiscovery: '查看公告与分享者', hideDiscovery: '收起公告与分享者', viewProfile: '查看创作者主页',
};
const en: typeof zh = {
	latest: 'Latest work', all: 'All', video: 'Video', image: 'Images', resource: 'Text · Code · Skills', filters: 'Work categories', refresh: 'Refresh work',
	search: 'Search community', searchPlaceholder: 'Work, content or creator', searchAction: 'Search', clearSearch: 'Clear search',
	sidebar: 'Discover the community', announcements: 'Latest announcements', allAnnouncements: 'View all', noAnnouncements: 'No new announcements yet.',
	creators: 'Creators to discover', creatorsHint: 'Meet creators whose recent public work sparks conversation.', noCreators: 'No creators to recommend yet. New public work will bring people here.',
	follow: 'Follow', following: 'Following', followPending: 'Requested', followingBusy: 'Working…', followConfirm: 'Follow {name}?',
	followFailed: 'Could not follow this creator. Please try again.', followUncertain: 'The follow result is unconfirmed. Refresh its status first.', refreshFollow: 'Check status', ownProfile: 'My profile',
	loading: 'Loading…', loadFailed: 'Could not load this section. Please retry.', retry: 'Retry', showDiscovery: 'Show announcements and creators', hideDiscovery: 'Hide announcements and creators', viewProfile: 'View creator profile',
};

export const feedText = homeLanguage === 'en-US' ? en : zh;
