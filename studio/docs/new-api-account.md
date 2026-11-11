# New API Account Integration

The chat site uses New API for account authentication, user-owned model keys,
model permissions, balances and usage. It does not maintain a second account or
billing database. Account integration and registration default keys use
New API's native capabilities, without New API source code changes or a custom
image. Official New API images can continue to receive normal upgrades;
authentication and API compatibility still need verification when upgrading.

## Supported Authentication Protocol

This integration targets the access-token/refresh-cookie protocol verified on
New API `v1.0.0-rc.45`, image revision
`633b4c5b190dc1af99a2814391354d86948e7943`.
Older Gin-session versions are not silently treated as compatible.

Password login, optional encrypted passwords and TOTP/recovery-code verification
are supported. Registration, password recovery, recharge and other login methods
use links to the existing New API account center. OAuth and Passkey login inside
the chat site are not implemented.

## Configuration

```dotenv
NEW_API_BASE_URL=https://zhangyuapi.com
NEW_API_PUBLIC_URL=https://zhangyuapi.com
NEW_API_SESSION_SECRET=<independent-random-secret-at-least-32-characters>
NEW_API_REDIS_URL=redis://:<password>@<redis-host>:6379/2
NEW_API_TRUST_PROXY=false
```

Generate the chat site's independent secret with:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Do not copy New API's own session secret. All chat replicas must share the chat
secret and Redis. Sessions use only the `octopus:new-api:` key prefix, expire
after seven days, and contain encrypted credentials. A local development process
may omit Redis; its in-memory sessions are lost on restart. Production fails
closed without a configured secret and Redis URL.

`NEW_API_BASE_URL` is the server-to-server origin without `/v1`. When it is an
internal Docker or localhost address, configure `NEW_API_PUBLIC_URL` separately
so refresh/logout send the expected public Origin. Redis and New API must be
reachable from inside the chat container; container localhost is not host
localhost. Use a shared private Docker network or an explicitly configured host
gateway, without exposing Redis publicly.

When New API enables Turnstile, the existing widget configuration must allow the
chat site's hostname, for example `oc.zhangyuapi.com`. This is a Cloudflare
configuration change, not a New API code change. Production CSP permits the
official Turnstile script and frame. Development login also needs an allowed
hostname or an appropriate test widget.

`NEW_API_TRUST_PROXY=true` is optional. Enable it only when direct access to the
chat app is blocked and the trusted reverse proxy overwrites `X-Real-IP` with the
verified client IP. The BFF then forwards this IP and the user agent to New API.
Configure New API's trusted proxies to recognize the BFF's network. Otherwise
account actions share the BFF IP's upstream rate limit. Never trust a
client-supplied forwarding header on a publicly reachable app port.

## User Flow

1. Open `/#/account` and sign in with an existing New API account.
2. Complete Turnstile and two-factor verification when required.
3. Create a key or select an existing enabled key for chatting.
4. Send chat, image and video requests using that key.
5. Manage keys and view the most recent seven days of consumption in the account
   page. Recharge and account recovery continue in the New API account center.

Creating a key does not allocate additional account balance. New API remains
authoritative for token limits, groups, prices and final charges. The chat
site's amount display follows the public quota/currency settings.

## Registration Default Key

Default key creation belongs to New API's registration handler, not the chat
site's login handler. For the verified revision above, the required New API
settings for an Auto registration key are `GenerateDefaultToken=true` and
`DefaultUseAutoGroup=true`. The user's usable groups must also include `auto`.
These names refer to New API's own settings; they are not chat-site environment
variables.

On successful password registration, `controller.Register` creates a key using
New API's translated, username-based name, with `expired_time=-1`,
`unlimited_quota=true`, and model limits disabled. With
`DefaultUseAutoGroup=false`, its `group` remains empty, inheriting the user's
account group instead of selecting the automatic group. Unlimited key quota
does not add account balance or bypass New API billing. This verified behavior
covers password registration, not other account-creation paths. With
`DefaultUseAutoGroup=true`, the key instead uses `group="auto"`.

