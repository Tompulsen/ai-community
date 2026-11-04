/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type CommunityCategory = 'video' | 'image' | 'resource';
export type CommunitySection = CommunityCategory | 'mine' | 'review' | 'ai' | 'profile';
export type SubmissionStatus = 'pending' | 'approved' | 'rejected';
export type CommunityFile = { id: string; name: string; type: string; url: string; thumbnailUrl?: string | null; isSensitive?: boolean; };
export type CommunityWork = {
	id: string;
	version: number;
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
};
export type CommunitySubmissionInput = {
	idempotencyKey: string;
	category: CommunityCategory;
	title: string;
	text: string;
	model: string;
	sourceUrl: string;
	license: string;
	fileIds: string[];
};
export type CommunityReviewInput = { submissionId: string; version: number; decision: 'approve' | 'reject'; reason?: string; };
export type CommunityPage = { items: CommunityWork[]; nextCursor: string | null; };

export interface CommunityGateway {
	list: (section: CommunitySection, options: { query: string; status: SubmissionStatus | 'all'; cursor?: string; authorId?: string; category?: CommunityCategory; }, signal: AbortSignal) => Promise<CommunityPage>;
	submit: (input: CommunitySubmissionInput) => Promise<{ id: string; status: 'pending'; submittedAt: string; }>;
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
