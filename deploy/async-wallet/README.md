# Wallet support for the existing image and video proxies

These patches target the running source exported on 2026-11-16. They extend the
existing standalone services, following the earlier `studio/deploy/image-async`
patch workflow. Existing source and license notices are retained in their base
images; this bundle contains only the changes and shared wallet code. The SHA256
manifest identifies every touched source file. It is not a Docker manifest digest.

Only authenticated community requests acquire wallet eligibility. Middleware
validates the client's HMAC against the complete streamed body, path/query,
user, timestamp and idempotency key before admitting a task. A persistent SQLite
nonce table rejects replay. Missing configuration or an invalid proof never
falls back to ordinary quota. Requests without community headers keep their
existing billing behavior.

The verified user/client/idempotency/key fingerprint is stored inside the existing
Fernet-encrypted job payload. The eventual worker freezes the real HTTPX request
bytes and signs its actual downstream path with a fresh nonce/timestamp. New API
must still verify that the personal model key belongs to that signed user and
perform all money settlement. Queue retries and GET polling do not mint credit or
replay an accepted generation. Turning the flag off while signed jobs are queued
also prevents those jobs from silently using ordinary quota.

Images cover synchronous JSON, synchronous SSE, queued generation and multipart
editing. Community video requests preserve their original JSON or multipart body
and use New API's native `/v1/videos` plus its existing task-polling path. This
also fixes the old wrapper's JSON-only/1 MB input mismatch for community uploads.
Signed input/output is capped at 64 MiB. Ordinary video requests retain the
previous format and size limit. The video overlay adds `python-multipart==0.0.33`;
it preserves the base image's command and runs as `10001:10001`.

Push this bundle to the community GitHub repository first, then pull that commit
on the server. Export `/app/service` from each exact running base image into a
separate source directory. Do not edit an active container or its task database.
Prepare each build context from the immutable exports:

```sh
python deploy/async-wallet/prepare_overlay.py --kind image-async \
  --source /private/image-baseline --output /private/image-wallet-build
python deploy/async-wallet/prepare_overlay.py --kind video-async \
  --source /private/video-baseline --output /private/video-wallet-build
docker build --build-arg BASE_IMAGE=VERIFIED_IMAGE_BASE -t image-async:wallet /private/image-wallet-build
docker build --build-arg BASE_IMAGE=VERIFIED_VIDEO_BASE -t video-async:wallet /private/video-wallet-build
```

Each source directory must contain `service/`. The preparation tool validates
every touched file, checks the patch, and writes only to a new build directory.
Keep the original images available for rollback. Preserve `/data`, encryption
keys, existing environment, ports, limits and commands. Install these server-only
values on both proxy API processes and workers, matching the community/New API:

```text
COMMUNITY_WALLET_ENABLED=true
COMMUNITY_WALLET_CLIENT_ID=https://YOUR_COMMUNITY_ORIGIN
COMMUNITY_WALLET_SECRET=<independent random secret, at least 32 characters>
```

Nginx must preserve the original `/async-images/...`, `/async-videos/...` and
`/v1/images/...` request path and all six proof/idempotency headers. Keep all
feature flags off until New API and both proxies are deployed and verified.

Tests use mock HTTPX transports and temporary SQLite databases, with no paid
model calls. The integration tests require full copies of the matching patched
services at `$ASYNC_PROXY_SOURCE_ROOT/image-async/service` and
`$ASYNC_PROXY_SOURCE_ROOT/video-async/service` (include the unchanged base files).

```sh
python -m pytest -q deploy/async-wallet/test_community_wallet.py
ASYNC_PROXY_SOURCE_ROOT=/private/patched-proxy-sources \
  python -m pytest -q deploy/async-wallet/test_proxy_integration.py
```

Validation covered FastAPI 0.159.1, Starlette 1.9.0, HTTPX 0.28.1 and
python-multipart 0.0.33, matching the observed video runtime plus its new parser.
The mock suite verifies original/rewritten bytes, signatures, malformed proofs,
nonce replay, persisted key binding, image JSON/SSE/uploads, video JSON/uploads,
deduplication and unsigned task polling. A real New API end-to-end check remains
part of server rollout; local mocks do not establish production settlement.

Validation on 2026-11-16: all 22 proxy tests passed. Both overlay preparations
verified the exported source hashes and applied successfully; every prepared
Python file was compared byte-for-byte with the tested source. Unsigned image
and video requests were checked with the wallet flag both enabled and disabled.
The final community checks passed: 24 focused Node tests, production build and
the wallet browser scenario at 1440/390/320 px with accessibility assertions.
Earlier full suites on this change passed 214 frontend tests and 228 backend
tests (one existing backend skip); the final request-validation adjustment was
then covered by the focused Node suite. The existing account/top-up browser
suite also passed all 11 scenarios.

Authentication review references: OWASP ASVS 5.0.0, Authentication Cheat Sheet
and Session Management Cheat Sheet. Applicable controls checked here include
server-only credentials, binding the signed subject to an owned model key,
unpredictable nonces, expiry, replay rejection, request integrity and rejecting
invalid proof instead of changing payment source. Production TLS, secret
distribution and the deployed New API owner check remain rollout verification.