On sign-in, the chat site checks the user's existing key list. It automatically
selects a key only when the upstream response confirms exactly one key in total
and returns that one item, and the key is enabled, usable, inherits the account
group (`group=""`) or the global Auto list (`group="auto"` with no custom
`auto_groups`), has unlimited quota and never expires. The key's name is not
used to identify it. Zero keys, multiple keys, an incomplete response, or a key
that does not meet these conditions require an explicit user choice.

Automatic selection sets the chat session's `selectedTokenId`; it does not
create a key or re-enable a disabled key. Once chosen, session refresh does not
replace it. Explicitly signing in creates a new chat session. If no suitable key
exists, the user selects or creates a key explicitly.

Existing users receive no automatic backfill. An account with zero keys does
not trigger creation during login or session refresh. Deleting the default key
does not recreate it. The registration settings affect future registrations
only; login and session refresh never provision or rebuild keys.

## Auto System Routing

The chat model selector offers `Auto` with a separate `System` badge only when
New API returns `auto` in the user's available groups. Selecting it reuses the
account's bound global Auto key, or provisions one on the first explicit
selection using `group="auto"` and `auto_groups=[]`. Browsing never creates keys.
Custom Auto combinations are not reused as global Auto keys or overwritten.
Keys provisioned by the chat selector are named `系统创建`. Creation first uses a
unique temporary name to reconcile uncertain responses, records the resulting
ID, and then renames that key. Retrying a failed rename never creates another
key. Existing bound or manually named keys retain their names. This naming does
not change the default key generated by the backend's registration handler.
An invalid or modified bound key requires explicit repair rather than silent
replacement.

New manually created keys default to Auto when the account has permission and
the native Auto settings endpoint is supported. The editor also offers a single
group and an ordered custom combination. Existing inherited keys retain
`group=""` and are labeled as following the account; saved names, quotas and
routing remain unchanged until edited.

## Isolation and Revocation

The browser receives only an opaque, host-only HttpOnly session cookie, not the
dashboard access token, upstream refresh cookie or selected model key. There is
no administrator master credential. Every key operation uses the current user's
dashboard identity and New API checks ownership. Updating a key preserves
advanced fields not edited by this UI.

Refresh operations are serialized by Redis locks; an expired lock holder cannot
overwrite a newer session. Account changes and paid model POSTs require an exact
same-origin request. Only a short allowlist of model headers is forwarded.
Dashboard credentials and chat cookies never reach the model relay.

Each browser tab binds protected requests to the last confirmed account ID.
Account changes invalidate pending resource/model responses and clear the old
model list. A stale tab receives a conflict instead of modifying or spending from
a different account. Redis connection failures use bounded reconnect attempts;
a subsequent request can recreate an ended connection.

With account integration enabled, missing authentication or a selected key
causes an error; requests never fall back to the public `MODEL_API_KEY` or a
client-supplied key. Model requests validate the upstream dashboard session and
New API validates the model key. A disabled/deleted key fails upstream as well.
Ambiguous failed paid requests are not automatically replayed.

Chat messages remain in the existing browser storage. Account integration does
not add cross-device history synchronization.

`ACCESS_PASSWORD`, when configured, remains a separate site-wide access gate.
Leave it empty to offer New API account login as the only sign-in step.

## Verification

Focused tests:

```sh
node --no-warnings --experimental-vm-modules node_modules/jest/bin/jest.js --ci --runInBand test/new-api
```

Browser regression tests, with the development server running:

```sh
node scripts/verify-new-api-account.cjs
```

The browser script mocks account APIs; it never signs into real accounts or
creates production keys. Configure `UI_TEST_URL`, `PLAYWRIGHT_MODULE`, and
`UI_TEST_BROWSER` as in the existing UI verification scripts. Real login,
Turnstile hostname eligibility and charge accounting must also be checked with
a dedicated test account before enabling this mode for everyone.
