/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { SignupApiService } from '@/server/api/SignupApiService.js';

describe('New API public registration policy', () => {
	function service(enabled: boolean) {
		const validateLocalUsername = vi.fn(() => false);
		const subject = Object.assign(Object.create(SignupApiService.prototype), {
			config: enabled ? { newApiSso: { issuer: 'https://accounts.example' } } : {},
			meta: { rootUserId: 'root' },
			userEntityService: { validateLocalUsername },
		}) as SignupApiService;
		return { subject, validateLocalUsername };
	}

	test('rejects native signup before account creation when New API is configured', async () => {
		const { subject, validateLocalUsername } = service(true);
		await expect(subject.signup({ body: { username: 'newuser', password: 'password' } } as never, {} as never)).rejects.toMatchObject({ statusCode: 403, message: 'NEWAPI_REGISTRATION_REQUIRED' });
		expect(validateLocalUsername).not.toHaveBeenCalled();
	});

	test('keeps native validation for installations without New API', async () => {
		const { subject, validateLocalUsername } = service(false);
		await expect(subject.signup({ body: { username: 'invalid', password: 'password' } } as never, {} as never)).rejects.toMatchObject({ statusCode: 400, message: 'INVALID_CREDENTIALS' });
		expect(validateLocalUsername).toHaveBeenCalledWith('invalid');
	});

	test('rejects pending email signup after New API is enabled', async () => {
		const { subject } = service(true);
		await expect(subject.signupPending({ body: { code: 'previously-issued-code' } } as never, {} as never)).rejects.toMatchObject({ statusCode: 403, message: 'NEWAPI_REGISTRATION_REQUIRED' });
	});
});
