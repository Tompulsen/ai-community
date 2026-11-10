/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { LotteryAward, LotteryProgress, LotterySettings } from '@/misc/community-lottery.js';
import { id } from './util/id.js';
import { MiUser } from './User.js';

@Entity('community_lottery_config')
export class MiCommunityLotteryConfig {
	@PrimaryColumn('varchar', { length: 16, primaryKeyConstraintName: 'PK_community_lottery_config' })
	public id: string;

	@Column('integer', { default: 0 })
	public version: number;

	@Column('jsonb')
	public settings: LotterySettings;
}

@Entity('community_lottery_account')
export class MiCommunityLotteryAccount {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_community_lottery_account' })
	public userId: string;

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_community_lottery_account_user' })
	public user: MiUser;

	@Column('integer', { default: 0 })
	public balance: number;

	@Column('jsonb')
	public progress: LotteryProgress;
}

@Entity('community_lottery_referral')
export class MiCommunityLotteryReferral {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_community_lottery_referral' })
	public userId: string;

	// A successful invitation remains cumulative even after the new account closes.

	@Index('IDX_community_lottery_referral_inviter')
	@Column(id())
	public inviterId: string;

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'inviterId', foreignKeyConstraintName: 'FK_community_lottery_referral_inviter' })
	public inviter: MiUser;

	@Column('timestamp with time zone')
	public createdAt: Date;
}

@Entity('community_lottery_draw')
@Index('IDX_community_lottery_draw_request', ['userId', 'requestId'], { unique: true })
@Index('IDX_community_lottery_draw_user_id', ['userId', 'id'])
export class MiCommunityLotteryDraw {
	@Column('varchar', { length: 255, nullable: true })
	public creditIssuer: string | null;

	@Column('varchar', { length: 128, nullable: true })
	public creditSubject: string | null;

	@Index('IDX_community_lottery_draw_credit')
	@Column('boolean', { default: false })
	public creditPending: boolean;

	@Column('integer', { default: 0 })
	public creditAttempts: number;

	@Column('timestamp with time zone', { nullable: true })
	public creditRetryAt: Date | null;

	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_community_lottery_draw' })
	public id: string;

	@Column({ ...id(), nullable: true })
	public userId: string | null;

	@ManyToOne(() => MiUser, { onDelete: 'SET NULL', nullable: true })
	@JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_community_lottery_draw_user' })
	public user: MiUser | null;

	@Column('varchar', { length: 64 })
	public requestId: string;

	@Column('jsonb')
	public prizes: LotteryAward[];

	@Column('timestamp with time zone')
	public createdAt: Date;
}
