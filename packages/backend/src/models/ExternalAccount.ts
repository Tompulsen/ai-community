/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

@Entity('external_account')
@Index('IDX_external_account_user', ['issuer', 'userId'], { unique: true })
export class MiExternalAccount {
	@PrimaryColumn('varchar', { length: 255, primaryKeyConstraintName: 'PK_external_account' })
	public issuer: string;

	@PrimaryColumn('varchar', { length: 128, primaryKeyConstraintName: 'PK_external_account' })
	public subject: string;

	@Column({ ...id(), nullable: true })
	public userId: MiUser['id'] | null;

	@ManyToOne(() => MiUser, { onDelete: 'SET NULL', nullable: true })
	@JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_external_account_user' })
	public user: MiUser | null;

	@Column('timestamp with time zone')
	public createdAt: Date;

	constructor(data: Partial<MiExternalAccount>) {
		Object.assign(this, data);
	}
}
