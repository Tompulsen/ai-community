/* SPDX-License-Identifier: AGPL-3.0-only */
import { lang } from '@@/js/config.js';

const zh = {
	remixRetry: '重试填入', remixLoading: '正在填入提示词、模型与参考图…', remixTimeout: '填入尚未完成，请重试。', remixFailed: '无法填入，请重试。',
	connecting: '正在连接你的制作空间…', connected: '账号已联通', identity: '创作与消费账号',
	checkingAccount: '正在验证创作账号…', loadingWorkspace: '账号已确认，正在加载制作界面…', slowConnection: '连接耗时较长，你可以继续等待或重新连接。',
	authorizeTitle: '连接你的章鱼制作空间', authorizeHint: '首次进入需要在账号站确认授权，完成后会自动返回这里。文本、图片和视频请求均使用绑定的章鱼账号。', authorize: '确认账号并连接',
	bindTitle: '绑定你的章鱼账号', bindHint: '验证当前社区账号后，前往章鱼确认要绑定的账号。社区作品会保留在当前账号下。', password: '当前社区账号密码', factor: '两步验证码或恢复码', bind: '验证并前往绑定',
	confirmTitle: '确认关联这两个账号', community: '社区账号', newApi: '章鱼账号', confirm: '确认绑定', cancel: '返回社区',
	conflict: '该章鱼账号已关联其他社区账号，或当前社区账号已有其他绑定。请使用原关联账号登录，不能自动合并。', bindError: '验证未通过，请检查社区密码和两步验证码后重试。',
	failure: '制作空间暂时未连接，请重新连接。', storage: '浏览器未能保存制作会话。请允许此站点的分区存储后重试。', expired: '账号登录已变化或连接已过期，请重新连接。',
	retry: '重新连接', refresh: '刷新制作空间', readyHint: '请求结果会显示在当前页面，费用计入对应章鱼账号。',
};
const en: Record<keyof typeof zh, string> = {
	remixRetry: 'Retry fill', remixLoading: 'Filling prompt, model and references…', remixTimeout: 'The fill has not finished. Please retry.', remixFailed: 'Could not fill the studio. Please retry.',
	connecting: 'Connecting your studio…', connected: 'Account connected', identity: 'Creation and billing account',
	checkingAccount: 'Verifying your creation account…', loadingWorkspace: 'Account verified. Loading your studio…', slowConnection: 'This is taking longer than usual. You can keep waiting or reconnect.',
	authorizeTitle: 'Connect your Octopus studio', authorizeHint: 'Confirm authorization at your account site once, then return here automatically. Text, image and video requests use your linked 章鱼 account.', authorize: 'Confirm account and connect',
	bindTitle: 'Link your 章鱼 account', bindHint: 'Verify your current community account, then choose your 章鱼 account. Your community work stays with this account.', password: 'Current community password', factor: 'Two-factor or recovery code', bind: 'Verify and link account',
	confirmTitle: 'Confirm these linked accounts', community: 'Community account', newApi: '章鱼 account', confirm: 'Confirm link', cancel: 'Back to community',
	conflict: 'An account is already linked elsewhere. Sign in with the existing linked account. Accounts cannot be merged automatically.', bindError: 'Verification failed. Check your community password and two-factor code.',
	failure: 'Could not connect to the studio. Please reconnect.', storage: 'Your browser could not save the studio session. Allow partitioned site storage and retry.', expired: 'Your account changed or the connection expired. Please reconnect.',
	retry: 'Reconnect', refresh: 'Refresh studio', readyHint: 'Results appear here. Usage is charged to your matching 章鱼 account.',
};
export const studioText = lang.startsWith('en') ? en : zh;

const backgroundZh = {
	title: '后台生成任务', tasks: '后台任务', generating: '后台生成', hide: '隐藏任务小窗', complete: '生成完成', error: '任务需要处理', videoRunning: '视频生成中…', imageRunning: '图片生成中…',
	open: '打开作品', studio: 'AI 工作台', previous: '上一任务', next: '下一任务', hint: '拖动可移动 · 长按可隐藏 · 单击查看生成',
	previewTitle: '生成作品', loading: '正在打开作品…', imageAlt: '生成图片', download: '下载', retryOpen: '重新打开', close: '关闭', goStudio: '前往 AI 工作台',
	unlinked: '请先前往 AI 工作台绑定创作账号。', authorize: '请前往 AI 工作台完成账号授权。', connectionError: '工作台连接中断，请前往工作台重新连接。',
	readError: '作品无法读取，请前往工作台查看。', reconnecting: '工作台正在连接，请稍后重新打开。', slow: '作品读取较慢，请稍后重新打开或前往工作台。',
	imageComplete: '图片已生成完成，可打开作品下载。', videoComplete: '视频已生成完成，可打开作品下载。', modeSummary: '后台直接生成 / 去 AI 工作台',
	chooseHint: '后台直接生成可继续浏览社区；去 AI 工作台可先调整内容再生成。后台生成将使用当前创作账号额度。', referenceHint: '点选需要的参考图；不选择则仅使用提示词。',
	needsPrompt: '后台生成需要提示词，可先前往工作台补充。', workbenchMode: '去 AI 工作台生成', backgroundMode: '后台直接生成',
};
const backgroundEn: Record<keyof typeof backgroundZh, string> = {
	title: 'Background generation tasks', tasks: 'Background tasks', generating: 'Background generation', hide: 'Hide task window', complete: 'Generation complete', error: 'Task needs attention', videoRunning: 'Generating video…', imageRunning: 'Generating image…',
	open: 'Open result', studio: 'AI Studio', previous: 'Previous task', next: 'Next task', hint: 'Drag to move · Hold to hide · Click to view',
	previewTitle: 'Generated work', loading: 'Opening your work…', imageAlt: 'Generated image', download: 'Download', retryOpen: 'Try again', close: 'Close', goStudio: 'Go to AI Studio',
	unlinked: 'Open AI Studio to link your creation account.', authorize: 'Open AI Studio to authorize your account.', connectionError: 'The studio connection was interrupted. Open AI Studio to reconnect.',
	readError: 'Could not read the result. View it in AI Studio.', reconnecting: 'AI Studio is connecting. Please try opening the result shortly.', slow: 'Loading is taking longer than usual. Try again or open AI Studio.',
	imageComplete: 'Your image is ready. Open it to preview or download.', videoComplete: 'Your video is ready. Open it to preview or download.', modeSummary: 'Generate in background / Open AI Studio',
	chooseHint: 'Generate in the background and keep browsing, or adjust your draft in AI Studio. Background generation uses your account balance.', referenceHint: 'Select references to include, or leave them unselected to use only the prompt.',
	needsPrompt: 'Add a prompt in AI Studio before generating.', workbenchMode: 'Open AI Studio', backgroundMode: 'Generate in background',
};
export const backgroundText = lang.startsWith('en') ? backgroundEn : backgroundZh;
