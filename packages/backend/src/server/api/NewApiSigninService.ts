/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import * as Redis from 'ioredis';
import fetch from 'node-fetch';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { MiMeta } from '@/models/Meta.js';
import { MiUser, type MiLocalUser } from '@/models/User.js';
import { MiUserProfile } from '@/models/UserProfile.js';
import { MiExternalAccount } from '@/models/ExternalAccount.js';
import { SignupService } from '@/core/SignupService.js';
import { UserAuthService } from '@/core/UserAuthService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { getIpHash } from '@/misc/get-ip-hash.js';
import { RateLimiterService } from './RateLimiterService.js';
import { SigninService } from './SigninService.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const cookieName = '__Host-community-newapi';
const opaque = /^[A-Za-z0-9_-]{43}$/;
const random = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('base64url');
type Identity = { sub: string; preferred_username: string; name: string; };
type Pending = { browser: string; issuer: string; verifier: string; returnTo: string; };
type Completion = { userId: string; issuer: string; subject: string; tokenHash: string; returnTo: string; };
type StudioLaunch = Completion & { kind: 'text' | 'image' | 'video'; studio: string; };

export function newApiOrigin(value: string): string {
	const parsed = new URL(value);
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || parsed.origin.length > 255) throw new Error('SSO_CONFIG');
	return parsed.origin;
}

export function newApiReturnPath(value: unknown): string {
	return typeof value === 'string' && /^\/(community|create\/(text|image|video))$/.test(value) ? value : '/community';
}

export function newApiIdentity(value: unknown): Identity {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new Error('SSO_IDENTITY');
	const identity = value as Record<string, unknown>;
	if (typeof identity.sub !== 'string' || !/^[1-9]\d{0,18}$/.test(identity.sub)) throw new Error('SSO_IDENTITY');
	for (const field of ['preferred_username', 'name'] as const) {
		if (typeof identity[field] !== 'string' || identity[field].length > 128) throw new Error('SSO_IDENTITY');
	}
	return identity as Identity;
}

