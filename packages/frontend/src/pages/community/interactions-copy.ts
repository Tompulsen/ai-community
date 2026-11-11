/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { homeLanguage } from '@/pages/home/copy.js';

const zh = {
	relatedWorks: '相关作品', relatedTags: '同标签作品', openRelated: '查看相关作品', closeRelated: '收起相关作品', relatedMore: '加载更多作品', relatedEmpty: '暂时没有同标签的其他作品。', relatedNoTags: '此作品暂无标签，暂时没有相关作品。', relatedFailed: '相关作品加载失败，请重试。',
	deleteComment: '删除评论', deletingComment: '正在删除…', deleteCommentConfirm: '确认删除这条评论？评论及其附件展示将被移除，引用的社区作品和原始文件会保留。', commentDeleted: '评论已删除', deleteCommentFailed: '未能确认删除结果，请刷新评论后重试。',
	follow: '关注作者', following: '已关注', followPending: '关注申请待通过', unfollow: '取消关注', cancelFollow: '取消关注申请', followConfirm: '确认关注这位作者？', unfollowConfirm: '确认取消关注这位作者？', cancelFollowConfirm: '确认取消关注申请？', followFailed: '关注状态未能确认，请刷新后重试。', viewAuthor: '查看作者主页',
	favorite: '收藏', favorited: '已收藏', favoriteFailed: '收藏状态未能确认，请刷新后重试。', refreshFavorite: '刷新收藏状态', shareWork: '转发与分享', nativeShare: '分享给朋友', copyLink: '复制链接', closeShare: '关闭分享', shareUnavailable: '分享未能完成，可复制链接后分享。', reply: '回复', likeComment: '点赞评论', likedComment: '已点赞评论', expandDetails: '展开', collapseDetails: '收起',
	playVideo: '播放视频', pauseVideo: '暂停视频', muteVideo: '关闭声音', unmuteVideo: '开启声音', mutedPreview: '静音预览',
	videoProgress: '视频播放进度', videoFullscreen: '全屏播放', videoDetail: '查看作品详情', videoLoading: '视频加载中…',
	videoFailed: '视频暂时无法播放', videoPlayBlocked: '播放未能开始，请点击播放重试。', videoFullscreenFailed: '无法进入全屏，可在作品详情中播放。',
	comment: '评论', repost: '转发', reposted: '已转发', like: '点赞', liked: '已点赞', views: '浏览', share: '复制作品链接',
	viewHint: '实际浏览次数，同一访客短时间内重复浏览会去重。',
	commentPlaceholder: '聊聊这个作品…', send: '发送评论', sending: '正在发送…', sent: '评论已发布',
	commentShortcut: 'Ctrl / ⌘ + Enter 发送，Enter 换行', commentTooLong: '评论超出字数限制，请缩短后发送。', closeComments: '收起评论',
	updatingLike: '正在更新点赞…', unliked: '已取消点赞', reposting: '正在转发作品…', repostSuccess: '已转发到你的个人动态。', loadingComments: '正在加载评论…',
	refreshingInteraction: '正在刷新互动状态…',
	comments: '作品评论', emptyComments: '还没有评论，来聊聊你的想法。', loadMore: '加载更多评论', refresh: '刷新评论',
	commentPreview: '评论预览', allComments: '查看全部评论', writeComment: '写下评论…', noPreviewComments: '暂无可预览的评论，可进入作品查看讨论。',
	loading: '正在加载作品…', failed: '作品加载失败，请重试。', unavailable: '作品已下架、不存在或暂时无法查看。', retry: '重试',
	commentFailed: '评论发送失败，输入已保留。', uncertain: '尚未确认是否发送成功。请先刷新查看，避免重复发送。', retrySend: '确认后重新发送',
	retryWarning: '请先确认评论列表中没有刚才的内容，再重新发送。', commentsFailed: '评论未能加载，请重试。',
	interactionFailed: '操作未能完成，请刷新后重试。', repostFailed: '转发失败，请重试。', repostUncertain: '暂未确认转发结果，请先到个人主页查看，避免重复转发。',
	replaceReaction: '该作品已有你的其他表情。要替换为点赞吗？', login: '登录后参与', loginHint: '登录后即可关注作者、点赞、收藏、转发和评论作品。',
	remix: '做同款', remixText: '进入文本制作', remixImage: '进入图片制作', remixVideo: '进入视频制作',
	prompt: '作品内容 / 提示词', copyPrompt: '复制提示词', copied: '已复制', copyFailed: '复制失败，可选择文字手动复制。',
	back: '返回社区', preview: '作品预览', previous: '上一张', next: '下一张', attachments: '作品附件',
	sensitive: '该附件被标记为敏感内容', reveal: '显示附件', noPreview: '暂无可预览的媒体', source: '来源', license: '授权',
	attachmentComment: '包含附件的评论', viewComment: '查看评论详情', shareFailed: '复制失败，请使用下面的作品链接。',
};
const en: typeof zh = {
	relatedWorks: 'Related works', relatedTags: 'Works with matching tags', openRelated: 'Show related works', closeRelated: 'Close related works', relatedMore: 'Load more works', relatedEmpty: 'No other works with matching tags yet.', relatedNoTags: 'This work has no tags to find related works.', relatedFailed: 'Could not load related works. Please retry.',
	deleteComment: 'Delete comment', deletingComment: 'Deleting…', deleteCommentConfirm: 'Delete this comment and its attachment preview? Quoted community works and original files will be kept.', commentDeleted: 'Comment deleted', deleteCommentFailed: 'Deletion could not be confirmed. Refresh the comments before retrying.',
	follow: 'Follow author', following: 'Following', followPending: 'Follow request pending', unfollow: 'Unfollow', cancelFollow: 'Cancel follow request', followConfirm: 'Follow this author?', unfollowConfirm: 'Unfollow this author?', cancelFollowConfirm: 'Cancel this follow request?', followFailed: 'Follow status is unconfirmed. Refresh before retrying.', viewAuthor: 'View author profile',
	favorite: 'Save', favorited: 'Saved', favoriteFailed: 'Saved status is unconfirmed. Refresh before retrying.', refreshFavorite: 'Refresh saved status', shareWork: 'Repost and share', nativeShare: 'Share with friends', copyLink: 'Copy link', closeShare: 'Close sharing', shareUnavailable: 'Could not share. Copy the link to share it instead.', reply: 'Reply', likeComment: 'Like comment', likedComment: 'Liked comment', expandDetails: 'More', collapseDetails: 'Less',
	playVideo: 'Play video', pauseVideo: 'Pause video', muteVideo: 'Mute', unmuteVideo: 'Turn sound on', mutedPreview: 'Muted preview',
	videoProgress: 'Video progress', videoFullscreen: 'Fullscreen', videoDetail: 'View work details', videoLoading: 'Loading video…',
	videoFailed: 'Video is unavailable', videoPlayBlocked: 'Playback did not start. Press play to try again.', videoFullscreenFailed: 'Fullscreen is unavailable. Open the work details to watch.',
	comment: 'Comment', repost: 'Repost', reposted: 'Reposted', like: 'Like', liked: 'Liked', views: 'Views', share: 'Copy work link',
	viewHint: 'Recorded views. Repeat visits by the same viewer within a short period count once.',
	commentPlaceholder: 'Share your thoughts…', send: 'Post comment', sending: 'Posting…', sent: 'Comment posted',
	commentShortcut: 'Ctrl / ⌘ + Enter to post; Enter for a new line', commentTooLong: 'Your comment is too long. Shorten it before posting.', closeComments: 'Collapse comments',
	updatingLike: 'Updating like…', unliked: 'Like removed', reposting: 'Reposting work…', repostSuccess: 'Reposted to your profile.', loadingComments: 'Loading comments…',
	refreshingInteraction: 'Refreshing interaction status…',
	comments: 'Comments', emptyComments: 'No comments yet. Share your thoughts.', loadMore: 'Load more comments', refresh: 'Refresh comments',
	commentPreview: 'Comment preview', allComments: 'View all comments', writeComment: 'Write a comment…', noPreviewComments: 'No comments to preview. Open the work to view the discussion.',
	loading: 'Loading work…', failed: 'Could not load this work. Please retry.', unavailable: 'This work was removed, does not exist, or is unavailable.', retry: 'Retry',
	commentFailed: 'Could not post your comment. Your draft is still here.', uncertain: 'Delivery is unconfirmed. Refresh the comments before trying again to avoid duplicates.', retrySend: 'Retry after checking',
	retryWarning: 'Make sure your comment is not already in the list before posting it again.', commentsFailed: 'Could not load comments. Please retry.',
	interactionFailed: 'Could not complete the action. Refresh and try again.', repostFailed: 'Could not repost. Please retry.', repostUncertain: 'Repost delivery is unconfirmed. Check your profile before trying again.',
	replaceReaction: 'You already reacted with another emoji. Replace it with a like?', login: 'Sign in to join in', loginHint: 'Sign in to follow, like, save, repost, and comment.',
	remix: 'Make your own', remixText: 'Open text studio', remixImage: 'Open image studio', remixVideo: 'Open video studio',
	prompt: 'Work details / Prompt', copyPrompt: 'Copy prompt', copied: 'Copied', copyFailed: 'Could not copy. Select the text to copy it manually.',
	back: 'Back to community', preview: 'Work preview', previous: 'Previous media', next: 'Next media', attachments: 'Attachments',
	sensitive: 'This attachment is marked as sensitive', reveal: 'Show attachment', noPreview: 'No media preview available', source: 'Source', license: 'License',
	attachmentComment: 'Comment with attachments', viewComment: 'View comment', shareFailed: 'Could not copy. Use the work link below.',
};
export const workText = homeLanguage === 'en-US' ? en : zh;
export const workPath = (id: string) => `/community/work/${id}`;
export const studioPath = (category: string) => `/create/${category === 'resource' ? 'text' : category}`;
