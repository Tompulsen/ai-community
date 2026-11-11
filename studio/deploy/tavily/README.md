# Tavily through New API

This standalone service exposes Tavily search as two OpenAI-compatible models:
`tavily-quick` and `tavily-deep`. No New API source changes or
additional npm packages are required. It returns search evidence, not an
LLM-generated answer or webpage full text.

Request path:

```text
Chat /api/skills/retrieve
  -> New API /v1/chat/completions (signed-in user's selected token)
  -> this service /v1/chat/completions (channel proxy key)
  -> Tavily /search (administrator's Tavily key)
```

## Deploy the adapter

1. Copy `.env.example` to `.env` in this directory.
2. Fill `TAVILY_API_KEY` (one key) or `TAVILY_API_KEYS` (a key pool), and generate
   an independent `TAVILY_PROXY_KEY` of at least 32 characters. Do not use a user
   token as the proxy key or commit keys.
3. Set `TAVILY_NEW_API_NETWORK` to the existing Docker network containing New API.
   The default is `1panel-network`; confirm the actual deployment before use.
4. Run `docker compose up -d --build` in this directory.

The container is named `ZY-tavily`, with network alias `tavily`. The host port
is loopback-only, `127.0.0.1:18093`. New API on the same Docker network can use
`http://tavily:18093`. A New API process running on the host can instead use
`http://127.0.0.1:18093`. Do not use the host loopback address from a different
container. Health check: `GET /healthz`; it does not call Tavily.

For a local process, set the two environment variables and run:

```sh
node deploy/tavily/server.cjs
```

The process listens on all interfaces; keep it behind a firewall or use the
loopback-only Docker port mapping. All model and search endpoints require the
proxy key. The service does not log query bodies, results, or keys.

## Add or replace Tavily keys

The existing `TAVILY_API_KEY` setting still works. To use multiple keys, edit
`/opt/octopus-tavily/.env` on the server:

```dotenv
TAVILY_API_KEYS=tvly-your-first-key,tvly-your-second-key
```

`TAVILY_API_KEYS`, when nonempty, replaces the single-key setting. Commas or
whitespace separate keys; duplicates are removed. Use a single comma-separated
line in a Docker `.env` file. Then apply the configuration:

```sh
cd /opt/octopus-tavily
docker compose up -d --force-recreate
```

Keep `TAVILY_PROXY_KEY` unchanged. The New API channel address, key, models, and
prices do not need to change when you add or replace upstream Tavily keys.

Requests rotate through available keys. Only explicit Tavily rejections cause
failover: 401 disables that key until a restart; 429 pauses it for `Retry-After`
(or 60 seconds if absent/invalid); 432/433 pause it for five minutes. A request
tries each key at most once within the original 25-second timeout. When all keys
are unavailable, it fails without calling Tavily again.

Timeouts, disconnects, 5xx, other HTTP errors, invalid JSON, and invalid search
results never cause failover, since a search may already have consumed credits.
Key cooldown state is in memory and resets when the service restarts. An added
or corrected key takes effect after container recreation. This is a single
adapter instance; no database or admin page is required.

## Configure New API

Create an **OpenAI** channel:

| Field             | Value                                      |
| ----------------- | ------------------------------------------ |
| Base/override URL | `http://tavily:18093` (no `/v1` suffix)    |
| Key               | the separate `TAVILY_PROXY_KEY`            |
| Models            | fetch, or enter `tavily-quick,tavily-deep` |
| Group             | the groups whose users may buy search      |

`GET /v1/models` lists both models without making a paid request. A channel
**test** calls the search endpoint and can consume Tavily credits; use the
basic model and expect real usage.

Set an explicit **fixed price per request** for each model in New API's pricing
settings. Do not set token pricing. Do not map either model to the other or
map them to an ordinary chat model. Group multipliers are managed by New API.
Configure user token model permissions to include the search model where needed.

