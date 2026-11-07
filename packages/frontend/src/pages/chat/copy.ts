/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { lang } from '@@/js/config.js';

export const chatText = lang.startsWith('zh') ? {
	title: '私信', intro: '与创作者交流想法，继续你们的对话。', start: '发起私信', createRoom: '创建群聊',
	history: '最近会话', emptyTitle: '开始第一段对话', emptyHint: '选择一位本站用户发送私信。对方的接收设置可能限制新会话。',
	historyFailed: '会话暂时加载失败，请重试。已有会话仍保留在下方。', retry: '重试',
	search: '搜索消息', searchPlaceholder: '输入消息关键词', searching: '正在搜索…', noResults: '没有找到相关消息', noResultsHint: '试试其他关键词。', searchFailed: '搜索失败，请检查网络后重试。', results: '搜索结果',
	sendFailed: '消息未发送成功，内容已保留。请检查网络和对方的接收权限后重试。',
	attachmentFailed: '附件添加失败，请重新选择。', attachment: '添加附件', removeAttachment: '移除附件', emoji: '插入表情',
	message: '消息内容', send: '发送', sending: '发送中', uploading: '正在添加附件…',
	enterHint: 'Enter 发送 · Shift + Enter 换行', ctrlHint: 'Ctrl / ⌘ + Enter 发送',
	tooLong: '消息不能超过 2000 个字符。', unavailable: '此会话暂不支持发送消息。',
	attachmentPreview: '[附件]', syncFailed: '消息同步失败，点击重试补回最新消息。', moreFailed: '较早消息加载失败，请重试。',
	back: '全部会话', roomFailed: '创建群聊失败，请稍后重试。',
} : {
	title: 'Messages', intro: 'Exchange ideas with creators and pick up your conversations.', start: 'New message', createRoom: 'Create group',
	history: 'Recent conversations', emptyTitle: 'Start a conversation', emptyHint: 'Choose someone on this server. Their message preferences may restrict new conversations.',
	historyFailed: 'Conversations could not be refreshed. Try again; existing conversations are kept below.', retry: 'Retry',
	search: 'Search messages', searchPlaceholder: 'Enter message keywords', searching: 'Searching…', noResults: 'No matching messages', noResultsHint: 'Try different keywords.', searchFailed: 'Search failed. Check your connection and try again.', results: 'Search results',
	sendFailed: 'Message could not be sent. Your draft is kept. Check your connection and the recipient’s preferences, then retry.',
	attachmentFailed: 'Could not add the attachment. Please choose it again.', attachment: 'Add attachment', removeAttachment: 'Remove attachment', emoji: 'Insert emoji',
	message: 'Message', send: 'Send', sending: 'Sending', uploading: 'Adding attachment…',
	enterHint: 'Enter to send · Shift + Enter for a new line', ctrlHint: 'Ctrl / ⌘ + Enter to send',
	tooLong: 'Messages cannot exceed 2,000 characters.', unavailable: 'Sending is currently unavailable in this conversation.',
	attachmentPreview: '[Attachment]', syncFailed: 'Messages could not be synced. Retry to load new messages.', moreFailed: 'Could not load earlier messages. Please retry.',
	back: 'All conversations', roomFailed: 'Could not create the group. Please try again.',
};
