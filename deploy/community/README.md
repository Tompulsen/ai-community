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
