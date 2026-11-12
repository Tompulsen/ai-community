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
