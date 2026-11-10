/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { ApiCallService } from '@/server/api/ApiCallService.js';
import { meta as lotteryStatusMeta } from '@/server/api/endpoints/community/lottery/status.js';
import { meta as lotteryDrawMeta } from '@/server/api/endpoints/community/lottery/draw.js';
import { meta as lotteryRecordsMeta } from '@/server/api/endpoints/community/lottery/records.js';
import { meta as lotteryConfigMeta } from '@/server/api/endpoints/admin/community/lottery/config.js';
import { meta as lotteryUpdateMeta } from '@/server/api/endpoints/admin/community/lottery/update.js';
import { meta as lotteryAdminRecordsMeta } from '@/server/api/endpoints/admin/community/lottery/records.js';
import { meta as lotteryFulfillMeta } from '@/server/api/endpoints/admin/community/lottery/fulfill.js';
import Logger from '@/logger.js';
import { envOption } from '@/env.js';
import { logManager } from '@/logging/logging-runtime.js';
import { PrettyConsoleBackend } from '@/logging/PrettyConsoleBackend.js';
import type { LogBackend } from '@/logging/LogBackend.js';
import type { LogRecord } from '@/logging/types.js';

/** API失敗ログを確認するための最小Fastify応答を作成します。 */
function createReply() {
	return {
		code: vi.fn(),
		header: vi.fn(),
		send: vi.fn(),
	};
}

/** APIサービスの依存関係を最小限の仮実装へ差し替えます。 */
function createService() {
	const authenticateService = {
		authenticate: vi.fn().mockResolvedValue([null, null]),
	};
	const telemetryService = {
		startSpan: vi.fn((_name: string, callback: () => unknown) => callback()),
		captureMessage: vi.fn(),
	};
	const apiLoggerService = { logger: new Logger('api') };

	const service = new ApiCallService(
		{} as never,
		{} as never,
		{} as never,
		authenticateService as never,
		{ limit: vi.fn().mockResolvedValue(null) } as never,
		{ getUserPolicies: vi.fn().mockResolvedValue({ rateLimitFactor: 1 }), getUserRoles: vi.fn().mockResolvedValue([]) } as never,
		apiLoggerService as never,
		telemetryService as never,
	);
	return { service, telemetryService, authenticateService };
}

describe('Community lottery API access', () => {
	const request = { method: 'POST', body: {}, query: {}, headers: {}, ip: '203.0.113.1' };
	const user = { id: 'lottery-user', isSuspended: false };

	test.each([
		{ name: 'guest', actor: null, token: null, allowed: true },
		{ name: 'native login', actor: user, token: null, allowed: true },
		{ name: 'app without account permission', actor: user, token: { permission: [] }, allowed: false },
		{ name: 'app with account permission', actor: user, token: { permission: ['read:account'] }, allowed: true },
	])('status for $name', async ({ actor, token, allowed }) => {
		const { service, authenticateService } = createService();
		authenticateService.authenticate.mockResolvedValue([actor, token]);
		const reply = createReply();
		const result = { settings: { enabled: false, prizes: [] } };
		const endpoint = { name: 'community/lottery/status', meta: lotteryStatusMeta, params: {}, exec: vi.fn().mockResolvedValue(result) };
		try {
			await service.handleRequest(endpoint as never, request as never, reply as never);
			if (allowed) {
				expect(endpoint.exec).toHaveBeenCalledOnce();
				expect(reply.send).toHaveBeenCalledWith(result);
			} else {
				expect(endpoint.exec).not.toHaveBeenCalled();
				expect(reply.code).toHaveBeenCalledWith(403);
				expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'PERMISSION_DENIED' }) }));
			}
		} finally { service.dispose(); }
	});

	test.each([
		{ name: 'community/lottery/draw', meta: lotteryDrawMeta },
		{ name: 'community/lottery/records', meta: lotteryRecordsMeta },
		{ name: 'admin/community/lottery/config', meta: lotteryConfigMeta },
		{ name: 'admin/community/lottery/update', meta: lotteryUpdateMeta },
		{ name: 'admin/community/lottery/records', meta: lotteryAdminRecordsMeta },
		{ name: 'admin/community/lottery/fulfill', meta: lotteryFulfillMeta },
	])('rejects guests before executing $name', async ({ name, meta }) => {
		const { service } = createService();
		const reply = createReply();
		const endpoint = { name, meta, params: {}, exec: vi.fn().mockResolvedValue({}) };
		try {
			await service.handleRequest(endpoint as never, request as never, reply as never);
			expect(endpoint.exec).not.toHaveBeenCalled();
			expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'ACCESS_DENIED' }) }));
		} finally { service.dispose(); }
	});
});

describe('ApiCallService structured error logging', () => {
	test('redacts API credentials and serializes the endpoint error', async () => {
		const write = vi.fn<LogBackend['write']>();
		logManager.setBackend({ write });
		const previousQuiet = envOption.quiet;
		envOption.quiet = false;
		const { service, telemetryService } = createService();
		try {
			const reply = createReply();
			const endpoint = {
				name: 'notes/show',
				meta: {},
				params: {},
				exec: vi.fn().mockRejectedValue(new TypeError('broken endpoint')),
			};
			const request = {
				method: 'POST',
				body: {
					i: 'native-token',
					password: 'password',
					options: { visible: true },
				},
				query: {},
				headers: {},
				ip: '127.0.0.1',
			};

			await service.handleRequest(endpoint as never, request as never, reply as never);

			const record = write.mock.calls[0][0] as LogRecord;
			expect(record).toMatchObject({
				eventName: 'api.endpoint.failed',
				attributes: {
					'api.endpoint': 'notes/show',
					'api.params': {
						i: '[REDACTED]',
						password: '[REDACTED]',
						options: { visible: true },
					},
				},
				error: { type: 'TypeError', message: 'broken endpoint' },
			});
			expect(record.attributes?.['error.id']).toEqual(expect.any(String));
			expect(telemetryService.captureMessage.mock.calls[0][1].extra).not.toHaveProperty('ps');
		} finally {
			service.dispose();
			envOption.quiet = previousQuiet;
			logManager.setBackend(new PrettyConsoleBackend({ output: () => undefined }));
		}
	});
});
