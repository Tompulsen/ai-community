/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type CommunityDestination = 'community' | 'source-comment';
export type CommunityCategory = 'video' | 'image' | 'resource';
export type CommunitySection = CommunityCategory | 'all' | 'mine' | 'review' | 'ai' | 'profile';
export type SubmissionStatus = 'pending' | 'published' | 'approved' | 'rejected' | 'removed' | 'withdrawn';
export type CommunityFile = { id: string; name: string; type: string; url: string; thumbnailUrl?: string | null; isSensitive?: boolean; properties?: { width?: number; height?: number }; };
export type CommunityGeneration = { prompt: string; model: string; referenceFileIds: string[]; sourceWorkId?: string; shareToSource?: boolean };
export type SourceCommentStatus = 'none' | 'pending' | 'shared' | 'unavailable';
export type CommunityWork = {
	destination?: CommunityDestination;
	sourceCommentStatus?: SourceCommentStatus;
	generation?: CommunityGeneration | null;
	referenceFiles?: CommunityFile[];
	id: string;
	version: number;
	revisionPending?: boolean;
	category: CommunityCategory;
	title: string;
	text: string;
	model: string;
	sourceUrl: string;
	license: string;
	files: CommunityFile[];
	author: { id: string; name: string; username: string; };
	status: SubmissionStatus;
	submittedAt: string;
	rejectionReason: string | null;
	approvedNoteId: string | null;
	repliesCount: number;
	likesCount?: number;
	renotesCount?: number;
	viewsCount?: number;
};
export type CommunitySubmissionInput = {
	destination?: CommunityDestination;
	resultId?: string;
	idempotencyKey: string;
	generation?: CommunityGeneration | null;
	category: CommunityCategory;
	title: string;
	text: string;
	model: string;
	sourceUrl: string;
	license: string;
	fileIds: string[];
};
export type CommunityComposerDraft = Pick<CommunitySubmissionInput, 'category' | 'title' | 'text' | 'model' | 'destination' | 'resultId'> & { files: CommunityFile[]; generation?: CommunityGeneration | null; referenceFiles?: CommunityFile[]; };
export type CommunityReviewInput = { submissionId: string; version: number; decision: 'approve' | 'reject' | 'remove'; reason?: string; recordViolation?: boolean; };
export type CommunityUpdateInput = Omit<CommunitySubmissionInput, 'idempotencyKey'> & { submissionId: string; version: number; };
export type CommunityPage = { items: CommunityWork[]; nextCursor: string | null; };

export interface CommunityGateway {
	list: (section: CommunitySection, options: { query: string; status: SubmissionStatus | 'all' | 'unreviewed'; cursor?: string; authorId?: string; category?: CommunityCategory; }, signal: AbortSignal) => Promise<CommunityPage>;
	submit: (input: CommunitySubmissionInput) => Promise<{ id: string; status: SubmissionStatus; submittedAt: string; sourceCommentStatus?: SourceCommentStatus; }>;
	show: (submissionId: string, signal?: AbortSignal) => Promise<CommunityWork>;
	update: (input: CommunityUpdateInput) => Promise<CommunityWork>;
	delete: (input: { submissionId: string; version: number; }) => Promise<void>;
	review: (input: CommunityReviewInput) => Promise<CommunityWork>;
	chooseFiles: (event: MouseEvent) => Promise<CommunityFile[]>;
	uploadFiles?: (files: File[]) => Promise<CommunityFile[]>;
}

/** Public profile fields only; hidden social counts remain absent. */
export type CommunityProfile = {
	id: string; name: string; handle: string; description: string;
	avatarUrl?: string | null; bannerUrl?: string | null; createdAt: string;
	followingCount?: number; followersCount?: number;
	followingPath?: string; followersPath?: string; detailsPath?: string;
	isOwn: boolean;
};
