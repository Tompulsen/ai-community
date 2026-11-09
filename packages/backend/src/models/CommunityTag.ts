/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';

@Entity('community_tag')
@Index('IDX_community_tag_active_category_name', ['category', 'name'], { unique: true, where: '"isDeleted" = false' })
export class MiCommunityTag {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_community_tag' })
	public id: string;

	@Column('varchar', { length: 16 })
	public category: 'video' | 'image' | 'resource';

	@Column('varchar', { length: 24 })
	public name: string;

	@Column('boolean', { default: false })
	public isDeleted: boolean;
}