@Injectable()
export class NewApiSigninService {
	constructor(
		@Inject(DI.config) private config: Config,
		@Inject(DI.meta) private meta: MiMeta,
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.redis) private redis: Redis.Redis,
		private signupService: SignupService,
		private signinService: SigninService,
		private userAuthService: UserAuthService,
		private httpRequestService: HttpRequestService,
		private rateLimiterService: RateLimiterService,
	) {}

	private issuer(): string {
		if (!this.config.newApiSso?.issuer || this.meta.rootUserId == null) throw new Error('SSO_DISABLED');
		newApiOrigin(this.config.url);
		return newApiOrigin(this.config.newApiSso.issuer);
	}

	private studio(): { origin: string; secret: string; } {
		this.issuer();
		const settings = this.config.newApiSso!;
		if (!settings.studioOrigin || !settings.studioSecret || settings.studioSecret.length < 32) throw new Error('STUDIO_DISABLED');
		return { origin: newApiOrigin(settings.studioOrigin), secret: settings.studioSecret };
	}

	private browser(request: FastifyRequest): string | null {
		const cookies = (request.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${cookieName}=`));
		if (cookies.length !== 1) return null;
		const value = cookies[0].slice(cookieName.length + 1);
		return opaque.test(value) ? value : null;
	}

	private setCookie(reply: FastifyReply, value: string, maxAge: number): void {
		reply.header('Set-Cookie', `${cookieName}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`);
	}

	private async consume(key: string, expected: string): Promise<boolean> {
		return await this.redis.eval('if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end', 1, key, expected) === 1;
	}

	private async json(url: string, options: { body?: Record<string, string>; token?: string; }): Promise<unknown> {
		const response = await fetch(url, {
			method: options.body ? 'POST' : 'GET', redirect: 'error', size: 1024 * 1024,
			signal: AbortSignal.timeout(15000), agent: this.httpRequestService.getAgentByUrl(new URL(url)),
			headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
			body: options.body ? JSON.stringify(options.body) : undefined,
		});
		if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('SSO_UPSTREAM');
		return response.json();
	}

	public register(fastify: FastifyInstance): void {
		fastify.get('/newapi/config', async (_request, reply) => {
			reply.header('Cache-Control', 'no-store');
			try {
				const issuer = this.issuer();
				let studioOrigin: string | undefined;
				try { studioOrigin = this.studio().origin; } catch { /* Studio can be enabled after account sign-in. */ }
				return { enabled: true, issuer, studioOrigin };
			} catch { return { enabled: false }; }
		});
		fastify.post<{ Body: { i?: string; kind?: string; } }>('/newapi/studio/start', { bodyLimit: 4096 }, async (request, reply) => {
			reply.header('Cache-Control', 'no-store');
			if (request.headers.origin !== new URL(this.config.url).origin) return reply.code(403).send({ error: 'SSO_ORIGIN' });
			if (await this.rateLimiterService.limit({ key: 'studio-start', duration: 60000, max: 30 }, getIpHash(request.ip))) return reply.code(429).send({ error: 'SSO_RATE_LIMIT' });
			try {
				const { origin } = this.studio();
				const { i, kind } = request.body ?? {};
				if (typeof i !== 'string' || i.length !== 16 || !['text', 'image', 'video'].includes(kind ?? '')) throw new Error('STUDIO_REQUEST');
				const user = await this.db.getRepository(MiUser).findOneBy({ token: i, host: IsNull() });
				if (!user || user.isDeleted || user.isSuspended) throw new Error('STUDIO_ACCOUNT');
				const issuer = this.issuer();
				const mapping = await this.db.getRepository(MiExternalAccount).findOneBy({ issuer, userId: user.id });
				if (!mapping) return reply.code(409).send({ error: 'NEW_API_ACCOUNT_REQUIRED' });
				const code = random();
				const launch: StudioLaunch = { userId: user.id, issuer, subject: mapping.subject, tokenHash: hash(i), returnTo: `/create/${kind}`, kind: kind as StudioLaunch['kind'], studio: origin };
				await this.redis.set(`newapi:studio:${hash(code)}`, JSON.stringify(launch), 'EX', 120);
				const target = new URL('/api/new-api/community/start', origin);
				target.searchParams.set('code', code);
				return { url: target.href };
			} catch { return reply.code(403).send({ error: 'STUDIO_UNAVAILABLE' }); }
		});
		fastify.post<{ Body: { code?: string; } }>('/newapi/studio/exchange', { bodyLimit: 4096 }, async (request, reply) => {
			reply.header('Cache-Control', 'no-store');
			if (await this.rateLimiterService.limit({ key: 'studio-exchange', duration: 60000, max: 300 }, getIpHash(request.ip))) return reply.code(429).send({ error: 'SSO_RATE_LIMIT' });
			try {
				const { origin, secret } = this.studio();
				if (!timingSafeEqual(Buffer.from(hash(request.headers.authorization ?? '')), Buffer.from(hash(`Bearer ${secret}`)))) throw new Error('STUDIO_AUTH');
				const code = request.body?.code;
				if (typeof code !== 'string' || !opaque.test(code)) throw new Error('STUDIO_CODE');
				const key = `newapi:studio:${hash(code)}`;
				const raw = await this.redis.get(key);
				if (!raw) throw new Error('STUDIO_CODE');
				const launch = JSON.parse(raw) as StudioLaunch;
				if (launch.issuer !== this.issuer() || launch.studio !== origin) throw new Error('STUDIO_CONFIG');
				const user = await this.availableUser(launch.userId);
				if (hash(user.token!) !== launch.tokenHash || !await this.db.getRepository(MiExternalAccount).existsBy({ issuer: launch.issuer, subject: launch.subject, userId: user.id })) throw new Error('STUDIO_ACCOUNT');
				if (!await this.consume(key, raw)) throw new Error('STUDIO_CODE');
				return { issuer: launch.issuer, subject: launch.subject, kind: launch.kind, studio: origin };
			} catch { return reply.code(403).send({ error: 'STUDIO_EXCHANGE_FAILED' }); }
		});
		fastify.post<{ Body: { returnTo?: string; } }>('/newapi/start', { bodyLimit: 4096 }, async (request, reply) => {
			reply.header('Cache-Control', 'no-store');
			if (request.headers.origin !== new URL(this.config.url).origin) return reply.code(403).send({ error: 'SSO_ORIGIN' });
			if (await this.rateLimiterService.limit({ key: 'newapi-start', duration: 60000, max: 10 }, getIpHash(request.ip))) return reply.code(429).send({ error: 'SSO_RATE_LIMIT' });
			try {
				const issuer = this.issuer();
				const browser = random(); const state = random(); const verifier = random();
				const pending: Pending = { browser: hash(browser), issuer, verifier, returnTo: newApiReturnPath(request.body?.returnTo) };
				await this.redis.set(`newapi:state:${state}`, JSON.stringify(pending), 'EX', 600);
				this.setCookie(reply, browser, 600);
				const url = new URL('/community-authorize', issuer);
				url.search = new URLSearchParams({ client_id: new URL(this.config.url).origin, redirect_uri: new URL('/api/newapi/callback', this.config.url).href, response_type: 'code', scope: 'identity', state, code_challenge: hash(verifier), code_challenge_method: 'S256' }).toString();
				return { authorizationUrl: url.href };
			} catch { return reply.code(503).send({ error: 'SSO_UNAVAILABLE' }); }
		});
		fastify.get<{ Querystring: { state?: string; code?: string; } }>('/newapi/callback', async (request, reply) => {
			reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
			try {
				const { state, code } = request.query;
				const browser = this.browser(request);
				if (!state || !code || !opaque.test(state) || !opaque.test(code) || !browser) throw new Error('SSO_FLOW');
				const key = `newapi:state:${state}`;
				const raw = await this.redis.get(key);
				if (!raw) throw new Error('SSO_FLOW');
				const pending = JSON.parse(raw) as Pending;
				if (pending.browser !== hash(browser) || pending.issuer !== this.issuer() || !await this.consume(key, raw)) throw new Error('SSO_FLOW');
				const token = await this.json(`${pending.issuer}/api/community-sso/token`, { body: { grant_type: 'authorization_code', client_id: new URL(this.config.url).origin, redirect_uri: new URL('/api/newapi/callback', this.config.url).href, code, code_verifier: pending.verifier } }) as Record<string, unknown>;
				if (!token || token.token_type !== 'Bearer' || typeof token.access_token !== 'string' || !opaque.test(token.access_token)) throw new Error('SSO_TOKEN');
				const identity = newApiIdentity(await this.json(`${pending.issuer}/api/community-sso/userinfo`, { token: token.access_token }));
				if (pending.issuer !== this.issuer()) throw new Error('SSO_CONFIG');
				const user = await this.provision(pending.issuer, identity);
				const completion: Completion = { userId: user.id, issuer: pending.issuer, subject: identity.sub, tokenHash: hash(user.token!), returnTo: pending.returnTo };
				await this.redis.set(`newapi:complete:${hash(browser)}`, JSON.stringify(completion), 'EX', 300);
				return reply.redirect('/auth/newapi');
			} catch {
				this.setCookie(reply, '', 0);
				return reply.redirect('/auth/newapi?error=signin');
			}
		});
		fastify.post<{ Body: { token?: string; } }>('/newapi/finish', { bodyLimit: 4096 }, async (request, reply) => {
			reply.header('Cache-Control', 'no-store');
			if (request.headers.origin !== new URL(this.config.url).origin) return reply.code(403).send({ error: 'SSO_ORIGIN' });
			if (await this.rateLimiterService.limit({ key: 'newapi-finish', duration: 600000, max: 15 }, getIpHash(request.ip))) return reply.code(429).send({ error: 'SSO_RATE_LIMIT' });
			try {
				const browser = this.browser(request);
				if (!browser) throw new Error('SSO_FLOW');
				const key = `newapi:complete:${hash(browser)}`;
				const raw = await this.redis.get(key);
				if (!raw) throw new Error('SSO_FLOW');
				const complete = JSON.parse(raw) as Completion;
				if (complete.issuer !== this.issuer()) throw new Error('SSO_CONFIG');
				const user = await this.availableUser(complete.userId);
				if (hash(user.token!) !== complete.tokenHash) throw new Error('SSO_FLOW');
				const mapping = await this.db.getRepository(MiExternalAccount).findOneBy({ issuer: complete.issuer, subject: complete.subject, userId: user.id });
				if (!mapping) throw new Error('SSO_FLOW');
				const profile = await this.db.getRepository(MiUserProfile).findOneByOrFail({ userId: user.id });
				if (profile.twoFactorEnabled) {
					if (!request.body?.token) return { requiresTotp: true };
					if (typeof request.body.token !== 'string' || request.body.token.length > 128) throw new Error('SSO_FACTOR');
					try { await this.userAuthService.twoFactorAuthenticate(profile, request.body.token); } catch { return reply.code(403).send({ error: 'SSO_FACTOR' }); }
				}
				if (!await this.consume(key, raw)) throw new Error('SSO_FLOW');
				this.setCookie(reply, '', 0);
				return { ...this.signinService.signin(request, reply, user), returnTo: newApiReturnPath(complete.returnTo) };
			} catch { return reply.code(403).send({ error: 'SSO_SIGNIN_FAILED' }); }
		});
	}

	private async availableUser(userId: string): Promise<MiLocalUser> {
		const user = await this.db.getRepository(MiUser).findOneBy({ id: userId, host: IsNull() });
		if (!user || user.isDeleted || user.isSuspended || !user.token) throw new Error('SSO_ACCOUNT_UNAVAILABLE');
		return user as MiLocalUser;
	}

	public async provision(issuer: string, identity: Identity): Promise<MiLocalUser> {
		if (this.meta.rootUserId == null) throw new Error('SSO_NOT_INITIALIZED');
		const mapping = await this.db.getRepository(MiExternalAccount).findOneBy({ issuer, subject: identity.sub });
		if (mapping) {
			if (!mapping.userId) throw new Error('SSO_ACCOUNT_UNAVAILABLE');
			return this.availableUser(mapping.userId);
		}
		const fallback = `na_${createHash('sha256').update(`${issuer}:${identity.sub}`).digest('hex').slice(0, 16)}`;
		const candidates = [...new Set([identity.preferred_username, fallback, `na_${randomBytes(8).toString('hex')}`])];
		for (const username of candidates) {
			if (!/^[a-zA-Z0-9_]{1,20}$/.test(username)) continue;
			try {
				const { account } = await this.signupService.signup({ username, password: random(), externalIdentity: { issuer, subject: identity.sub, name: identity.name || identity.preferred_username } });
				return this.availableUser(account.id);
			} catch (error) {
				if (!(error instanceof Error) || !['DUPLICATED_USERNAME', 'USED_USERNAME'].includes(error.message)) throw error;
			}
		}
		throw new Error('SSO_PROVISION');
	}
}
