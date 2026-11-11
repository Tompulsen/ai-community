/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import fetch from 'node-fetch';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import { MiUser } from '@/models/User.js';
import { MiModerationLog } from '@/models/ModerationLog.js';
import { MiExternalAccount } from '@/models/ExternalAccount.js';
import { newApiOrigin } from '@/server/api/NewApiSigninService.js';
import { MiCommunityLotteryAccount, MiCommunityLotteryConfig, MiCommunityLotteryDraw, MiCommunityLotteryReferral } from '@/models/CommunityLottery.js';
import { availableLotteryPrizes, chooseLotteryPrize, defaultLotterySettings, emptyLotteryProgress, lotteryCredits, normalizeLotterySettings } from '@/misc/community-lottery.js';
import type { LotteryAward, LotterySettings, LotterySettingsInput } from '@/misc/community-lottery.js';
import { lotteryErrors } from '@/server/api/lottery-schema.js';
import { ApiError } from '@/server/api/error.js';
import { IdService } from './IdService.js';
import { RoleService } from './RoleService.js';
import { HttpRequestService } from './HttpRequestService.js';
import { LoggerService } from './LoggerService.js';

class LotteryCreditError extends Error {
	constructor(message: string, public permanent = false) { super(message); }
}

@Injectable()
export class CommunityLotteryService implements OnApplicationBootstrap, OnApplicationShutdown {
	private retryTimer: ReturnType<typeof setInterval> | undefined;
	private processing = false;
	private logger: ReturnType<LoggerService['getLogger']>;
	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.config) private config: Config,
		private idService: IdService,
		private roleService: RoleService,
		private httpRequestService: HttpRequestService,
		loggerService: LoggerService,
	) { this.logger = loggerService.getLogger('community-lottery'); }

	private creditConfig() {
		const settings = this.config.newApiSso;
		if (!settings?.lotterySecret || settings.lotterySecret.length < 32) return null;
		try { return { issuer: newApiOrigin(settings.issuer), secret: settings.lotterySecret }; } catch { return null; }
	}

	private async creditRequest(issuer: string, body?: Record<string, unknown>, signal = AbortSignal.timeout(8000)) {
		const settings = this.creditConfig();
		if (!settings || settings.issuer !== issuer) throw new LotteryCreditError('LOTTERY_CREDIT_CONFIG', true);
		const url = new URL('/api/community-sso/lottery', issuer);
		const response = await fetch(url, {
			method: body ? 'POST' : 'GET', redirect: 'error', size: 65536, signal, agent: this.httpRequestService.getAgentByUrl(url),
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.secret}` }, body: body ? JSON.stringify(body) : undefined,
		});
		if (!response.ok) throw new LotteryCreditError(`LOTTERY_CREDIT_HTTP_${response.status}`, response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status));
		return await response.json() as Record<string, unknown>;
	}

	public onApplicationBootstrap() {
		if (process.env.NODE_ENV === 'test') return;
		this.retryTimer = setInterval(() => { void this.processPending(); }, 60000);
		this.retryTimer.unref();
	}

	public onApplicationShutdown() { if (this.retryTimer) clearInterval(this.retryTimer); }

	private async processPending() {
		if (this.processing || !this.creditConfig()) return;
		this.processing = true;
		try {
			const rows = await this.db.getRepository(MiCommunityLotteryDraw).createQueryBuilder('draw').where('draw."creditPending" = true AND draw."creditAttempts" < 3').andWhere('(draw."creditRetryAt" IS NULL OR draw."creditRetryAt" <= NOW())').orderBy('draw.id', 'ASC').take(5).getMany();
			for (const row of rows) await this.deliver(row.id);
		} catch { this.logger.warn('Could not scan pending lottery credits.'); } finally { this.processing = false; }
	}

	private async deliver(drawId: string) {
		return this.db.transaction(async manager => {
			const row = await manager.getRepository(MiCommunityLotteryDraw).createQueryBuilder('draw').setLock('pessimistic_write').where({ id: drawId }).getOneOrFail();
			if (!row.creditPending || row.creditAttempts >= 3 || (row.creditRetryAt && row.creditRetryAt.getTime() > Date.now())) return this.pack(row);
			row.creditAttempts++;
			const signal = AbortSignal.timeout(8000);
			for (const [index, prize] of row.prizes.entries()) {
				if (prize.status !== 'pending') continue;
				const reference = `community_lottery_${row.id}_${index}`;
				try {
					const response = await this.creditRequest(row.creditIssuer!, { client_id: new URL(this.config.url).origin, user_id: Number(row.creditSubject), reference, amount_cents: prize.amountCents }, signal);
					if (response.credited !== true || response.reference !== reference || response.user_id !== Number(row.creditSubject) || response.amount_cents !== prize.amountCents) throw new LotteryCreditError('LOTTERY_CREDIT_RESPONSE', true);
					prize.status = 'fulfilled'; prize.fulfilledAt = new Date().toISOString(); prize.note = `${(prize.amountCents / 100).toFixed(2)} USD`;
				} catch (error) {
					if (error instanceof LotteryCreditError && error.permanent) row.creditAttempts = 3;
					this.logger.warn(`Credit pending for draw ${row.id}: ${error instanceof LotteryCreditError ? error.message : 'transport error'}.`);
					break;
				}
			}
			row.creditPending = row.prizes.some(p => p.status === 'pending');
			row.creditRetryAt = row.creditPending ? new Date(Date.now() + row.creditAttempts * 60000) : null;
			await manager.save(row);
			return this.pack(row);
		});
	}

	private async actor(userId: string) {
		const user = await this.db.getRepository(MiUser).findOneBy({ id: userId, host: IsNull() });
		if (!user || user.isDeleted || user.isSuspended || user.movedToUri) throw new ApiError(lotteryErrors.forbidden);
	}

	private async admin(userId: string) {
		await this.actor(userId);
		if (!await this.roleService.isAdministrator({ id: userId })) throw new ApiError(lotteryErrors.forbidden);
	}

	private async configuration(manager: EntityManager, lock = false) {
		await manager.createQueryBuilder().insert().into(MiCommunityLotteryConfig).values({ id: 'default', version: 0, settings: defaultLotterySettings() }).orIgnore().execute();
		const query = manager.getRepository(MiCommunityLotteryConfig).createQueryBuilder('config').where({ id: 'default' });
		if (lock) query.setLock('pessimistic_write');
		const config = await query.getOneOrFail();
		config.settings = normalizeLotterySettings(config.settings);
		return config;
	}

	private async statistics(manager: EntityManager, userId: string) {
		// Query canonical relationships, never delayed reaction/follower display counters.
		const referrals = await manager.getRepository(MiCommunityLotteryReferral).countBy({ inviterId: userId });
		const followers: { count: string }[] = await manager.query('SELECT COUNT(*)::text AS count FROM following f JOIN "user" u ON u.id = f."followerId" WHERE f."followeeId" = $1 AND f."followerId" <> $1 AND u.host IS NULL AND NOT u."isSuspended" AND NOT u."isDeleted"', [userId]);
		const works: { id: string; likes: string }[] = await manager.query(`SELECT s.id, COUNT(r.id)::text AS likes FROM community_submission s JOIN note n ON n.id = s."approvedNoteId"
			LEFT JOIN note_reaction r ON r."noteId" = n.id AND r."userId" <> $1 AND r.reaction IN ('❤', '❤️')
			AND EXISTS (SELECT 1 FROM "user" u WHERE u.id = r."userId" AND u.host IS NULL AND NOT u."isSuspended" AND NOT u."isDeleted")
			WHERE s."authorId" = $1 AND s.status IN ('approved', 'published') AND s.destination = 'community' AND n.visibility = 'public'
			GROUP BY s.id`, [userId]);
		return { invites: referrals, followers: Number(followers[0].count), works: works.map(w => ({ id: w.id, likes: Number(w.likes) })) };
	}

	private async sync(manager: EntityManager, userId: string, settings: LotterySettings) {
		await manager.createQueryBuilder().insert().into(MiCommunityLotteryAccount).values({ userId, balance: 0, progress: emptyLotteryProgress() }).orIgnore().execute();
		const account = await manager.getRepository(MiCommunityLotteryAccount).createQueryBuilder('account').setLock('pessimistic_write').where({ userId }).getOneOrFail();
		const counts = await this.statistics(manager, userId);
		const credit = lotteryCredits(account.progress, counts, settings);
		// Defer unclaimed rewards at the storage limit so users can spend or admins can reduce it.
		if (account.balance + credit.added <= 2147483647) {
			account.balance += credit.added;
			account.progress = credit.progress;
			await manager.save(account);
		}
		return { account, counts };
	}

	public async status(userId?: string) {
		if (userId) await this.actor(userId);
		const credit = this.creditConfig();
		const linked = userId && credit ? await this.db.getRepository(MiExternalAccount).existsBy({ issuer: credit.issuer, userId }) : false;
		return this.db.transaction(async manager => {
			const { settings } = await this.configuration(manager, !!userId);
			const result = userId ? await this.sync(manager, userId, settings) : null;
			const progress = result?.account.progress ?? emptyLotteryProgress();
			return {
				creditReady: !!credit, accountLinked: linked,
				settings: { ...settings, prizes: settings.prizes.filter(p => p.enabled) }, balance: result?.account.balance ?? 0,
				earned: { invites: progress.invites, likes: progress.likes, followers: progress.followers },
				counts: { invites: result?.counts.invites ?? 0, followers: result?.counts.followers ?? 0, likes: result?.counts.works.reduce((n, w) => n + w.likes, 0) ?? 0, bestWorkLikes: result?.counts.works.reduce((n, w) => Math.max(n, w.likes), 0) ?? 0 },
				inviteUrl: userId ? `${this.config.url}/community/lottery?invite=${encodeURIComponent(userId)}` : '',
			};
		});
	}

	private pack(row: MiCommunityLotteryDraw, username = '') {
		return { id: row.id, userId: row.userId ?? '', username, createdAt: row.createdAt.toISOString(), creditAttempts: row.creditAttempts, prizes: row.prizes.map(({ fulfilledBy: _actor, ...prize }) => prize) };
	}

	public async draw(userId: string, requestId: string, count: number) {
		await this.actor(userId);
		if (![1, 3, 5].includes(count) || !/^[a-zA-Z0-9_-]{16,64}$/.test(requestId)) throw new ApiError(lotteryErrors.invalid);
		const receipt = await this.db.transaction(async manager => {
			// One short transaction locks the pool, chances, stock and receipt in the same order.
			const config = await this.configuration(manager, true);
			const existing = await manager.findOneBy(MiCommunityLotteryDraw, { userId, requestId });
			if (existing) {
				if (existing.prizes.length !== count) throw new ApiError(lotteryErrors.conflict);
				return this.pack(existing);
			}
			if (!config.settings.enabled || !availableLotteryPrizes(config.settings.prizes).length) throw new ApiError(lotteryErrors.unavailable);
			const credit = this.creditConfig();
			const mapping = credit ? await manager.findOneBy(MiExternalAccount, { issuer: credit.issuer, userId }) : null;
			if (!credit || !mapping || !/^[1-9]\d{0,14}$/.test(mapping.subject) || !Number.isSafeInteger(Number(mapping.subject))) throw new ApiError(lotteryErrors.accountRequired);
			const { account } = await this.sync(manager, userId, config.settings);
			if (account.balance < count) throw new ApiError(lotteryErrors.insufficient);
			const prizes: LotteryAward[] = [];
			for (let index = 0; index < count; index++) {
				const prize = chooseLotteryPrize(config.settings.prizes);
				if (!prize) throw new ApiError(lotteryErrors.unavailable);
				if (prize.stock > 0) prize.stock--;
				prizes.push({ amountCents: prize.amountCents, prizeId: prize.id, name: prize.name, description: prize.description, status: prize.kind === 'empty' ? 'empty' : 'pending', fulfilledAt: null, fulfilledBy: null, note: '' });
			}
			account.balance -= count;
			config.version++;
			await manager.save(account);
			await manager.save(config);
			const row = manager.create(MiCommunityLotteryDraw, { id: this.idService.gen(), userId, requestId, prizes, createdAt: new Date(), creditIssuer: credit.issuer, creditSubject: mapping.subject, creditPending: prizes.some(p => p.status === 'pending'), creditAttempts: 0, creditRetryAt: null });
			await manager.save(row);
			return this.pack(row);
		});
		try { return await this.deliver(receipt.id); } catch { return receipt; }
	}

	public async getConfig(userId: string) {
		await this.admin(userId);
		const { settings, version } = await this.configuration(this.db.manager);
		return { settings, version };
	}

	public async getAccount(adminId: string, userId: string) {
		await this.admin(adminId);
		await this.actor(userId);
		return this.db.transaction(async manager => {
			const { settings } = await this.configuration(manager, true);
			const { account } = await this.sync(manager, userId, settings);
			return { userId, balance: account.balance };
		});
	}

	public async adjustChances(adminId: string, input: { userId: string; mode: 'add' | 'set'; amount: number; expectedBalance: number; requestId: string; reason: string }) {
		await this.admin(adminId);
		await this.actor(input.userId);
		const { userId, mode, amount, expectedBalance, requestId } = input;
		if (!['add', 'set'].includes(mode) || !Number.isInteger(amount) || amount < (mode === 'add' ? 1 : 0) || amount > 2147483647 || !Number.isInteger(expectedBalance) || expectedBalance < 0 || expectedBalance > 2147483647 || !/^[a-zA-Z0-9_-]{16,64}$/.test(requestId) || typeof input.reason !== 'string' || input.reason.length > 300) throw new ApiError(lotteryErrors.invalid);
		const reason = input.reason.trim();
		return this.db.transaction(async manager => {
			// Match the draw lock order; the audit receipt makes retries safe even after a draw.
			const { settings } = await this.configuration(manager, true);
			const receipt = await manager.getRepository(MiModerationLog).createQueryBuilder('log')
				.where('log."userId" = :adminId AND log.type = :type', { adminId, type: 'adjustLotteryChances' })
				.andWhere("log.info ->> 'requestId' = :requestId", { requestId }).getOne();
			if (receipt && (receipt.info.userId !== userId || receipt.info.mode !== mode || receipt.info.amount !== amount || receipt.info.before !== expectedBalance || receipt.info.reason !== reason)) throw new ApiError(lotteryErrors.conflict);
			const { account } = await this.sync(manager, userId, settings);
			if (receipt) return { userId, balance: account.balance };
			if (account.balance !== expectedBalance) throw new ApiError(lotteryErrors.conflict);
			const balance = mode === 'add' ? account.balance + amount : amount;
			if (balance > 2147483647) throw new ApiError(lotteryErrors.invalid);
			account.balance = balance;
			await manager.save(account);
			await manager.insert(MiModerationLog, {
				id: this.idService.gen(), userId: adminId, type: 'adjustLotteryChances',
				info: { userId, mode, amount, before: expectedBalance, after: balance, requestId, reason },
			});
			return { userId, balance };
		});
	}

	public async updateConfig(userId: string, version: number, settings: LotterySettingsInput) {
		await this.admin(userId);
		const normalized = structuredClone(settings);
		for (const prize of normalized.prizes) { prize.name = prize.name.trim(); prize.description = prize.description.trim(); }
		if (new Set(normalized.prizes.map(p => p.id)).size !== normalized.prizes.length || normalized.prizes.some(p => !p.name || (p.kind === 'balance' ? p.amountCents < 1 : p.amountCents !== 0)) || (settings.enabled && !availableLotteryPrizes(settings.prizes).length)) throw new ApiError(lotteryErrors.invalid);
		if (settings.enabled) {
			const credit = this.creditConfig();
			try { if (!credit) throw new Error(); const health = await this.creditRequest(credit.issuer); if (health.ready !== true || health.client_id !== new URL(this.config.url).origin) throw new Error(); } catch { throw new ApiError(lotteryErrors.unavailable); }
		}
		return this.db.transaction(async manager => {
			const config = await this.configuration(manager, true);
			if (config.version !== version) throw new ApiError(lotteryErrors.conflict);
			// Older admin clients omit wheel; preserve the current design inside the version lock.
			config.settings = normalizeLotterySettings({ ...normalized, wheel: normalized.wheel ?? config.settings.wheel });
			for (const key of ['title', 'subtitle', 'buttonText', 'rulesText'] as const) config.settings.wheel[key] = config.settings.wheel[key].trim();
			config.settings.wheel.buttonText ||= 'GO';
			config.version++;
			await manager.save(config);
			return { version: config.version, settings: config.settings };
		});
	}

	public async records(userId: string, admin: boolean, untilId?: string) {
		if (admin) await this.admin(userId); else await this.actor(userId);
		const query = this.db.getRepository(MiCommunityLotteryDraw).createQueryBuilder('draw').leftJoinAndSelect('draw.user', 'user');
		if (!admin) query.where('draw."userId" = :userId', { userId });
		if (untilId) query.andWhere('draw.id < :untilId', { untilId });
		const rows = await query.orderBy('draw.id', 'DESC').take(21).getMany();
		return { items: rows.slice(0, 20).map(row => this.pack(row, admin ? row.user?.username ?? '' : '')), nextCursor: rows.length > 20 ? rows[19].id : null };
	}

	public async fulfill(userId: string, drawId: string) {
		await this.admin(userId);
		await this.db.transaction(async manager => {
			const row = await manager.getRepository(MiCommunityLotteryDraw).createQueryBuilder('draw').setLock('pessimistic_write').where({ id: drawId }).getOne();
			if (!row) throw new ApiError(lotteryErrors.notFound);
			if (row.creditPending) { row.creditAttempts = 0; row.creditRetryAt = null; await manager.save(row); }
			return this.pack(row);
		});
		return this.deliver(drawId);
	}
}
