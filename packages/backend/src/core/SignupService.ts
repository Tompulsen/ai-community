/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { generateKeyPair } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { DataSource, IsNull } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { MiMeta, UsedUsernamesRepository, UsersRepository } from '@/models/_.js';
import { MiUser } from '@/models/User.js';
import { MiUserProfile } from '@/models/UserProfile.js';
import { MiExternalAccount } from '@/models/ExternalAccount.js';
import { MiCommunityLotteryReferral } from '@/models/CommunityLottery.js';
import { lotteryInviter } from '@/misc/community-lottery.js';
import { IdService } from '@/core/IdService.js';
import { MiUserKeypair } from '@/models/UserKeypair.js';
import { MiUsedUsername } from '@/models/UsedUsername.js';
import { generateNativeUserToken } from '@/misc/token.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { bindThis } from '@/decorators.js';
import UsersChart from '@/core/chart/charts/users.js';
import { UtilityService } from '@/core/UtilityService.js';
import { UserService } from '@/core/UserService.js';
import { SystemAccountService } from '@/core/SystemAccountService.js';
import { MetaService } from '@/core/MetaService.js';

@Injectable()
export class SignupService {
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.usedUsernamesRepository)
		private usedUsernamesRepository: UsedUsernamesRepository,

		private utilityService: UtilityService,
		private userService: UserService,
		private userEntityService: UserEntityService,
		private idService: IdService,
		private systemAccountService: SystemAccountService,
		private metaService: MetaService,
		private usersChart: UsersChart,
	) {
	}

	@bindThis
	public async signup(opts: {
		username: MiUser['username'];
		password?: string | null;
		passwordHash?: MiUserProfile['password'] | null;
		host?: string | null;
		ignorePreservedUsernames?: boolean;
		email?: string;
		emailVerified?: boolean;
		lotteryInviterId?: string;
		externalIdentity?: { issuer: string; subject: string; name: string; };
	}) {
		const { username, password, passwordHash, host } = opts;
		let hash = passwordHash;
		const email = opts.email?.trim().toLowerCase();
		// External identities never bootstrap the community administrator.
		if (opts.externalIdentity && this.meta.rootUserId == null) throw new Error('SSO_NOT_INITIALIZED');
		if (email != null && (email.length > 128 || !this.utilityService.validateEmailFormat(email))) throw new Error('INVALID_EMAIL');

		// Validate username
		if (!this.userEntityService.validateLocalUsername(username)) {
			throw new Error('INVALID_USERNAME');
		}

		if (password != null && passwordHash == null) {
			// Validate password
			if (!this.userEntityService.validatePassword(password)) {
				throw new Error('INVALID_PASSWORD');
			}

			// Generate hash of password
			const salt = await bcrypt.genSalt(8);
			hash = await bcrypt.hash(password, salt);
		}

		// Generate secret
		const secret = generateNativeUserToken();

		// Check username duplication
		if (!opts.externalIdentity && await this.usersRepository.exists({ where: { usernameLower: username.toLowerCase(), host: IsNull() } })) {
			throw new Error('DUPLICATED_USERNAME');
		}

		// Check deleted username duplication
		if (!opts.externalIdentity && await this.usedUsernamesRepository.exists({ where: { username: username.toLowerCase() } })) {
			throw new Error('USED_USERNAME');
		}

		if (!opts.ignorePreservedUsernames && this.meta.rootUserId != null) {
			const isPreserved = this.meta.preservedUsernames.map(x => x.toLowerCase()).includes(username.toLowerCase());
			if (isPreserved) {
				throw new Error('USED_USERNAME');
			}

			const hasProhibitedWords = this.utilityService.isKeyWordIncluded(username.toLowerCase(), this.meta.prohibitedWordsForNameOfUser);
			if (hasProhibitedWords) {
				throw new Error('USED_USERNAME');
			}
		}

		const keyPair = await new Promise<string[]>((res, rej) =>
			generateKeyPair('rsa', {
				modulusLength: 2048,
				publicKeyEncoding: {
					type: 'spki',
					format: 'pem',
				},
				privateKeyEncoding: {
					type: 'pkcs8',
					format: 'pem',
					cipher: undefined,
					passphrase: undefined,
				},
			}, (err, publicKey, privateKey) =>
				err ? rej(err) : res([publicKey, privateKey]),
			));

		let account!: MiUser;
		let created = false;

		// Start transaction
		await this.db.transaction(async transactionalEntityManager => {
			if (opts.externalIdentity) {
				const { issuer, subject } = opts.externalIdentity;
				await transactionalEntityManager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`external-account:${issuer}:${subject}`]);
				const existing = await transactionalEntityManager.findOneBy(MiExternalAccount, { issuer, subject });
				if (existing) {
					if (!existing.userId) throw new Error('SSO_ACCOUNT_UNAVAILABLE');
					account = await transactionalEntityManager.findOneByOrFail(MiUser, { id: existing.userId, host: IsNull() });
					if (account.isDeleted || account.isSuspended) throw new Error('SSO_ACCOUNT_UNAVAILABLE');
					return;
				}
			}
			// ローカルユーザーのユーザー名は host が NULL のため、(usernameLower, host) の
			// 複合ユニークインデックスでは重複を防げない（NULLは互いにdistinct扱い）。
			// 同一ユーザー名の並行サインアップをトランザクション単位のadvisory lockで直列化し、
			// チェック→挿入のTOCTOU競合を排除する。
			await transactionalEntityManager.query(
				'SELECT pg_advisory_xact_lock(hashtext($1))',
				[`signup:username:${username.toLowerCase()}`],
			);

			const exist = await transactionalEntityManager.findOneBy(MiUser, {
				usernameLower: username.toLowerCase(),
				host: IsNull(),
			});

			if (exist) throw new Error('DUPLICATED_USERNAME');
			if (opts.externalIdentity && await transactionalEntityManager.existsBy(MiUsedUsername, { username: username.toLowerCase() })) throw new Error('USED_USERNAME');

			account = await transactionalEntityManager.save(new MiUser({
				id: this.idService.gen(),
				username: username,
				usernameLower: username.toLowerCase(),
				host: this.utilityService.toPunyNullable(host),
				token: secret,
				...(opts.externalIdentity ? { name: opts.externalIdentity.name.slice(0, 50) } : {}),
			}));

			await transactionalEntityManager.save(new MiUserKeypair({
				publicKey: keyPair[0],
				privateKey: keyPair[1],
				userId: account.id,
			}));

			await transactionalEntityManager.save(new MiUserProfile({
				userId: account.id,
				autoAcceptFollowed: true,
				password: hash,
				email: email ?? null,
				emailVerified: email != null && opts.emailVerified === true,
			}));

			await transactionalEntityManager.save(new MiUsedUsername({
				createdAt: new Date(),
				username: username.toLowerCase(),
			}));
			if (opts.externalIdentity) {
				await transactionalEntityManager.insert(MiExternalAccount, {
					issuer: opts.externalIdentity.issuer, subject: opts.externalIdentity.subject,
					userId: account.id, createdAt: new Date(),
				});
			}
			const inviterId = lotteryInviter(opts.lotteryInviterId);
			if (inviterId && inviterId !== account.id && account.host === null) {
				const inviter = await transactionalEntityManager.findOneBy(MiUser, { id: inviterId, host: IsNull(), isSuspended: false, isDeleted: false });
				if (inviter && !inviter.movedToUri) await transactionalEntityManager.insert(MiCommunityLotteryReferral, { userId: account.id, inviterId, createdAt: new Date() });
			}
			created = true;
		});

		if (created) {
			this.usersChart.update(account, true);
			this.userService.notifySystemWebhook(account, 'userCreated');
		}

		if (!opts.externalIdentity && this.meta.rootUserId == null) {
			await this.metaService.update({ rootUserId: account.id });
		}

		return { account, secret: account.token! };
	}
}
