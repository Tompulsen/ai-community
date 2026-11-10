/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import proxy from '@fastify/http-proxy';
import type { FastifyInstance } from 'fastify';

/** Serve the repository's studio, preserving the public origin and streaming bodies. */
export function registerCommunityStudio(fastify: FastifyInstance, upstream: string, publicUrl: string): void {
	const origin = new URL(publicUrl);
	const destination = new URL(upstream);
	if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password || destination.pathname !== '/' || destination.search || destination.hash) throw new Error('Invalid studio upstream');
	for (const [prefix, rewritePrefix] of [
		['/studio', '/studio'],
		// New API deliberately has one fixed OAuth callback path per client origin.
		['/api/new-api/community/callback', '/studio/api/new-api/community/callback'],
	]) {
		fastify.register(proxy, {
			upstream: destination.origin, prefix, rewritePrefix,
			routes: prefix === '/studio' ? ['/', '/*'] : ['/'],
			internalRewriteLocationHeader: false,
			undici: { headersTimeout: 600_000, bodyTimeout: 600_000 },
			replyOptions: {
				rewriteRequestHeaders: (_request, headers) => ({ ...headers, host: origin.host, 'x-forwarded-host': origin.host, 'x-forwarded-proto': origin.protocol.slice(0, -1) }),
			},
		});
	}
}
