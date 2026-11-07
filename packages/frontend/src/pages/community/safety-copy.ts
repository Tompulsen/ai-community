/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { lang } from '@@/js/config.js';

const zh = {
	settings: '账号封禁规则', enabled: '违规达到阈值时自动封禁', threshold: '自动封禁阈值（次）',
	ruleHint: '作品与评论合并累计。仅管理员确认的违规计数，同一作品或评论最多计入一次。默认 3 次，可设为 1–1000 次。',
	scopeHint: '规则从下一次确认新的违规时生效，不追溯封禁。解封保留历史记录，并从零累计新的违规。',
	invalidThreshold: '请输入 1 到 1000 之间的整数。', reports: '处理用户举报', users: '管理用户与封禁',
	countViolation: '确认此作品违规，驳回时计入违规次数', removeHint: '“违规下架”自动计入一次违规；普通驳回不计入，除非勾选上方选项。',
	report: '举报', reportWork: '举报作品', reportComment: '举报评论', reportHint: '请说明违规原因。举报将交给管理员核查，不会直接封禁作者。',
	sending: '提交中…', reported: '已举报', reportSuccess: '举报已提交，管理员将核查处理。', reportFailed: '举报提交失败，请重试；填写的原因已保留。',
	reasonRequired: '请填写具体违规原因。', reportForbidden: '无法举报自己的内容或管理员内容。', reportUnavailable: '内容已删除或当前不可见，无法举报。',
	acceptTitle: '确认举报内容违规？', acceptHint: '确认后，该内容计入作者的违规次数；达到阈值会自动封禁。同一内容不重复计数。作品下架请到作品审核处理，评论可从原评论页面删除。',
	snapshot: '举报时的内容快照', activeCount: '本轮违规次数', totalCount: '历史违规总数', unsuspendHint: '解封后保留历史记录，本轮违规次数归零。',
	banFailed: '账号状态更新失败，请刷新后重试。', banRefreshFailed: '账号状态已更新，但详细信息刷新失败，请重新打开此用户。',
};
const en: Record<keyof typeof zh, string> = {
	settings: 'Account suspension rules', enabled: 'Suspend accounts at the violation threshold', threshold: 'Violations before suspension',
	ruleHint: 'Confirmed work and comment violations are counted together. Each work or comment counts at most once. Default: 3; range: 1–1000.',
	scopeHint: 'Changes apply when the next new violation is confirmed, without retroactive suspensions. Unsuspension preserves history and resets the active count.',
	invalidThreshold: 'Enter a whole number from 1 to 1000.', reports: 'Review user reports', users: 'Manage users and suspensions',
	countViolation: 'Confirm this work violates the rules and count the rejection', removeHint: 'Removing a violation counts once. An ordinary rejection only counts when the option above is selected.',
	report: 'Report', reportWork: 'Report work', reportComment: 'Report comment', reportHint: 'Describe the violation. A moderator will review your report before any account action.',
	sending: 'Submitting…', reported: 'Reported', reportSuccess: 'Report submitted for moderator review.', reportFailed: 'Could not submit the report. Retry; your reason has been kept.',
	reasonRequired: 'Enter a specific reason for reporting.', reportForbidden: 'You cannot report your own content or administrator content.', reportUnavailable: 'This content was deleted or is no longer visible.',
	acceptTitle: 'Confirm this content violates the rules?', acceptHint: 'This counts a violation for the author and may suspend the account at the threshold. Each content item counts once. Remove work in Work moderation, or delete a comment from its original page.',
	snapshot: 'Content when reported', activeCount: 'Current violation count', totalCount: 'Lifetime violations', unsuspendHint: 'Unsuspension preserves history and resets the current violation count.',
	banFailed: 'Could not update the account. Refresh and retry.', banRefreshFailed: 'Account status updated, but details could not be refreshed. Reopen this user.',
};
export const safetyText = lang.startsWith('en') ? en : zh;
