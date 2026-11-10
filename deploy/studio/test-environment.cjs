// SPDX-License-Identifier: AGPL-3.0-only
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const script = path.resolve(__dirname, '../../studio/scripts/validate-environment.cjs');
const env = {
  NEW_API_BASE_URL: 'http://accounts:3000',
  NEW_API_PUBLIC_URL: 'https://account.example.test',
  NEW_API_SESSION_SECRET: 'test-session-secret-at-least-thirty-two-characters',
  NEW_API_REDIS_URL: 'redis://redis:6379/3',
  COMMUNITY_SSO_ORIGIN: 'https://community.example.test',
  STUDIO_PUBLIC_ORIGIN: 'https://community.example.test',
  COMMUNITY_SSO_SECRET: 'test-shared-secret-at-least-thirty-two-characters',
};
const run = overrides => spawnSync(process.execPath, [script], { env: { ...env, ...overrides }, encoding: 'utf8' });
assert.equal(run({}).status, 0);
for (const key of Object.keys(env)) {
  const result = run({ [key]: '' });
  assert.equal(result.status, 1, key);
  assert(!result.stderr.includes(env.NEW_API_SESSION_SECRET));
  assert(!result.stderr.includes(env.COMMUNITY_SSO_SECRET));
}
assert.equal(run({ STUDIO_PUBLIC_ORIGIN: 'https://old-studio.example.test' }).status, 1);
assert.equal(run({ NEW_API_BASE_URL: '', OPENAI_API_KEY: 'must-never-enable-shared-fallback' }).status, 1);
assert.equal(run({ NEW_API_BASE_URL: 'https://user:secret@account.example.test' }).status, 1);
console.log('PASS: account-only startup, matching origins, persistent sessions and secret-safe errors');
