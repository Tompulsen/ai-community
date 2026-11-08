/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { homeLanguage } from '@/pages/home/copy.js';

export const studioShareText = homeLanguage === 'en-US' ? {
	caption: 'Publication caption', provenanceHint: 'Editing the caption does not change the original generation prompt used for remixing.', references: 'Generation reference images', referenceHint: 'These images were used to generate this work. Selected images will be public and available for remixing.', remixHint: 'Choose reference images, then fill the original prompt and model into the studio.', title: 'Publish to community', preparing: 'Preparing your work…', uploading: 'Saving attachments to the community…', cancel: 'Cancel', retry: 'Retry upload',
	failed: 'The upload did not finish. Successfully saved attachments are kept for this retry.',
	invalid: 'This work could not be shared. Check its format and upload limits, then retry.',
	discardTitle: 'Cancel this publication?', discardText: 'Your original creation stays in the studio. Uploaded attachments remain in your files; edits in this window will be discarded.',
	imported: 'Your work is ready. Check the title, category and sharing rights before publishing.',
	longText: 'The complete content is included in the attached Markdown file.',
	pending: 'Submitted for review. You can check its status in My works.', published: 'Published to the community.', viewMine: 'My works', close: 'Close',
	statusUpdated: 'The work status has changed. Check My works for details.',
} : {
	caption: '发布文案', provenanceHint: '编辑发布文案不会改变原始生成提示词；制作同款将使用保存的原始提示词。', references: '生成参考图', referenceHint: '已带入本次生成使用的参考图。勾选的图片将随作品公开，供他人制作同款。', remixHint: '选择参考图后，将原提示词和模型填入制作区。', title: '发布到社区', preparing: '正在读取作品…', uploading: '正在保存社区附件…', cancel: '取消', retry: '重试上传',
	failed: '上传未完成。已成功保存的附件会在本次重试中继续使用。',
	invalid: '暂时无法分享此作品，请检查文件格式和上传限制后重试。',
	discardTitle: '取消本次发布？', discardText: '原作品会保留在制作区，已上传的附件会保留在你的文件中；本窗口的编辑内容将被丢弃。',
	imported: '作品已带入，请确认标题、分区与分享权限后发布。',
	longText: '完整内容已保存在随附的 Markdown 文件中。',
	pending: '已提交审核，可在“我的作品”查看进度。', published: '已发布到社区。', viewMine: '我的作品', close: '关闭',
	statusUpdated: '作品状态已更新，请到“我的作品”查看详情。',
};
