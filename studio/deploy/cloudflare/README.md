# Wallet checkout frame policy

The OC response-header Transform Rule overrides the application's CSP. Its older
`frame-src` allowed only OC and Turnstile, blocking the configured Epay gateway
`https://mzf.mapay.cn/xpay/epay` inside the wallet iframe.

`wallet-frame.json` adds only that HTTPS origin. The updater preserves the other
CSP directives, the main site's embedding permission, the X-Frame-Options
operation, rule order, and the separate `/community-embed` rule.

After this change is on GitHub `main`, pull and verify that commit on the server.
Run from an authorized management host with `CF_API_TOKEN` in the environment:

```sh
python3 deploy/cloudflare/update-wallet-frame.py
python3 deploy/cloudflare/update-wallet-frame.py --apply --backup /private/path/wallet-rule-before.json
```

The token needs read/edit access to this zone's response-header Transform Rules;
no DNS changes are involved. Backups contain the single rule's original and
applied definitions. Preflight detects changes before applying. Failed verification
restores only this rule when its current definition still matches this update.
Avoid editing the same rule concurrently during the short GET/PATCH operation.
An intentional later rollback uses the saved `original` definition with the
single-rule PATCH API after the same current-definition check.

Verify the public response headers and actual wallet iframe at desktop and phone
widths without disabling CSP. A gateway response to an unsigned test request
confirms framing only; it does not validate a paid checkout or later redirects.
New gateway redirect origins require separate evidence and review.
