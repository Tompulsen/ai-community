# Community built-in studio

`studio/` contains the MIT-licensed OC application, pinned in `studio/UPSTREAM.md`.
It builds from this repository and runs as the `studio` Compose service. The
community backend serves its pages, APIs and assets under `/studio`; it never
proxies to the public OC website. Vue and React keep their own style/runtime
boundaries in a same-origin frame. Text/image/video route changes reuse that frame.

The existing New API identity binding, PKCE authorization, per-user selected token,
server-side account checks and billing relay are retained. The studio requires
`NEW_API_BASE_URL`, `NEW_API_PUBLIC_URL`, `NEW_API_SESSION_SECRET`,
`NEW_API_REDIS_URL`, `COMMUNITY_SSO_ORIGIN`, `STUDIO_PUBLIC_ORIGIN` and
`COMMUNITY_SSO_SECRET`. Both origin variables identify the community. Configure
New API's `STUDIO_SSO_ORIGIN` to that same community origin. Its fixed callback
`/api/new-api/community/callback` is served by the community backend.

`COMMUNITY_INTERNAL_URL=http://web:3000` keeps identity validation inside the
Compose network. `COMMUNITY_STUDIO_UPSTREAM=http://studio:3000` is the community's
private studio destination. No model key is placed in frontend configuration.
Use the original per-user asynchronous image/video relay settings when enabled.

Studio history uses the separate `community-studio` IndexedDB database and
account-scoped `octopus:` keys. Signing out revokes the current account context
but retains its local history. The studio does not register a Service Worker.
Old OC browser history remains on the old origin; users can export it there and
import it with the existing studio local-backup feature.

Release order: validate, push to GitHub `main`, verify its commit, pull `main` on
the server, build/pull both images at that exact revision, deploy, verify the
authorization path and site health, then remove only verified obsolete containers.
Private environment files and rollback configuration must not be committed.

The deployment uses the existing account network (`NEW_API_NETWORK`, default
`1panel-network`) for the internal New API and asynchronous image service. Studio
sessions use database 3 of `ZY-redis` and their own session secret. The explicit
hostname preserves the existing sessions and avoids the ambiguous `redis` alias
present on both attached networks.

Community authorization routes bypass the community Service Worker so browser
navigation metadata and OAuth redirects remain intact. The updated worker
activates immediately for existing tabs. Failed authorization returns to the
workbench with a retry action; successful authorization preserves the remix URL.

On this server, `python3 deploy/studio/deploy.py <full-main-commit>` verifies and
pulls main and both images, updates the account authorization origin, preserves
existing data mounts and other services, publishes the matching source archive,
and restores the previous deployment if verification fails. Release records and
private rollback files are under `/opt/community-studio-releases/`.

Validation commands:
- `node deploy/studio/test-proxy.cjs`
- `node deploy/studio/test-environment.cjs`
- `node deploy/studio/test-authorization-navigation.cjs` (installed Playwright and Chromium)
- From `studio`: `node --no-warnings --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --testTimeout=30000`
- From `studio`: `node node_modules/typescript/bin/tsc --noEmit --incremental false`
- `node scripts/check-shipping.mjs --base <previous-main-commit>`

The imported preview-stream tests may need a 30-second test timeout on Windows.
The existing community typecheck has ten baseline diagnostics in router call
sites, a timer type and studio sharing; this integration introduces none.
