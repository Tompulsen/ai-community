/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { lang } from '@@/js/config.js';
import { homeTextEn } from './copy.en.js';

// Project-owned bilingual copy; upstream translations remain Crowdin-managed.
const homeTextZh = {
	brand: 'AI 创作社区', home: '官网首页', navigation: '在线制作',
	title: '让灵感冒泡，', titleAccent: '让作品登场。',
	description: '文字、图片、视频，都是你的表达方式。',
	descriptionMore: '把脑海里的小点子，变成可以分享的作品。',
	community: '进入创作社区', communityHint: '无需登录，随时逛逛',
	communityDetail: '发现作品 · 交流灵感 · 分享 Skill',
	login: '登录', signup: '注册账号', account: '我的主页', admin: '管理后台',
	footer: '灵感不设限，创作有伙伴。', footerNote: '文本 / 图片 / 视频 / 开源 Skill',
	showcase: '首页展示图', showcaseTitle: '点子不大，也能很精彩。',
	artTitle: '把想象，变成作品。', artNote: '你的下一个作品，从这里开始',
	sticker: '灵感', stickerMore: '冒泡中',
	loginTitle: '登录后，开始制作', loginHint: '请使用本站账号登录，再进入所选制作页面。',
	loginError: '登录窗口未能打开，请重试。',
	back: '返回首页', browse: '先去逛逛社区',
	settings: '官网首页', settingsDescription: '选择首页右侧展示内容：自定义图片、动图，或社区热门作品。保存后对所有访客生效。',
	imageLabel: '右侧展示图', upload: '上传图片 / 动图', choose: '选择已上传图片', reset: '恢复默认展示',
	formats: '支持 PNG、JPG、GIF、WebP、APNG，最大 20 MB；上传保留原始动画。',
	sizeHint: '建议横向 4:3 图片；完整展示图片，不裁切。上传上限同时受服务器和账号限制。',
	imageUrl: '图片地址', urlHint: '也可填写 HTTPS 图片地址。清空后恢复默认视觉；修改后需要保存。',
	invalidImage: '请选择 PNG、JPG、GIF、WebP 或 APNG 图片，且不能是敏感附件。',
	tooLarge: '图片不能超过 20 MB，请缩小文件后重试。',
	invalidUrl: '请填写有效的 HTTPS 图片地址。',
	imageFailed: '图片无法显示，请重新上传或检查图片地址。',
	uploadFailed: '上传未完成，请重试。原来的图片仍然保留。',
	uploading: '正在上传', cancelUpload: '取消上传',
	loadFailed: '暂时无法读取设置，请重试。', saveFailed: '保存失败，请重试。你的修改仍然保留。',
	saved: '已保存，新形象就位。可以去首页看看了。', save: '保存首页设置', retry: '重试',
	adminOnly: '只有管理员可以修改首页设置。', preview: '查看首页',
	defaultPreview: '当前为默认视觉，使用项目 Logo。',
	creationSettings: '文本、图片、视频的目标网址仍在“制作页面链接”中配置。',
	editCreation: '配置制作页面链接',
	showcaseMode: '展示内容', customMode: '自定义图片 / 动图', popularMode: '社区热门作品',
	popularHint: '自动展示点赞、评论和转发总数最高的公开作品；热度相同时优先展示较新的作品。',
	popularFallback: '暂无符合条件的作品或读取失败时，使用已保存的展示图或默认视觉。',
	popularLoading: '正在读取社区热门作品…', popularEmpty: '暂时没有可展示的公开作品，首页将使用原来的展示图。',
	popularFailed: '热门作品暂时无法读取。可以重试，首页会自动使用原来的展示图。',
	popularReady: '预览已更新。保存后，首页会随社区互动自动展示热门作品。',
	popularTitle: '社区正在热议', popularBadge: '热门', popularBadgeMore: '作品',
	viewWork: '查看作品', popularImage: '图片作品', popularVideo: '视频作品', popularResource: '文档 / Skill',
	comments: '评论', refreshPopular: '刷新热门预览',

	workPreview: '作品展示', workPrompt: '内容 / 提示词', workDiscussion: '作品与评论',
	workUnavailable: '这件作品暂时无法公开展示。', workLoadFailed: '作品暂时无法读取，请稍后重试。',
	noPrompt: '作者暂未提供内容或提示词。', remix: '做同款', copying: '正在复制…',
	remixHint: '复制内容，再到制作页粘贴使用。', remixEmptyHint: '前往对应制作页，开始你的创作。',
	promptCopied: '内容已复制，可在制作页粘贴使用。', copyFailed: '未能复制，请手动选择上方内容复制。', continueCreating: '继续前往制作',
	like: '点赞', liked: '已点赞', replaceReaction: '改为点赞', replaceReactionHint: '你已用其他表情回应，点击“改为点赞”将替换原回应。',
	reactionFailed: '未能确认点赞状态，请刷新后查看。', recentComments: '最新讨论', allComments: '全部评论', refreshComments: '刷新互动',
	commentsLoading: '正在读取评论…', commentsFailed: '评论暂时无法读取，请刷新重试。', noComments: '还没有可展示的公开评论，聊聊你的想法吧。',
	writeComment: '说说你的灵感，给作品一点回应…', sendComment: '发布评论', sendingComment: '发送中…',
	commentLogin: '登录，和作者聊聊你的灵感', interactionLogin: '使用本站账号登录后，即可点赞和发表评论。',
	commentSent: '评论已发送。公开可见的评论会在这里展示。', commentSentRefreshFailed: '评论已发送，但列表刷新失败。请刷新查看。',
	commentRejected: '评论未被接受，请检查内容和账号权限后重试。草稿已保留。',
	commentUncertain: '发送结果尚未确认。草稿已保留，请先查看全部评论核对，避免重复发送。',
	commentRetryConfirm: '已核对，允许重发', commentRetryWarning: '上一条评论可能已经发送成功。再次发送可能产生重复评论，仍要解锁重发吗？',
	language: '界面语言', languageError: '无法保存语言偏好，请检查浏览器存储设置后重试。',
} as const;

export type HomeCopy = { [K in keyof typeof homeTextZh]: string };
export const homeLanguage = lang.startsWith('en') ? 'en-US' : 'zh-CN';
export const homeText: HomeCopy = homeLanguage === 'en-US' ? homeTextEn : homeTextZh;
