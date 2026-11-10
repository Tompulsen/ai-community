/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { homeLanguage } from '@/pages/home/copy.js';

const zh = {
	newShare: '作品分享', desktopHint: '发现灵感，分享创作', makeVideo: '制作视频', makeImage: '生成图片', makeText: '文本创作',
	profilePrivate: '仅自己可见', profileLiked: '点赞过的作品', profileRecent: '最近动态', profileRefresh: '刷新分区', profileNoFavorites: '收藏喜欢的作品，随时回来看看', profileNoLikes: '这里还没有喜欢的作品', profileNoNotes: '还没有动态', profileHiddenLikes: '该用户未公开喜欢的作品', profileRemoteLikes: '暂时无法查看远端用户的喜欢',
	profileWorks: '作品', profileNotes: '动态', profileLikes: '喜欢', profileFavorites: '收藏', profileManage: '作品管理', profileSettings: '设置', profileTools: '创作者工具', profileAddBio: '添加简介，让大家认识你', profileSearch: '搜索主页作品', profileBack: '返回社区',
	mobileNavigation: '社区导航', mobileHome: '首页', mobileCreate: '创作', mobileMessages: '消息', mobileMe: '我', mobileAll: '发现', mobileResource: 'skill', mobileSearch: '搜索与筛选', mobileSwipe: '上滑发现更多作品', mobileDetails: '查看完整作品', mobileEnd: '已经看完啦', mobileMenu: '公告与创作者',
	latest: '最新作品', all: '全部', video: '视频', image: '图片', resource: '文本 · 代码 · Skill', filters: '作品分类', refresh: '刷新作品',
	search: '搜索社区', clearSearch: '重置条件',
	sidebar: '发现社区', announcements: '最新公告', allAnnouncements: '全部公告', noAnnouncements: '暂时没有新的公告。',
	openSidebar: '展开侧栏', closeSidebar: '收起侧栏', explore: '发现社区',
	creators: '优质分享者', creatorsHint: '从近期公开作品中，发现互动活跃的创作者。', noCreators: '还没有可推荐的分享者。新的公开作品会让这里热闹起来。',
	follow: '关注', following: '已关注', followPending: '等待批准', followingBusy: '正在处理…', followConfirm: '关注 {name}？',
	followFailed: '关注未能完成，请稍后重试。', followUncertain: '关注结果尚未确认，请先刷新状态。', refreshFollow: '刷新状态', ownProfile: '我的主页',
	loading: '正在加载…', loadFailed: '暂时无法加载，请重试。', retry: '重试', showDiscovery: '查看公告与分享者', hideDiscovery: '收起公告与分享者', viewProfile: '查看创作者主页',
};
const en: typeof zh = {
	newShare: 'Shared work', desktopHint: 'Discover ideas. Share your creations.', makeVideo: 'Make a video', makeImage: 'Create images', makeText: 'Write with AI',
	profilePrivate: 'Only visible to you', profileLiked: 'Liked works', profileRecent: 'Recent posts', profileRefresh: 'Refresh section', profileNoFavorites: 'Save works to revisit them here', profileNoLikes: 'No liked works here yet', profileNoNotes: 'No posts yet', profileHiddenLikes: 'This user keeps their likes private', profileRemoteLikes: 'Likes are unavailable for remote users',
	profileWorks: 'Works', profileNotes: 'Posts', profileLikes: 'Likes', profileFavorites: 'Saved', profileManage: 'Manage', profileSettings: 'Settings', profileTools: 'Creator tools', profileAddBio: 'Add a bio to introduce yourself', profileSearch: 'Search profile works', profileBack: 'Back to community',
	mobileNavigation: 'Community navigation', mobileHome: 'Home', mobileCreate: 'Create', mobileMessages: 'Inbox', mobileMe: 'Me', mobileAll: 'Discover', mobileResource: 'skill', mobileSearch: 'Search and filters', mobileSwipe: 'Swipe up for more', mobileDetails: 'View full work', mobileEnd: 'You’re all caught up', mobileMenu: 'Announcements and creators',
	latest: 'Latest work', all: 'All', video: 'Video', image: 'Images', resource: 'Text · Code · Skills', filters: 'Work categories', refresh: 'Refresh work',
	search: 'Search community', clearSearch: 'Reset filters',
	sidebar: 'Discover the community', announcements: 'Latest announcements', allAnnouncements: 'View all', noAnnouncements: 'No new announcements yet.',
	openSidebar: 'Show sidebar', closeSidebar: 'Hide sidebar', explore: 'Explore',
	creators: 'Creators to discover', creatorsHint: 'Meet creators whose recent public work sparks conversation.', noCreators: 'No creators to recommend yet. New public work will bring people here.',
	follow: 'Follow', following: 'Following', followPending: 'Requested', followingBusy: 'Working…', followConfirm: 'Follow {name}?',
	followFailed: 'Could not follow this creator. Please try again.', followUncertain: 'The follow result is unconfirmed. Refresh its status first.', refreshFollow: 'Check status', ownProfile: 'My profile',
	loading: 'Loading…', loadFailed: 'Could not load this section. Please retry.', retry: 'Retry', showDiscovery: 'Show announcements and creators', hideDiscovery: 'Hide announcements and creators', viewProfile: 'View creator profile',
};

export const feedText = homeLanguage === 'en-US' ? en : zh;