Each successful search response includes one accounting unit
(`prompt_tokens: 1`, `completion_tokens: 0`, `total_tokens: 1`) so older New API
versions do not discard fixed-price charges as zero usage. This unit represents
one search, not actual LLM token usage. The adapter never calls a chat model.
The final SSE event includes the same usage for New API's streaming channel test.

The adapter fixes `search_depth` to `basic` or `advanced` based on the model,
disables automatic parameter upgrades, and requests at most six results.
Basic and advanced currently cost 1 and 2 Tavily credits respectively; confirm
your own Tavily plan before choosing a retail price.

## Enable billed search in Chat

After configuring and verifying the channel and its prices, Chat uses
`tavily-quick` by default whenever New API account mode is enabled. To choose
advanced search, set in the chat service environment:

```dotenv
SKILLS_WEB_SEARCH_MODEL=tavily-deep
```

`NEW_API_BASE_URL` must already point at the New API account service. Recreate
the chat container after changing its environment. The composer has a separate
web-search control with off, quick and deep modes. New conversations default
to off; selecting a mode does not make a paid request. An empty server setting
defaults legacy retrieval requests to `tavily-quick`.

Search always uses the logged-in user's own system-created Auto token, with an
empty `auto_groups` list, independently of their selected chat token and group.
New API's system Auto routes must include a group containing the Tavily channel
and its search models. Pricing and group multipliers remain in New API.

The server remembers the system token per account. If it is missing or has
been deleted, the existing locked provisioning flow creates one and continues
the search without changing the selected chat token. Disabled, expired,
exhausted or edited tokens fail without bypassing their restrictions.
Uncertain creation results are reconciled rather than blindly retried.
No token secrets are returned to the browser.

Search never falls back to a shared key or another provider after errors.
Without New API account mode, web search is unavailable.
Crossref paper search is unchanged.

## Billing and failure checks before release

- Verify with a test user/token: a successful basic search produces exactly one
  New API search log and the configured fixed charge; answering is a separate
  model request with its own charge.
- Verify advanced search separately and confirm it uses its own price.
- Verify chat group switches do not change the search token. Delete the system
  Auto token and confirm concurrent searches create only one replacement.
- Verify insufficient balance, denied model/group, and a disabled/expired token
  block the request without using a shared administrator token.
- Verify a bad Tavily key, timeout, and malformed upstream response do not create
  a successful search charge. Refund/reservation behavior belongs to the actual
  deployed New API version and must be tested there.
- The adapter only fails over after explicit 401/429/432/433 rejections; it never
  replays an ambiguous paid POST. Chat also does not retry. Check New API's
  own retry policy and any reverse proxy in the path; disable retries for these
  search requests. Ambiguous upstream failures deliberately return HTTP 400 with
  `tavily_search_failed`, avoiding the default relay retry on 5xx responses.
  Do not override this error status to success or a retriable status.
- A valid response with zero results is still a completed search and is billed.
  The chat client reports that no sources were found.
- Cancelling a request propagates upstream when the connection is closed. A
  search already processed by Tavily can still consume credits even when the
  browser disconnects or New API refunds a failed request. Exactly-once charging
  across third-party network failures is not guaranteed.

The adapter timeout is 25 seconds; Chat allows 45 seconds for the relay response.
Configure the New API and reverse-proxy timeouts above that upstream limit.

## Local verification

```sh
node --test deploy/tavily/server.test.cjs
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand test/skills-retrieval.test.ts test/new-api-proxy.test.ts
```

The adapter tests use real local HTTP requests with a mocked Tavily upstream.
They do not spend credits or prove production balance deductions.

Official references:

- https://docs.tavily.com/documentation/api-reference/endpoint/search
- https://docs.tavily.com/documentation/api-credits
- https://github.com/QuantumNous/new-api/blob/main/controller/channel.go
- https://github.com/QuantumNous/new-api/blob/main/service/text_quota.go
