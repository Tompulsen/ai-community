# Account request rollout

The new group catalogue is read-only. Clients use `GET /api/creation/models?group=...` when the server's model-groups response advertises contract 2. Those accounts can select models and save preferences without a model key. Other accounts keep the legacy POST/token catalogue, including manual key model restrictions. Both contracts retain their generation and task interfaces.

## Before enabling v2

1. Stop accepting new creation requests and drain all old application instances. Keep the Redis data and result files. Never run an old writer alongside the new durable worker.
2. Apply `migration/20261125-account-requests.up.sql` to the community PostgreSQL database using the existing deployment migration procedure. Keep a database backup. The application does not run migrations automatically.
3. With the existing server environment loaded, run `node tools/migrate-account-requests.mjs` for a dry run, then add `--apply` to import all existing Redis request records. Repeat while writers are stopped. The tool never creates, deletes or renames upstream keys.
4. For each account's old group binding, inspect creation records and upstream token details to establish provenance. Supply an administrator-reviewed JSON manifest to `--credentials <path>`. Set `COMMUNITY_MIGRATION_SESSION` through the operator environment to that account's authenticated native session cookie. This value is a secret; never put it in the manifest, command history or repository. The tool verifies live account ownership, allowed group and token attributes without reading token secrets. Run once per account. Ambiguous and manual keys remain untouched.
5. Start this compatible server with `COMMUNITY_REQUEST_STORE=1`. Schema checks fail startup if required columns are missing. Import must finish before Redis is reset. Observe legacy operation first.
6. Set `COMMUNITY_CREDENTIAL_MIGRATION_CONFIRMED=1` only after the import and provenance audit. Use `COMMUNITY_REQUEST_V2_ACCOUNTS=17,18` for the initial account allowlist. `COMMUNITY_REQUEST_V2=1` enables all accounts. The catalogue advertises the accepted contract. Native login no longer provisions an Auto key for these accounts.

Example verified manifest (metadata only):

```json
[
  { "issuer": "https://accounts.example", "userId": 17, "group": "auto", "tokenId": 123,
    "verifiedSystemCreated": true, "evidence": "Operator checked the original provisioning record" }
]
```

For an interrupted creation use `pendingName` instead of `tokenId`, and `search:true` if the original Redis binding was the search binding. A pending creation remains an intent: only GET reconciliation is allowed. A lost rename response uses the already recorded token ID. Unverified same-name candidates block automatic adoption; token names alone are insufficient proof.

## Recovery and rollback

Both v1 and v2 use the same account/request primary key. A request is registered before preparing credentials; a version comparison must persist `dispatch_intent` before a generation POST. Duplicate IDs return the original record or a conflict, including when the v2 acceptance flag has since been disabled. Account/group/model/protocol/config revision and original token ID are fixed at dispatch. API keys exist only in sealed, task-bound GET tracking data, never clear database columns.

The database stores the recovery record before Redis. Workers rebuild the polling queue after Redis loss and can only issue GET requests for previously accepted jobs. Preparation is bounded to three minutes; a crashed preparation becomes `failed_before_dispatch`, with no automatic reconstruction or POST. There is intentionally no automatic replay after `dispatch_intent`, even if the process stopped just before the actual network send. Uncertain records require usage-log/operator reconciliation. Durable request tombstones are not automatically deleted; retaining them prevents an old ID from becoming executable again.

Keep `COMMUNITY_REQUEST_STORE=1` during rollback. Disable only the v2 acceptance flag and retain this compatible server/worker until all accepted jobs finish. Rolling back to an old image or dropping the tables loses the durable barrier. Keep the result volume and session sealing secret stable; large results remain in `.creation-results`.

Legacy token-based browser preferences are preserved until migration can verify token ownership and group through the metadata-only `/api/creation/preference-groups` endpoint. Conflicting or unavailable mappings remain in storage and show a warning; legacy token catalogues can still read their original preferences. New preferences use issuer/account/group/model and survive key replacement. Migration never reads or creates token secrets.

Local automated verification uses mocked upstream requests. Live generation, billing reconciliation, production migration and container rollout are separate deployment steps.

## Local verification on 2026-11-25

- Targeted backend suites: 262 passed, 2 pre-existing tests requiring an external PostgreSQL test database skipped. The new request/credential tests run against PGlite's PostgreSQL engine, including eight concurrent submissions, request-version conflicts, lost responses, Redis loss, worker recovery and recovery-file repairs.
- Frontend model loading, preferences and image submission: 78 passed. Browser checks: 9 passed, covering legacy group behavior and keyless v2 configuration/submission at desktop and mobile sizes. Production build passed, with the existing large-chunk warning.
- Three existing homepage video tests also fail with the pre-change frontend restored: `homepage hands video prompt and reference to Studio once`, `inline video model preserves input and references and carries video parameters`, and `switching to video retains image references above its lower limit`. They expect obsolete file/radio selectors or older validation text; their fixtures are outside this change.
- No production data was migrated, no real generation was sent, and no Git push or deployment was performed by this implementation task. The v2 acceptance flag remains off until the rollout steps above are completed.
