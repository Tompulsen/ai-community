/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiNote } from './Note.js';

export type CommunityRevision = Pick<MiCommunitySubmission, 'category' | 'title' | 'text' | 'model' | 'sourceUrl' | 'license' | 'fileIds'> & { generation?: CommunityGeneration | null };

export type CommunityGeneration = { prompt: string; model: string; referenceFileIds: string[]; sourceWorkId?: string };

@Entity('community_submission')
@Index('IDX_community_submission_author_key', ['authorId', 'idempotencyKey'], { unique: true })
@Index('IDX_community_submission_status_category_id', ['status', 'category', 'id'])
@Index('IDX_community_submission_author_id', ['authorId', 'id'])
export class MiCommunitySubmission {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_community_submission' })
	public id: string;

	@Column(id())
	public authorId: string;

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'authorId', foreignKeyConstraintName: 'FK_community_submission_author' })
	public author: MiUser;

	@Column('varchar', { length: 64 })
	public idempotencyKey: string;

	@Column('varchar', { length: 64 })
	public payloadHash: string;

	@Column('varchar', { length: 16 })
	public category: 'video' | 'image' | 'resource';

	@Column('varchar', { length: 100 })
	public title: string;

	@Column('text')
	public text: string;

	@Column('varchar', { length: 100 })
	public model: string;

	@Column('varchar', { length: 2000 })
	public sourceUrl: string;

	@Column('varchar', { length: 200 })
	public license: string;

	@Column({ ...id(), array: true, default: '{}' })
	public fileIds: string[];

	@Column('jsonb', { nullable: true })
	public generation: CommunityGeneration | null;

	@Column('varchar', { length: 16, default: 'pending' })
	public status: 'pending' | 'published' | 'approved' | 'rejected' | 'removed';

	@Column('varchar', { length: 16, default: 'before' })
	public publicationMode: 'before' | 'after';

	@Column('integer', { default: 0 })
	public viewsCount: number;

	@Column('integer', { default: 0 })
	public version: number;

	/** A private edit awaiting moderation; the published columns remain unchanged. */
	@Column('jsonb', { nullable: true })
	public pendingRevision: CommunityRevision | null;

	@Column('timestamp with time zone')
	public submittedAt: Date;

	@Column('timestamp with time zone', { nullable: true })
	public reviewedAt: Date | null;

	@Column({ ...id(), nullable: true })
	public reviewedById: string | null;

	@Column('varchar', { length: 1000, nullable: true })
	public rejectionReason: string | null;

	@Index('IDX_community_submission_note', { unique: true })
	@Column({ ...id(), nullable: true })
	public approvedNoteId: string | null;

	@ManyToOne(() => MiNote, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'approvedNoteId', foreignKeyConstraintName: 'FK_community_submission_note' })
	public approvedNote: MiNote | null;
}
