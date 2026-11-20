# Native Octopus Account

This module ports the existing `studio/app/lib/new-api` account bridge into the
community server. It uses standard Request/Response objects and does not load
Next.js, run another server, or call the old Studio container.

The account routes retain password encryption, optional account verification,
server-only keys, account-scoped Auto provisioning, historical-key ownership
checks, quota scaling and the existing rotating refresh-token lock.

Configuration uses the same environment variables as Studio:

- `NEW_API_BASE_URL`, `NEW_API_PUBLIC_URL`
- `NEW_API_SESSION_SECRET` (preserve the existing secret)
- `NEW_API_REDIS_URL` (preserve the existing Redis database and session keys)
- Optional `NEW_API_IMAGE_BASE_URL`, `NEW_API_ASYNC_BASE_URL`
- Optional `NEW_API_TRUST_PROXY=true` for a trusted edge's validated real IP

The cookie remains `octopus_new_api_session`, encrypted session entries remain
under `octopus:new-api:`, and the seal format remains `iron-session@8.0.4`.
The old `/studio/api/new-api/*` URL is only an in-process compatibility alias.
Iframe context and SSO-exchange routes are intentionally not part of the native
bridge. Account-centre wallet operations remain at the account centre.

`readNativeAccount` exposes only identity and cookie fingerprint to the community
authentication layer. `resolveRelayCredentials` returns a server-only owned model
key plus its token/user IDs; callers must never serialize that key to the browser.

## Community registration

The guest account page uses `/account?mode=register`. Same-origin
`POST /api/new-api/registration-code` and `POST /api/new-api/register` forward
only registration fields to New API's public verification and registration
endpoints. New API remains responsible for account IDs, password hashes, verified
email, groups, initial quota, default tokens and invitation attribution.
Registration never creates a local password account or a login session. After
success, users continue through the existing login and community-profile binding.
An uncertain response must not automatically resubmit registration.

Register and password-register switches are checked against New API for every
submission. Email verification and legal links follow its status settings.
Each verification request and registration submission uses a fresh Turnstile token
with `action=registration`; subsequent login uses another token. The widget must
allow the community hostname, and New API must accept that verified hostname.

Before deployment, verify the real-IP chain: the community's
`TRUSTED_PROXY_CIDRS`, `NEW_API_TRUST_PROXY=true`, and New API's `TRUSTED_PROXIES`
must identify only the controlled proxies. Upstream IP and mailbox limits still
apply. Edge registration rules must also cover both new POST paths above and
their `/studio/api/new-api/` compatibility aliases. Forwarding over an internal
connection does not execute rules attached only to the account-centre hostname.
Exercise real email delivery and account creation only in the intended test
environment; local mocked tests do not establish a deployed registration.

## Community points wallet

`COMMUNITY_WALLET_ENABLED=true` enables the New API unified wallet. It defaults to
off. Also configure `COMMUNITY_WALLET_CLIENT_ID` (the community's fixed origin)
and `COMMUNITY_WALLET_SECRET` (at least 32 random characters, independent of the
login-session secret). The same values must be configured at New API, with its
`UNIFIED_WALLET_ENABLED` flag enabled after the complete relay path is verified.
Set `COMMUNITY_WALLET_QUOTA_PER_CNY` to the exact New API
`UNIFIED_WALLET_QUOTA_PER_CNY` value (for this deployment, `500000`). This controls
point displays for model prices, consumption logs, token limits and plan quotas;
it does not alter payment requests or settlement. Enabled point displays fail
closed when the scale is missing or invalid. Top-up previews use the server's
actual CNY payment quote times 5,000, including discounts. Historical order money
is shown only as a point equivalent, never as proof of permanent-wallet credit.
Keep these variables server-only; never prefix them with `VITE_`.

`GET /api/new-api/wallet/points` reads `/api/user/self/wallet` through the current
authenticated dashboard session. `/api/account` verifies the same New API subject
before returning decimal point strings. Charity points remain community-only;
permanent points represent the same confirmed CNY principal as New API's paid
balance. Both use 5,000 points per CNY. The community does not maintain or settle a
second balance. Historical mixed API quota remains separate. A failed wallet read
never substitutes historical quota for permanent points.

Paid generation and Tavily requests are signed with HMAC-SHA256. The canonical
UTF-8 payload is nine newline-separated values, without a final newline:
`community-wallet-v1`, client ID, numeric user ID, Unix timestamp, 32-character hex
nonce, `POST`, path plus query, idempotency key, SHA256 of the exact wire body.
The corresponding headers are `X-Community-Client`, `X-Community-User`,
`X-Community-Timestamp`, `X-Community-Nonce`, `X-Community-Signature` and
`Idempotency-Key`. Multipart bodies are serialized once, then sent with the same
boundary and bytes. Browser-provided community headers are discarded. Generation
keeps its existing per-account request deduplication and asynchronous recovery;
read-only task polling is unsigned.

Before enabling this feature, every asynchronous image/video proxy must preserve
the authenticated wallet context and sign its actual downstream path/body.
Rewriting a signed request while forwarding the old signature is invalid. Deploy
with the flag off until New API, proxies and community pass the same integration
tests. Do not treat turning off async creation as a completed migration.
