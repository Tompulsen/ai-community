/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { homeLanguage } from '@/pages/home/copy.js';

// Project-owned copy follows the existing community modules, separate from Crowdin.
const chinese = {
	categories: { image: '图片', video: '视频', resource: '文本 · 代码 · Skill' },
	tags: '作品标签', chooseTags: '选择标签', pickerTitle: '选择作品标签', filterTitle: '按标签筛选', allCategories: '全部分区',
	categoryLabel: '标签分区', search: '搜索标签', searchPlaceholder: '输入标签名称', clearSearch: '清除搜索',
	selected: '已选标签', selectedCount: (count: number, limit: number) => `已选 ${count} / ${limit}`,
	limitHint: (limit: number) => `最多选择 ${limit} 个标签。`, limitReached: (limit: number) => `已选满 ${limit} 个，可先取消一个再选择。`,
	remove: (name: string) => `移除标签：${name}`, clear: '清空选择', done: '完成', close: '关闭标签选择',
	loading: '正在加载标签…', refreshing: '正在刷新…', refresh: '刷新标签', retry: '重试',
	loadFailed: '标签加载失败，请重试。已有选择会保留。', invalidated: '部分标签已删除或不属于当前分区，已从选择中移除。',
	empty: '这个分区还没有标签', emptyHint: '管理员添加标签后会显示在这里。', emptyAll: '暂无可选标签', noMatches: '没有匹配的标签', noMatchesHint: '换一个关键词，或清除搜索查看全部标签。',
	adminTitle: '作品标签管理', adminHint: '按分区维护投稿时可选的标签，每件作品最多选择 3 个。', adminOnly: '只有管理员可以管理作品标签。',
	name: '标签名称', namePlaceholder: '输入新标签名称', nameHint: '1–24 个字符，同一分区内不能重名。', add: '新增标签', adding: '正在新增…',
	edit: '改名', editName: (name: string) => `修改标签：${name}`, save: '保存', saving: '正在保存…', cancel: '取消',
	delete: '删除', deleteName: (name: string) => `删除标签：${name}`, deleting: '正在删除…',
	deleteTitle: (name: string) => `删除“${name}”？`, deleteHint: '该标签会从已有作品中移除，作品和附件不会删除。删除后无法恢复。',
	created: '标签已新增。', updated: '标签名称已更新。', deleted: '标签已删除，作品和附件已保留。',
	invalidName: '请输入 1–24 个字符，不含换行或控制字符的标签名。', duplicate: '当前分区已有同名标签，请换一个名称。',
	notFound: '这个标签已被删除，请刷新列表。', saveFailed: '操作未完成，请刷新列表确认后重试。',
};

const english: typeof chinese = {
	categories: { image: 'Images', video: 'Video', resource: 'Text · Code · Skills' },
	tags: 'Work tags', chooseTags: 'Choose tags', pickerTitle: 'Choose work tags', filterTitle: 'Filter by tags', allCategories: 'All categories',
	categoryLabel: 'Tag category', search: 'Search tags', searchPlaceholder: 'Enter a tag name', clearSearch: 'Clear search',
	selected: 'Selected tags', selectedCount: (count, limit) => `${count} / ${limit} selected`,
	limitHint: limit => `Choose up to ${limit} tags.`, limitReached: limit => `${limit} tags selected. Remove one to choose another.`,
	remove: name => `Remove tag: ${name}`, clear: 'Clear selection', done: 'Done', close: 'Close tag picker',
	loading: 'Loading tags…', refreshing: 'Refreshing…', refresh: 'Refresh tags', retry: 'Retry',
	loadFailed: 'Tags could not be loaded. Retry to continue; your selections are kept.', invalidated: 'Tags that were deleted or belong to another category have been removed from your selection.',
	empty: 'No tags in this category yet', emptyHint: 'Tags appear here after an administrator adds them.', emptyAll: 'No tags available', noMatches: 'No matching tags', noMatchesHint: 'Try another keyword, or clear the search to see all tags.',
	adminTitle: 'Work tags', adminHint: 'Manage the tags available for each category. Each work can have up to 3 tags.', adminOnly: 'Only administrators can manage work tags.',
	name: 'Tag name', namePlaceholder: 'Enter a new tag name', nameHint: '1–24 characters. Names must be unique within their category.', add: 'Add tag', adding: 'Adding…',
	edit: 'Rename', editName: name => `Rename tag: ${name}`, save: 'Save', saving: 'Saving…', cancel: 'Cancel',
	delete: 'Delete', deleteName: name => `Delete tag: ${name}`, deleting: 'Deleting…',
	deleteTitle: name => `Delete “${name}”?`, deleteHint: 'This tag will be removed from existing works. The works and their attachments will remain. This cannot be undone.',
	created: 'Tag added.', updated: 'Tag renamed.', deleted: 'Tag deleted. Works and attachments were kept.',
	invalidName: 'Enter 1–24 characters without line breaks or control characters.', duplicate: 'This category already has a tag with that name. Choose another name.',
	notFound: 'This tag has been deleted. Refresh the list.', saveFailed: 'The operation did not finish. Refresh the list to check before trying again.',
};

export const tagText = homeLanguage === 'en-US' ? english : chinese;
