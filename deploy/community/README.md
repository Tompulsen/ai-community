# Single-container community releases

Run `release.py` on the existing Linux deployment host as root. It reuses the
private Compose definition, configuration, account sessions, networks and volumes.
It does not build images, migrate data, or change the database services.

```sh
python3 release.py ghcr.io/tompulsen/ai-community@sha256:<published-digest>
```

The image must already be pulled and its revision label must identify the intended
commit. Confirm that commit before running the command. The script validates the
image source, tests a candidate with workers disabled, and archives assets.
Host loopback port `43000` must be available for the temporary candidate.
When a verified host proxy reaches web through its Docker gateway, a reviewed
Python deployment driver can call `main(image, proxy_gateway='172.21.0.1')`.
The address must match a live container network gateway; the release trusts only
that single address plus loopback and enables `NEW_API_TRUST_PROXY`. Verify that
the ingress overwrites visitor-supplied forwarding headers first. This option is
not exposed by the command-line entry point. Rollback restores the previous flags.
The current vhost is `/opt/1panel/www/conf.d/zhangyu-community.conf`.
For its 1Panel include layout, only `proxy/root.conf` may exist in the proxy
directory. Production keeps the original include, limits and root directives.
Only the temporary candidate vhost inlines that fragment; the original
`root.conf` is never modified. Unexpected fragments or upstreams abort preparation.

The existing vhost first switches to the verified candidate on `43000`, and public
probes must pass before the previous web is stopped. After the previous Nginx
workers exit naturally, the script leaves the old web and its background workers
running for another 720 seconds. It then sends SIGTERM, waits for a successful
exit, and recreates only `web` on `13000`. The candidate keeps serving throughout.
Once the new web passes direct checks, the vhost switches back to `13000` and
public checks run again. The script waits for the candidate's previous Nginx
workers and another 720 seconds before gracefully stopping and removing it.
These waits make a normal release take at least 24 minutes while traffic continues.
The first run also retires `unified_web` and `legacy-display` after verification.

The 720 seconds are a conservative operational window, not a verified active-task
count. Legacy images do not track paid generation after the browser disconnects.
Their image upstream timeout is 600 seconds, followed by result persistence;
reference preparation and result storage are outside that timeout. An unusually
slow request can therefore exceed this window. The script never escalates a
production stop to SIGKILL or sends a second SIGTERM after a stop timeout.
Nginx must also allow its previous workers to exit naturally.

Text streams allow 180 seconds for response headers, 300 seconds without model
progress, and 30 minutes overall. The request record adds one minute for saving.
Current images track accepted generation and polling work even after HTTP clients
disconnect: shutdown stops admission and waits for persistence before closing
storage. Container stop grace is 32 minutes and `docker wait` allows 1940 seconds;
deployments which preserve an existing Compose definition must update its web
`stop_grace_period` too. An upgrade from an older image still requires draining
its accepted work before stopping it; the new tracking cannot protect the old
process retroactively.

Old `/assets/` files are kept under
`/opt/1panel/www/sites/zaiduyu.top/community-assets/assets`. OpenResty tries the
current application first and reads this directory only after an asset 404.
Only regular static files are copied. Conflicting contents under the same URL
abort the release. Unknown assets remain 404; APIs and attachments never fall
back to previous applications. Archives are retained until an explicit cleanup.

Release records and private rollback definitions are saved in
`/opt/ai-community-next/releases/single-web-<UTC timestamp>`. They can contain
deployment secrets and must not be committed or served over HTTP.

On a failed switch, the script keeps the candidate serving while restoring the
previous pinned web, then switches traffic back after health checks. A failure
before the old web is stopped restores its original proxy without recreating it.
If the candidate has exited but the new web is verified healthy, the script
preserves the new web on `13000` and reports that rollback needs attention.
If a drain or rollback cannot complete, the candidate is retained rather than
forcibly removed; inspect `result.json` for `retainedCandidate`, `cleanupError`
and `rollback` before starting another release. A retained candidate can still
own port `43000`. Successful application verification can report `complete`
with a retained candidate if only its cleanup timed out.

Previous images and retired containers are preserved. Rollback restores the app
and proxy configuration; it does not undo database writes or upstream charges.
PostgreSQL, Redis, documents and other
containers must retain their IDs and start times. No paid generation, payment or
manual lottery request is used for verification; normal production workers resume.

Check script behavior locally with:

```sh
python -m unittest discover -s deploy/community -p 'test_*.py'
```

## Video transfer limits

Video reads share a Redis budget per upstream account across web instances and
sessions. `COMMUNITY_VIDEO_MEDIA_CONCURRENCY` defaults to 2 simultaneous transfers;
`COMMUNITY_VIDEO_MEDIA_BYTES` defaults to 1073741824 bytes (1 GiB) per
`COMMUNITY_VIDEO_MEDIA_WINDOW_SECONDS` (600 seconds by default). A window starts
with the first charged bytes and is fixed, so a transfer spanning its expiry can
use the remaining old budget and then the next window's allowance.

Each chunk is charged before forwarding. Range retries, interrupted reads, poster
source downloads and poster responses count; cancellation does not refund bytes.
Shared poster jobs retain their own lease independently of individual viewers.
The per-transfer size cap, image protections and historical URL reads still apply.
Redis errors stop the transfer. Account limits return HTTP 429 with `Retry-After`
before streaming starts; exhaustion after headers closes the stream. Invalid
configuration fails closed. Test with an isolated Redis service using
`MEDIA_BUDGET_TEST_REDIS_URL` and `node --test server/creation/media-budget.test.mjs`.

## Account network isolation

The production `accounts` network is the external, **internal bridge**
`ai-community_accounts`. Only community web, `ZY-newapi`, `ZY-redis` and
`ZY-image-async` belong to it. Web retains its own database and outbound networks
and must not join `1panel-network`, which contains another project's MySQL.
Binding MySQL's published port to host loopback does not isolate bridge peers.

`isolation.py` provides the Compose transformations and a read-only deployment
check. `community_definition` disables MCP explicitly and sets `cap_drop: ALL`
and `no-new-privileges:true`. `upstream_definition` adds only the required aliases
to each upstream's existing Compose file. Preserve the original files privately,
validate the resulting Compose definitions, create the internal network, and
connect existing upstream containers without restarting them. The internal bridge
uses `gw_priority: -1` (and `docker network connect --gw-priority -1`) and must not
replace their original default routes. Replace only web after CI passes.
Keep names, ports, environments, existing upstream networks and data volumes.

After each release, run from the verified main checkout on the deployment host:

```sh
python3 deploy/community/isolation.py
```

This checks persisted Compose configuration, runtime privileges, exact network
members and TCP connectivity: required dependencies must answer while the live
MySQL IP, its X Protocol port and host loopback paths must not. It sends no MySQL
credentials or SQL. Also check account bootstrap, Redis PING, image service health
and anonymous MCP rejection. Generation and wallet transactions are not probes.

If cutover fails, drain the new web worker before restoring the prior pinned
image and private Compose. Restore upstream files and remove only connections
added by this migration; remove the new bridge only after it is empty. No extra
container is needed for rollback. Re-enabling MCP requires a separate isolation
review: an environment allowlist is not a sandbox for a tool process.
