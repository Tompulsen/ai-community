/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Project-owned Chinese copy, isolated from upstream Crowdin-managed locale files.
export const communityText = {
	brand: 'AI 创作社区', community: '创作社区', workspace: '创作工作台',
	video: '视频社区', image: '图片社区', resource: '文本 · 代码 · Skill',
	profile: '个人主页', allWorks: '全部作品', profileWorks: '公开作品', editProfile: '编辑个人资料', profileDetails: '更多资料', joined: '加入于', following: '关注', followers: '关注者', profileEmpty: '暂时没有公开作品', profileEmptyHint: '该分类下通过审核的作品会显示在这里。',
	mine: '我的投稿', review: '作品审核', ai: 'AI 工作台',
	descriptions: {
		video: '分享 AI 影像，也分享镜头背后的创作方法。',
		image: '从一张图开始，交流灵感、提示词与创作过程。',
		resource: '让文字、代码和开源 Skill 成为下一次创作的起点。',
		profile: '浏览创作者已通过审核的作品。',
		mine: '查看投稿进度与审核反馈，通过后作品将公开展示。',
		review: '先审核，后公开。核对作品内容与附件，再作出决定。',
		ai: '创作工具的下一站。这里将连接第三方 AI 服务。',
	},
	search: '搜索当前社区', searchPlaceholder: '搜索作品标题、内容或创作者', searchAction: '搜索',
	writePrompt: '分享你的最新创作', publish: '投稿作品', submit: '提交审核', submitting: '正在提交…', close: '关闭投稿弹窗',
	login: '登录', signup: '注册账号', signupClosed: '注册受限，可使用邀请码注册',
	loginTitle: '登录后，加入创作与交流', loginHint: '你可以先浏览已通过审核的作品。投稿和评论需要登录。',
	latest: '最新作品', approvedOnly: '仅展示审核通过的作品',
	all: '全部状态', pending: '待审核', approved: '已通过', rejected: '未通过',
	loading: '正在加载作品…', loadMore: '加载更多', retry: '重新加载', refresh: '刷新',
	empty: '这里还没有作品', emptyHint: '第一份通过审核的作品会出现在这里。',
	emptyMine: '还没有投稿记录', emptyMineHint: '分享你的创作，审核通过后会在对应社区展示。',
	emptyReview: '当前没有待处理的作品', emptyReviewHint: '新的投稿将进入这里，等待审核。',
	emptySearch: '没有找到相关作品', emptySearchHint: '试试其他关键词，或清空搜索查看全部作品。',
	loadError: '暂时无法加载作品', serviceUnavailable: '社区审核服务尚未接通，当前无法读取作品或提交审核。',
	networkError: '连接失败，请检查网络后重试。你的输入仍然保留。',
	permissionError: '当前账号没有执行此操作的权限。', loginError: '登录已失效，请重新登录后再试。',
	conflictError: '这份投稿已被处理或版本发生变化，请刷新列表后重试。',
	invalidResponse: '服务返回了无法识别的数据，请稍后重试。',
	submitted: '已提交，等待审核。可在“我的投稿”查看进度。',
	reviewed: '审核结果已保存。',
	composerTools: '投稿工具', insertCode: '插入代码块', addSource: '添加来源链接', codeLimit: '正文已接近字数上限，请删减后再插入代码块。', approvalVisibility: '审核通过后公开',
	destination: '投放到', draftHint: '输入仅在本页保留', moreDetails: '补充模型、来源与授权（选填）',
	categoryFileHints: { video: '至少添加一个视频，最多 16 个附件。', image: '至少添加一张图片，最多 16 个附件。', resource: '可分享文本、代码或 Skill，支持添加附件。' },
	category: '投稿社区', title: '作品标题', titlePlaceholder: '给作品起一个清晰的名字',
	content: '作品介绍 / 正文 / 代码', contentPlaceholder: '介绍作品、提示词、创作过程，或粘贴 Markdown / 代码…',
	model: '模型或工具（选填）', modelPlaceholder: '使用了哪些创作工具？',
	source: '源码或原文链接（选填）', sourcePlaceholder: 'https://',
	license: '授权说明（选填）', licensePlaceholder: '例如 MIT，或你允许他人使用作品的方式',
	attachments: '作品附件', chooseFiles: '上传 / 从网盘选择', choosing: '正在选择附件…', removeFile: '移除附件',
	filesHint: '视频社区至少附一个视频，图片社区至少附一张图片；最多 16 个附件。',
	rights: '我确认拥有作品发布权，并已核实所填写的来源与授权说明。',
	moderationHint: '提交后进入待审核列表，通过审核才会在社区公开。',
	attachmentPrivacy: '附件使用现有网盘上传，请勿上传需要保密的文件。',
	titleRequired: '请填写作品标题。', contentRequired: '请填写正文或添加作品附件。',
	videoRequired: '视频社区需要至少一个视频附件。', imageRequired: '图片社区需要至少一张图片附件。',
	tooManyFiles: '最多可添加 16 个附件。', invalidUrl: '来源链接必须使用 http:// 或 https://。', rightsRequired: '请先确认作品发布权。',
	comments: '查看作品与评论', openWork: '查看公开作品', textWork: '文本 / 代码 / Skill',
	sensitive: '包含敏感内容，进入作品详情查看', noCover: '作品附件',
	approve: '通过并公开', reject: '驳回作品', reason: '驳回理由', reasonPlaceholder: '说明需要作者修改的内容（必填）', reasonRequired: '请填写驳回理由。',
	reviewConfirm: '确认已核对作品内容、附件及授权说明。', reviewConfirmRequired: '请先确认已核对作品。', reviewing: '正在保存…',
	users: '用户管理', reports: '举报处理', controlPanel: '管理后台',
	guidelines: '分享，也让创作可复用',
	guideItems: ['写清使用的模型与创作过程。', '转载或开源资源请注明来源和授权。', '围绕作品交流，尊重每一位创作者。'],
	process: '作品发布流程', processItems: ['提交作品与创作说明', '管理员审核内容', '通过后公开，开始交流'],
	reserved: '入口已预留', aiTitle: '把灵感接入创作工具', aiHint: '第三方 AI 服务暂未接入。后续将在这里提供模型选择、调用记录与用量管理。',
	aiItems: ['视频生成', '图片生成', '文本与代码助手'], aiBack: '先去探索社区',
	unknown: '页面不存在', unknownHint: '请选择一个社区继续浏览。',
	forbidden: '此页面仅供管理员和审核员使用',
	detail: '作品内容', reviewAuthor: '投稿人', sourceLabel: '来源', licenseLabel: '授权',
	previewNotice: '组件预览 · 示例数据与操作仅用于验证，不会提交到真实社区',
} as const;

export const communitySections = [
	{ id: 'video', title: communityText.video, icon: 'ti ti-movie', path: '/community/video' },
	{ id: 'image', title: communityText.image, icon: 'ti ti-photo', path: '/community/image' },
	{ id: 'resource', title: communityText.resource, icon: 'ti ti-code', path: '/community/knowledge' },
] as const;

export function safeWebUrl(value: string | null | undefined): string | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value);
		return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
	} catch {
		return undefined;
	}
}
