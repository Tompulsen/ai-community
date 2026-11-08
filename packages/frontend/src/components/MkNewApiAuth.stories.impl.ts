/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { StoryObj } from '@storybook/vue3';
import { HttpResponse, http } from 'msw';
import MkNewApiAuth from './MkNewApiAuth.vue';

export const Signin = {
	render: args => ({ components: { MkNewApiAuth }, setup: () => ({ args }), template: '<div style="max-width: 400px; padding: 24px;"><MkNewApiAuth v-bind="args" /></div>' }),
	args: { signup: false },
	parameters: { msw: { handlers: [http.get('/api/newapi/config', () => HttpResponse.json({ enabled: true, issuer: 'https://accounts.example' })), http.post('/api/newapi/start', () => new HttpResponse(null, { status: 503 }))] } },
} satisfies StoryObj<typeof MkNewApiAuth>;

export const Signup = { ...Signin, args: { signup: true } } satisfies StoryObj<typeof MkNewApiAuth>;
export const Unavailable = { ...Signin, parameters: { msw: { handlers: [http.get('/api/newapi/config', () => new HttpResponse(null, { status: 503 }))] } } } satisfies StoryObj<typeof MkNewApiAuth>;
