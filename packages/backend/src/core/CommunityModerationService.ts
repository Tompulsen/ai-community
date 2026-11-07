/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/Meta.js';
import { MiUser } from '@/models/User.js';
import { MiCommunityViolation } from '@/models/CommunityViolation.js';
import { RoleService } from './RoleService.js';
import { UserSuspendService } from './UserSuspendService.js';

@Injectable()
export class CommunityModerationService {
	constructor(
		@Inject(DI.meta) private meta: MiMeta,
		private roleService: RoleService,
		private userSuspendService: UserSuspendService,
	) {}

	/** Caller owns the transaction; only committed decisions may affect sessions. */
	public async record(manager: EntityManager, afterCommit: (() => void)[], input: { userId: string; contentKey: string; reason: string; moderator: MiUser }) {
		const users = manager.getRepository(MiUser);
		const user = await users.createQueryBuilder('user').setLock('pessimistic_write').where('user.id = :id', { id: input.userId }).getOne();
		if (!user || user.host !== null || user.isDeleted) return;
		const result = await manager.getRepository(MiCommunityViolation).createQueryBuilder().insert().values({
			contentKey: input.contentKey, userId: user.id, moderatorId: input.moderator.id, reason: input.reason, createdAt: new Date(),
		}).orIgnore().returning(['contentKey']).execute();
		if (result.raw.length === 0) return;
		user.communityViolationCount++;
		await users.update(user.id, { communityViolationCount: user.communityViolationCount });
		const configured = this.meta.clientOptions.communityViolationThreshold;
		const threshold = Number.isInteger(configured) && configured! >= 1 && configured! <= 1000 ? configured! : 3;
		if (this.meta.clientOptions.communityAutoBanEnabled !== false && !user.isSuspended &&
			user.communityViolationCount - user.communityViolationBaseline >= threshold &&
			!await this.roleService.isModerator(user)) {
			await this.userSuspendService.suspendInTransaction(user, input.moderator, manager, afterCommit);
		}
	}
}
