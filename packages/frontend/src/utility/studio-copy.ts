/* SPDX-License-Identifier: AGPL-3.0-only */
import { lang } from '@@/js/config.js';

const zh = {
	remixRetry: '重试填入', remixLoading: '正在填入提示词、模型与参考图…', remixTimeout: '填入尚未完成，请重试。', remixFailed: '无法填入，请重试。',
	connecting: '正在连接你的制作空间…', connected: '账号已联通', identity: '创作与消费账号',
	checkingAccount: '正在验证创作账号…', loadingWorkspace: '账号已确认，正在加载制作界面…', slowConnection: '连接耗时较长，你可以继续等待或重新连接。',
	authorizeTitle: '连接你的章鱼制作空间', authorizeHint: '首次进入需要在账号站确认授权，完成后会自动返回这里。文本、图片和视频请求均使用绑定的 New API 账号。', authorize: '确认账号并连接',
	bindTitle: '绑定你的 New API 账号', bindHint: '验证当前社区账号后，前往 New API 确认要绑定的账号。社区作品会保留在当前账号下。', password: '当前社区账号密码', factor: '两步验证码或恢复码', bind: '验证并前往绑定',
	confirmTitle: '确认关联这两个账号', community: '社区账号', newApi: 'New API 账号', confirm: '确认绑定', cancel: '返回社区',
	conflict: '该 New API 账号已关联其他社区账号，或当前社区账号已有其他绑定。请使用原关联账号登录，不能自动合并。', bindError: '验证未通过，请检查社区密码和两步验证码后重试。',
	failure: '制作空间暂时未连接，请重新连接。', storage: '浏览器未能保存制作会话。请允许此站点的分区存储后重试。', expired: '账号登录已变化或连接已过期，请重新连接。',
	retry: '重新连接', refresh: '刷新制作空间', readyHint: '请求结果会显示在当前页面，费用计入对应 New API 账号。',
};
const en: Record<keyof typeof zh, string> = {
	remixRetry: 'Retry fill', remixLoading: 'Filling prompt, model and references…', remixTimeout: 'The fill has not finished. Please retry.', remixFailed: 'Could not fill the studio. Please retry.',
	connecting: 'Connecting your studio…', connected: 'Account connected', identity: 'Creation and billing account',
	checkingAccount: 'Verifying your creation account…', loadingWorkspace: 'Account verified. Loading your studio…', slowConnection: 'This is taking longer than usual. You can keep waiting or reconnect.',
	authorizeTitle: 'Connect your Octopus studio', authorizeHint: 'Confirm authorization at your account site once, then return here automatically. Text, image and video requests use your linked New API account.', authorize: 'Confirm account and connect',
	bindTitle: 'Link your New API account', bindHint: 'Verify your current community account, then choose your New API account. Your community work stays with this account.', password: 'Current community password', factor: 'Two-factor or recovery code', bind: 'Verify and link account',
	confirmTitle: 'Confirm these linked accounts', community: 'Community account', newApi: 'New API account', confirm: 'Confirm link', cancel: 'Back to community',
	conflict: 'An account is already linked elsewhere. Sign in with the existing linked account. Accounts cannot be merged automatically.', bindError: 'Verification failed. Check your community password and two-factor code.',
	failure: 'Could not connect to the studio. Please reconnect.', storage: 'Your browser could not save the studio session. Allow partitioned site storage and retry.', expired: 'Your account changed or the connection expired. Please reconnect.',
	retry: 'Reconnect', refresh: 'Refresh studio', readyHint: 'Results appear here. Usage is charged to your matching New API account.',
};
export const studioText = lang.startsWith('en') ? en : zh;
