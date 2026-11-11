/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { homeLanguage } from '@/pages/home/copy.js';

const zh = {
	chancesTitle: '用户抽奖次数', chancesHint: '为社区用户追加次数，或手动设置剩余次数。保存后立即生效，并记录管理员、修改前后次数及备注。',
	selectUser: '选择用户', changeUser: '更换用户', selectUserHint: '先搜索并选择一位社区用户，查看和调整其抽奖次数。', chancesLoading: '正在读取用户次数…',
	adjustmentMode: '调整方式', addChances: '追加次数', setChances: '设置剩余次数', chancesToAdd: '追加次数（次）', chancesToSet: '剩余次数（次）',
	adjustmentReason: '调整备注（选填）', adjustmentReasonHint: '例如：活动奖励、补发或纠正次数', afterAdjustment: '调整后可用次数：',
	addChancesHint: '在当前剩余次数上增加，不影响已领取的任务奖励。', setChancesHint: '直接替换剩余次数，填 0 可清零；已领取的任务奖励不会重复发放。',
	saveChances: '保存次数', confirmAdjustment: '确认调整这位用户的抽奖次数？', chancesSaved: '用户抽奖次数已保存。',
	chancesLoadFailed: '暂时无法读取用户次数，请点击刷新后重试。', chancesForbidden: '仅管理员可管理有效的本地社区用户，请检查账号状态或更换用户。',
	chancesConflict: '用户次数已变化，本次未修改。请刷新后核对次数，再确认保存。', chancesInvalid: '次数须为 0–2,147,483,647 的整数，追加须大于 0，且调整后不能超出上限。请刷新后重试。',
	chancesUncertain: '本次保存结果尚未确认。请核对本次调整；同一请求不会重复增加次数。', checkAdjustment: '核对本次调整', adjustmentLog: '调整抽奖次数',
	beforeDrawOdds: '抽奖前参考概率', snapshotHint: '当前保留本轮转盘快照，刷新后查看最新奖池。',
	probabilityInput: '设定中奖概率（%）', probabilityTotal: '设定概率合计', probabilityHint: '为启用的奖品分别填写百分比，合计须为 100%。谢谢参与也占用概率；售罄奖品暂时退出抽取，剩余奖项按比例计算当前概率。', probabilityInvalid: '请将启用奖品的概率设为 0.01%–100%，保留最多两位小数，合计必须为 100%。',
	wheelTitle: '幸运转盘', wheelSubtitle: '每一次创作与分享，都值得一份惊喜。', wheelStart: '开启幸运', wheelPreparing: '待上架', wheelPreview: '预览', wheelFallback: '转盘暂时无法显示，仍可使用抽奖按钮查看真实结果。',
	wheelDesign: '转盘个性化', wheelDesignHint: '预览随编辑实时更新，保存后才会在抽奖页生效。预览不消耗次数，也不发放奖励。', wheelTheme: '转盘主题', teal: '翡翠青', violet: '梦幻紫', sunset: '暖橘金', wheelHeading: '活动标题', wheelDescription: '活动副标题', wheelButton: '中心按钮文字', wheelRules: '补充活动说明', wheelRulesHint: '可填写活动时间、领奖说明等；系统计次与发奖规则仍按下方配置执行。', wheelConfigure: '配置奖品与规则', wheelBatchHint: '连抽只展示最后一次落点，全部奖励会在下方列出。', wheelDenseHint: '转盘编号对应下方奖品顺序，请查看完整名称与概率。', wheelPreviewCount: '个奖项已加入转盘', wheelNoPrizes: '添加并启用奖品后，这里会显示你的实际奖池。', wheelReceiptChanged: '本次奖池已更新，转盘已按实际中奖结果展示。', wheelUnsaved: '有未保存的修改',

	linkAccount: '绑定余额账号', amount: '余额金额（USD）', accountRequired: '请先在创作页绑定站内余额账号，再参与抽奖。', creditUnavailable: '自动入账服务未连接，请先完成服务器对接后开启活动。',
	title: '幸运抽奖', adminTitle: '抽奖管理', entryHint: '邀请好友、分享创作，赢取抽奖机会', intro: '让每一份分享，多一份惊喜。', back: '返回社区', refresh: '刷新', loading: '正在加载抽奖活动…', retry: '重试', loadFailed: '暂时无法读取抽奖活动，请重试。',
	available: '可用抽奖次数', times: '次', draw: '立即抽奖', drawing: '正在揭晓…', login: '登录参与', signup: '注册新账号', loginHint: '登录后查看你的抽奖机会和中奖记录。', paused: '活动暂未开启，欢迎稍后回来。', emptyPool: '奖品准备中，敬请期待。', noChances: '暂时没有可用次数，完成下方任务即可获得。',
	animationHint: '转盘扇区大小仅为展示效果，实际概率以奖品列表为准。', result: '本次抽奖结果', pending: '待入账', fulfilled: '已到账', empty: '未中奖', resultHint: '中奖余额将自动加入你的站内账户，到账状态可在抽奖记录中查看。',
	tasks: '获取抽奖机会', invites: '邀请好友', likes: '作品获赞', followers: '粉丝成长', inviteHint: '好友通过专属链接首次创建社区账号后计入邀请。已有账号登录或绑定不会重复计数。', link: '我的邀请链接', copy: '复制链接', copied: '已复制', copyFailed: '复制失败，请选中链接手动复制。',
	each: '每满', reward: '奖励', people: '人', likesUnit: '赞', current: '当前', earned: '已获', disabled: '未启用', totalLikes: '所有作品合计', workLikes: '每篇作品分别累计', bestWork: '最高单篇点赞',
	prizes: '活动奖品', probability: '当前概率', unlimited: '不限库存', remaining: '剩余', soldOut: '已抽完', rules: '活动规则', rulesBody: '邀请按首次成功注册累计。点赞与关注仅统计有效本地账号的心形点赞与关注，作者自赞不计入。进入本页或抽奖时核算已达标奖励，同一里程碑不会重复发放。规则调整后按新规则补足新增权益，已发次数不扣回；粉丝或点赞减少后再恢复不会重复领取。',
	stockHint: '概率随可用奖品和库存变化，每次抽取以服务端当时的奖池为准。', history: '我的抽奖记录', allHistory: '中奖与到账记录', noHistory: '还没有抽奖记录。你的第一份惊喜，从这里开始。', historyFailed: '记录加载失败，请重试。', more: '加载更多', historyNote: '到账金额',
	uncertain: '结果尚未确认。请点击“查询本次结果”，系统会安全重试同一笔抽奖。', checkResult: '查询本次结果', drawFailed: '抽奖未完成，请刷新后重试。', conflict: '配置或库存已更新，请重新加载后再保存。你的输入仍保留在当前页面。', insufficient: '可用次数不足，请刷新查看最新次数。',
	adminIntro: '设置参与条件、余额奖品与概率，中奖后自动入账。', enabled: '开启抽奖活动', save: '保存设置', saving: '正在保存…', saved: '设置已保存', saveFailed: '保存失败，请检查输入并重试。', reload: '重新加载配置', reloadConfirm: '重新加载会覆盖尚未保存的设置，是否继续？',
	ruleHint: '门槛和每档奖励均为正整数。保存后按新规则补足权益，不会清空已有次数。', threshold: '达标门槛', tickets: '每档奖励次数', likesMode: '点赞计算方式', prizeHint: '权重决定相对概率；库存 -1 表示不限。余额奖品按 USD 配置，中奖后自动入账。', addPrize: '添加奖品', remove: '移除', prizeName: '奖品名称', description: '奖品说明', weight: '概率权重', stock: '剩余库存', kind: '奖品类型', custom: '站内余额', none: '谢谢参与', prizeEnabled: '参与抽奖', preview: '查看抽奖页',
	fulfill: '重试入账', fulfillConfirm: '重新尝试将待入账奖励充值到原中奖账户？同一笔不会重复加款。', fulfillHint: '系统最多自动尝试 3 次，账号或金额冲突时停止。处理问题后可在这里重试。', fulfillFailed: '重试失败，请稍后再试。', adminOnly: '只有管理员可以编辑抽奖活动。', noAdminHistory: '暂无中奖记录。', user: '用户', invalid: '请填写有效规则、奖品名称和库存；开启活动至少需要一份可用奖品。',
};
const en: typeof zh = {
	chancesTitle: 'User draw chances', chancesHint: 'Add chances or set a community user’s remaining balance. Changes take effect immediately and record the administrator, before/after counts and note.',
	selectUser: 'Select user', changeUser: 'Change user', selectUserHint: 'Search for a community user to view and adjust their draw chances.', chancesLoading: 'Loading user chances…',
	adjustmentMode: 'Adjustment type', addChances: 'Add chances', setChances: 'Set remaining chances', chancesToAdd: 'Chances to add', chancesToSet: 'Remaining chances',
	adjustmentReason: 'Adjustment note (optional)', adjustmentReasonHint: 'For example: campaign reward or correction', afterAdjustment: 'Chances after adjustment:',
	addChancesHint: 'Adds to the current balance without changing claimed task rewards.', setChancesHint: 'Replaces the remaining balance; enter 0 to clear it. Claimed task rewards will not be awarded again.',
	saveChances: 'Save chances', confirmAdjustment: 'Confirm the change to this user’s draw chances?', chancesSaved: 'User draw chances saved.',
	chancesLoadFailed: 'Could not load user chances. Refresh to retry.', chancesForbidden: 'Only administrators can manage eligible local users. Check the account status or choose another user.',
	chancesConflict: 'The user’s balance changed. Nothing was updated. Refresh and review it before saving again.', chancesInvalid: 'Use a whole number from 0 to 2,147,483,647. Added chances must be positive and the resulting balance must stay within this range. Refresh to retry.',
	chancesUncertain: 'The save result is not confirmed yet. Check this adjustment; the same request will not add chances twice.', checkAdjustment: 'Check this adjustment', adjustmentLog: 'Adjust draw chances',
	beforeDrawOdds: 'Odds before this draw', snapshotHint: 'This wheel keeps the draw snapshot. Refresh to see the latest pool.',
	probabilityInput: 'Winning probability (%)', probabilityTotal: 'Configured total', probabilityHint: 'Set a percentage for each enabled prize, totaling 100%. No-prize outcomes also need a percentage. Sold-out prizes leave the live pool and remaining odds are proportionally recalculated.', probabilityInvalid: 'Use 0.01%–100% with up to two decimals for enabled prizes. Their total must be 100%.',
	wheelTitle: 'Lucky wheel', wheelSubtitle: 'A little surprise for every creation you share.', wheelStart: 'Try your luck', wheelPreparing: 'Coming soon', wheelPreview: 'Preview', wheelFallback: 'The wheel is unavailable. Use the draw button to see your confirmed result.',
	wheelDesign: 'Personalize the wheel', wheelDesignHint: 'The preview updates as you edit. Save to publish it. Previewing does not use chances or award prizes.', wheelTheme: 'Wheel theme', teal: 'Jade', violet: 'Violet', sunset: 'Sunset', wheelHeading: 'Activity title', wheelDescription: 'Activity subtitle', wheelButton: 'Center button text', wheelRules: 'Additional activity notes', wheelRulesHint: 'Add dates or redemption notes. Chances and rewards still follow the settings below.', wheelConfigure: 'Configure prizes and rules', wheelBatchHint: 'The wheel shows the last draw in a batch. All rewards are listed below.', wheelDenseHint: 'Wheel numbers match the prize order below. See the list for full names and odds.', wheelPreviewCount: 'prizes on the wheel', wheelNoPrizes: 'Add and enable prizes to preview your actual pool.', wheelReceiptChanged: 'The pool changed. The wheel now shows the confirmed winning prize.', wheelUnsaved: 'Unsaved changes',

	linkAccount: 'Link balance account', amount: 'Balance amount (USD)', accountRequired: 'Link your balance account on the creation page before drawing.', creditUnavailable: 'Connect the balance service before enabling the lottery.',
	title: 'Lucky draw', adminTitle: 'Lottery settings', entryHint: 'Invite friends, share creations and earn chances', intro: 'A little surprise for every contribution.', back: 'Back to community', refresh: 'Refresh', loading: 'Loading the lottery…', retry: 'Retry', loadFailed: 'Could not load the lottery. Please retry.',
	available: 'Available chances', times: 'draws', draw: 'Draw now', drawing: 'Revealing…', login: 'Sign in to join', signup: 'Create an account', loginHint: 'Sign in to see your chances and draw history.', paused: 'The lottery is paused. Please come back later.', emptyPool: 'Prizes are being prepared.', noChances: 'No chances available yet. Complete the tasks below to earn more.',
	animationHint: 'Wheel sector sizes are decorative. Actual odds appear in the prize list.', result: 'Your draw results', pending: 'Credit pending', fulfilled: 'Credited', empty: 'No prize', resultHint: 'Rewards are automatically credited to your linked balance account. Check their status in your history.',
	tasks: 'Earn more chances', invites: 'Invite friends', likes: 'Likes on your work', followers: 'Grow your audience', inviteHint: 'Friends count when they first create a community account through your link. Existing accounts and account linking do not count.', link: 'Your invitation link', copy: 'Copy link', copied: 'Copied', copyFailed: 'Could not copy. Select the link and copy it manually.',
	each: 'Every', reward: 'earns', people: 'people', likesUnit: 'likes', current: 'Current', earned: 'Earned', disabled: 'Disabled', totalLikes: 'All works combined', workLikes: 'Each work separately', bestWork: 'Most likes on one work',
	prizes: 'Prizes', probability: 'Current odds', unlimited: 'Unlimited stock', remaining: 'Remaining', soldOut: 'Out of stock', rules: 'Lottery rules', rulesBody: 'Invitations accumulate on each successful first signup. Only heart likes and follows from valid local accounts count; self-likes do not. Eligible milestones are credited when you visit this page or draw, once per milestone. Rule changes may add new entitlement without removing earned chances. Losing and regaining likes or followers does not award the same entitlement twice.',
	stockHint: 'Odds change with the available pool and stock. Each draw uses the server’s current pool.', history: 'Your draw history', allHistory: 'Draws and deliveries', noHistory: 'No draws yet. Your first surprise starts here.', historyFailed: 'Could not load history. Please retry.', more: 'Load more', historyNote: 'Delivery note',
	uncertain: 'The result is not confirmed yet. Check this draw to safely retry the same request.', checkResult: 'Check this draw', drawFailed: 'The draw could not complete. Refresh and retry.', conflict: 'Settings or stock changed. Reload before saving. Your current edits are preserved.', insufficient: 'Not enough chances. Refresh to see your latest balance.',
	adminIntro: 'Set earning rules and prizes, then track winners and deliveries.', enabled: 'Enable the lottery', save: 'Save settings', saving: 'Saving…', saved: 'Settings saved', saveFailed: 'Could not save. Check the values and retry.', reload: 'Reload settings', reloadConfirm: 'Reloading will replace unsaved settings. Continue?',
	ruleHint: 'Thresholds and rewards must be positive integers. Changes may add entitlement without resetting earned chances.', threshold: 'Milestone threshold', tickets: 'Chances per milestone', likesMode: 'How likes are counted', prizeHint: 'Weights set relative odds. Stock -1 means unlimited. Balance rewards are specified in USD and credited automatically.', addPrize: 'Add prize', remove: 'Remove', prizeName: 'Prize name', description: 'Description', weight: 'Probability weight', stock: 'Remaining stock', kind: 'Prize type', custom: 'Account balance', none: 'No prize', prizeEnabled: 'Include in pool', preview: 'Open lottery',
	fulfill: 'Retry credit', fulfillConfirm: 'Retry crediting pending rewards to the original account? This cannot credit the same reward twice.', fulfillHint: 'Delivery is attempted up to three times and stops on account or amount conflicts. Retry here after resolving the issue.', fulfillFailed: 'Could not update delivery. Please retry.', adminOnly: 'Only administrators can edit the lottery.', noAdminHistory: 'No draws yet.', user: 'User', invalid: 'Check the rules, names and stock. An active lottery needs an available prize.',
};
export const lotteryText = homeLanguage === 'en-US' ? en : zh;
