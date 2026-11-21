# Single-container community releases

Run `release.py` on the existing Linux deployment host as root. It reuses the
private Compose definition, configuration, account sessions, networks and volumes.
It does not build images, migrate data, or change the database services.

```sh
python3 release.py ghcr.io/tompulsen/ai-community@sha256:<published-digest>
```

The image must already be pulled and its revision label must identify the intended
commit. Confirm that commit before running the command. The script validates the
image source, tests a candidate with workers disabled, archives assets, gracefully
stops the previous worker, replaces only `web`, and switches the existing vhost.
The first run also retires `unified_web` and `legacy-display` after verification.

Old `/assets/` files are kept under
`/opt/1panel/www/sites/zaiduyu.top/community-assets/assets`. OpenResty tries the
current application first and reads this directory only after an asset 404.
Only regular static files are copied. Conflicting contents under the same URL
abort the release. Unknown assets remain 404; APIs and attachments never fall
back to previous applications. Archives are retained until an explicit cleanup.

Release records and private rollback definitions are saved in
`/opt/ai-community-next/releases/single-web-<UTC timestamp>`. They can contain
deployment secrets and must not be committed or served over HTTP.

The script restores the previous deployment on a failed cutover. Previous images
and retired containers are preserved. PostgreSQL, Redis, documents and other
containers must retain their IDs and start times. No paid generation, payment or
manual lottery request is used for verification; normal production workers resume.

Check script behavior locally with:

```sh
python -m unittest discover -s deploy/community -p 'test_*.py'
```

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
