/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { homeLanguage } from '@/pages/home/copy.js';

export const studioShareText = homeLanguage === 'en-US' ? {
	directTitle: 'Send to original comments', directHint: 'Confirm this generated result and its original work. The result will appear in the original’s comments.', directSend: 'Send comment', directSent: 'Sent to the original work’s comments.', directLabel: 'Original work comment', sourceUnavailable: 'The original work is unavailable or cannot receive this comment.',
	shareToSource: 'Also share in the original work’s comments', viewSource: 'View original', sourcePublicHint: 'After publication, add a preview and link to your work in the original’s comments.', sourceReviewHint: 'After approval, add a preview and link to your work in the original’s comments.',
	sourceStatus: { pending: 'The comment will be shared after approval.', shared: 'Also shared in the original work’s comments.', unavailable: 'The work was saved, but the original is unavailable for comment sharing.' },
	caption: 'Publication caption', provenanceHint: 'Editing the caption does not change the original generation prompt used for remixing.', references: 'Generation reference images', referenceHint: 'These images were used to generate this work. Selected images will be public and available for remixing.', remixHint: 'Choose reference images, then fill the original prompt and model into the studio.', title: 'Publish to community', preparing: 'Preparing your work…', uploading: 'Saving attachments to the community…', cancel: 'Cancel', retry: 'Retry upload',
	failed: 'The upload did not finish. Successfully saved attachments are kept for this retry.',
	invalid: 'This work could not be shared. Check its format and upload limits, then retry.',
	discardTitle: 'Cancel this publication?', discardText: 'Your original creation stays in the studio. Uploaded attachments remain in your files; edits in this window will be discarded.',
	imported: 'Your work is ready. Check the title, category and sharing rights before publishing.',
	longText: 'The complete content is included in the attached Markdown file.',
	pending: 'Submitted for review. You can check its status in My works.', published: 'Published to the community.', viewMine: 'My works', close: 'Close',
	statusUpdated: 'The work status has changed. Check My works for details.',
} : {
	directTitle: '发送到源作品评论区', directHint: '请确认本次生成结果和对应源作品，发送后将在源作品评论区展示。', directSend: '发送评论', directSent: '已发送到源作品评论区。', directLabel: '源作品评论', sourceUnavailable: '源作品已不可用，或当前无法向它发送评论。',
	shareToSource: '同时分享到原作品评论区', viewSource: '查看原作品', sourcePublicHint: '发布成功后，将作品预览和入口同步到原作品评论区。', sourceReviewHint: '审核通过后，将作品预览和入口同步到原作品评论区。',
	sourceStatus: { pending: '审核通过后将同步到原作品评论区。', shared: '已同步到原作品评论区。', unavailable: '作品已保存，但原作品当前无法接收同步评论。' },
	caption: '发布文案', provenanceHint: '编辑发布文案不会改变原始生成提示词；制作同款将使用保存的原始提示词。', references: '生成参考图', referenceHint: '已带入本次生成使用的参考图。勾选的图片将随作品公开，供他人制作同款。', remixHint: '选择参考图后，将原提示词和模型填入制作区。', title: '发布到社区', preparing: '正在读取作品…', uploading: '正在保存社区附件…', cancel: '取消', retry: '重试上传',
	failed: '上传未完成。已成功保存的附件会在本次重试中继续使用。',
	invalid: '暂时无法分享此作品，请检查文件格式和上传限制后重试。',
	discardTitle: '取消本次发布？', discardText: '原作品会保留在制作区，已上传的附件会保留在你的文件中；本窗口的编辑内容将被丢弃。',
	imported: '作品已带入，请确认标题、分区与分享权限后发布。',
	longText: '完整内容已保存在随附的 Markdown 文件中。',
	pending: '已提交审核，可在“我的作品”查看进度。', published: '已发布到社区。', viewMine: '我的作品', close: '关闭',
	statusUpdated: '作品状态已更新，请到“我的作品”查看详情。',
};
