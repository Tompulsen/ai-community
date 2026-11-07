/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

/** Durable deduplication shared by work reviews and accepted content reports. */
@Entity('community_violation')
export class MiCommunityViolation {
	@PrimaryColumn('varchar', { length: 128, primaryKeyConstraintName: 'PK_community_violation' })
	public contentKey: string;

	@Column(id())
	public userId: string;

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_community_violation_user' })
	public user: MiUser;

	@Column(id())
	public moderatorId: string;

	@Column('text')
	public reason: string;

	@Column('timestamp with time zone')
	public createdAt: Date;
}
