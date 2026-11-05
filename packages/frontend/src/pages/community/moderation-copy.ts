/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { lang } from '@@/js/config.js';

const zh = {
	review: '作品审核', settingsTitle: '发布与审核', settingsHint: '新作品按所选模式发布。管理员可审核公开作品，并将违规作品下架。',
	beforeMode: '先审后发', beforeHint: '新作品先进入待审核，通过后才在社区公开。',
	afterMode: '先发后审', afterHint: '新作品立即公开，并进入审核队列；违规作品可下架。',
	modeScope: '保存后仅影响新投稿。已有待审作品仍需逐件处理。',
	modeSave: '保存审核设置', modeSaved: '审核设置已保存。', modeLoadFailed: '无法读取审核设置，请重试。', modeSaveFailed: '保存失败，请重试并确认设置。',
	modeLoading: '正在读取审核设置…', modeRetry: '重新读取', modeAdminOnly: '仅管理员可修改发布模式。',
	unreviewed: '待处理（含已公开）', pending: '待审核 · 未公开', published: '已公开 · 待审核', approved: '已公开 · 已通过', rejected: '审核未通过', removed: '违规 · 已下架', withdrawn: '作品已删除',
	approve: '通过并公开', confirmPublished: '审核通过', reject: '驳回作品', remove: '违规下架',
	reason: '审核反馈 / 违规原因', reasonPlaceholder: '驳回或下架时必填，作者将看到这条说明', reasonRequired: '请填写驳回或下架原因。',
	removeConfirmTitle: '确认下架此作品', removeConfirmText: '作品将从社区和原作品页面移除，作者会收到违规下架通知。请确认已核对内容并填写原因。',
	reviewConfirm: '我已核对作品内容、附件及授权说明。', reviewConfirmRequired: '请先确认已核对作品。',
	submit: '提交审核', submitPublic: '发布作品', approvalVisibility: '审核通过后公开', publicVisibility: '立即公开，管理员随后审核',
	submitted: '已提交，等待审核。可在“我的投稿”查看进度。', submittedPublic: '作品已公开，管理员将随后审核。', submittedExisting: '该投稿已处理，可在“我的投稿”查看最新状态。',
	reviewed: '审核结果已保存。', removedNotice: '作品已下架，并已保存给作者的违规通知。', viewMine: '查看我的投稿',
};
const en: Record<keyof typeof zh, string> = {
	review: 'Work moderation', settingsTitle: 'Publishing and moderation', settingsHint: 'Choose how new submissions are published. Moderators can review public work and remove violations.',
	beforeMode: 'Review before publishing', beforeHint: 'New submissions stay private until a moderator approves them.',
	afterMode: 'Publish before reviewing', afterHint: 'New submissions are public immediately and enter the review queue. Violations can be removed.',
	modeScope: 'Changes apply to new submissions only. Existing pending work still needs an individual decision.',
	modeSave: 'Save moderation settings', modeSaved: 'Moderation settings saved.', modeLoadFailed: 'Could not load moderation settings. Please retry.', modeSaveFailed: 'Could not save settings. Retry and check the saved mode.',
	modeLoading: 'Loading moderation settings…', modeRetry: 'Reload settings', modeAdminOnly: 'Only administrators can change the publishing mode.',
	unreviewed: 'Needs review (including public)', pending: 'Pending · Not public', published: 'Public · Awaiting review', approved: 'Public · Approved', rejected: 'Rejected', removed: 'Violation · Removed', withdrawn: 'Work deleted',
	approve: 'Approve and publish', confirmPublished: 'Approve', reject: 'Reject', remove: 'Remove violation',
	reason: 'Review feedback / violation reason', reasonPlaceholder: 'Required for rejection or removal. The author will see this explanation.', reasonRequired: 'Enter a reason for rejection or removal.',
	removeConfirmTitle: 'Remove this work?', removeConfirmText: 'The work will be removed from the community and its original page. The author will receive a violation notice. Confirm you have checked the content and entered a reason.',
	reviewConfirm: 'I have checked the content, attachments and permissions.', reviewConfirmRequired: 'Confirm that you have checked the work.',
	submit: 'Submit for review', submitPublic: 'Publish work', approvalVisibility: 'Public after approval', publicVisibility: 'Public immediately, reviewed afterwards',
	submitted: 'Submitted for review. Track progress in My submissions.', submittedPublic: 'Your work is public and awaiting review.', submittedExisting: 'This submission has already been processed. Check My submissions for its current status.',
	reviewed: 'Review saved.', removedNotice: 'Work removed. A violation notice has been saved for the author.', viewMine: 'View my submissions',
};
export const moderationText = lang.startsWith('en') ? en : zh;
