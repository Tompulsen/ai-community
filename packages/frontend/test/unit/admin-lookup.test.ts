/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { lookupUser } from '@/utility/admin-lookup.js';

const fixture = vi.hoisted(() => ({ api: vi.fn(), inputText: vi.fn(), pageWindow: vi.fn(), selectUser: vi.fn(), alert: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: fixture.api }));
vi.mock('@/os.js', () => fixture);
vi.mock('@/i18n.js', () => ({ i18n: { ts: { usernameOrUserId: 'Username or ID', name: 'Name', failedToFetchAccountInformation: 'Lookup failed' } } }));

afterEach(() => vi.resetAllMocks());

describe('Admin user lookup', () => {
	test('offers a prefilled chooser when display name is not an account or ID', async () => {
		fixture.inputText.mockResolvedValue({ result: ' root ' });
		fixture.api.mockRejectedValue({ code: 'NO_SUCH_USER' });
		fixture.selectUser.mockResolvedValue({ id: 'chosen-root' });
		await lookupUser();
		expect(fixture.selectUser).toHaveBeenCalledWith({ includeSelf: true, initialQuery: 'root' });
		expect(fixture.pageWindow).toHaveBeenCalledExactlyOnceWith('/admin/user/chosen-root');
		expect(fixture.alert).not.toHaveBeenCalled();
	});

	test('opens an exact match once even when both requests resolve', async () => {
		fixture.inputText.mockResolvedValue({ result: 'na_handle' });
		fixture.api.mockResolvedValue({ id: 'exact' });
		await lookupUser();
		expect(fixture.pageWindow).toHaveBeenCalledExactlyOnceWith('/admin/user/exact');
		expect(fixture.selectUser).not.toHaveBeenCalled();
	});

	test('does not turn a failed request into a no-user result', async () => {
		fixture.inputText.mockResolvedValue({ result: 'root' });
		fixture.api.mockRejectedValue(new Error('offline'));
		await lookupUser();
		expect(fixture.alert).toHaveBeenCalledExactlyOnceWith({ type: 'error', text: 'Lookup failed' });
		expect(fixture.selectUser).not.toHaveBeenCalled();
	});

	test('does not query blank input', async () => {
		fixture.inputText.mockResolvedValue({ result: '  ' });
		await lookupUser();
		expect(fixture.api).not.toHaveBeenCalled();
	});
});
