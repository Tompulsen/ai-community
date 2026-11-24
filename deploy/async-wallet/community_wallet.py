"""Preserve verified community payment intent across the existing async queues.

Install as service/community_wallet.py in both proxy images. No browser or
ordinary API caller gains wallet privileges without the service HMAC proof.
"""
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
from contextvars import ContextVar
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

_current = ContextVar("community_wallet", default=None)
_fields = ("client", "user", "timestamp", "nonce", "signature")
MAX_BODY = 65 * 1024 * 1024


def _config():
    secret = os.environ.get("COMMUNITY_WALLET_SECRET", "")
    client = os.environ.get("COMMUNITY_WALLET_CLIENT_ID", "")
    if (os.environ.get("COMMUNITY_WALLET_ENABLED") != "true"
            or not 32 <= len(secret) <= 4096 or not 1 <= len(client) <= 255
            or "\n" in client or "\r" in client):
        raise HTTPException(503, "community_wallet_unavailable")
    return secret, client


def _canonical(client, user, timestamp, nonce, path, idem, digest):
    return "\n".join(("community-wallet-v1", client, user, timestamp, nonce,
                      "POST", path, idem, digest)).encode()


def _token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def _remember_nonce(client, nonce, timestamp):
    path = Path(os.environ.get("DATA_DIR", "/data")) / "community-wallet-nonces.sqlite"
    with sqlite3.connect(path, timeout=5) as connection:
        connection.execute("CREATE TABLE IF NOT EXISTS nonces (client TEXT, nonce TEXT, created INTEGER, PRIMARY KEY(client,nonce))")
        connection.execute("DELETE FROM nonces WHERE created < ?", (timestamp - 180,))
        try:
            connection.execute("INSERT INTO nonces VALUES(?,?,?)", (client, nonce, timestamp))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "community_wallet_replayed") from None


class CommunityWalletMiddleware:
    """Verify streaming bytes before a route can admit a paid task."""
    def __init__(self, app, paths):
        self.app, self.paths = app, frozenset(paths)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        raw = [(key.lower(), value) for key, value in scope.get("headers", [])]
        signed = any(key.startswith(b"x-community-") for key, _ in raw)
        if not signed:
            return await self.app(scope, receive, send)
        try:
            secret, expected_client = _config()
            if scope.get("method") != "POST" or scope.get("path") not in self.paths:
                raise HTTPException(403, "community_wallet_invalid_route")
            headers = {}
            protected = {b"authorization", b"idempotency-key"} | {("x-community-" + name).encode() for name in _fields}
            for key, value in raw:
                if key in protected and key in headers:
                    raise HTTPException(403, "community_wallet_invalid_proof")
                headers[key] = value.decode("latin-1")
            proof = {name: headers.get(("x-community-" + name).encode(), "") for name in _fields}
            idem = headers.get(b"idempotency-key", "")
            authorization = headers.get(b"authorization", "")
            if (proof["client"] != expected_client
                    or not re.fullmatch(r"[1-9][0-9]{0,15}", proof["user"])
                    or int(proof["user"]) > 9007199254740991
                    or not re.fullmatch(r"[0-9]{10,11}", proof["timestamp"])
                    or abs(int(proof["timestamp"]) - int(time.time())) > 60
                    or not re.fullmatch(r"[a-f0-9]{32}", proof["nonce"])
                    or not re.fullmatch(r"[a-f0-9]{64}", proof["signature"])
                    or not re.fullmatch(r"[A-Za-z0-9._:-]{16,128}", idem)
                    or not authorization.startswith("Bearer ")
                    or not re.fullmatch(r"[A-Za-z0-9_.:-]{8,512}", authorization[7:])
                    or headers.get(b"content-encoding", "identity").lower() != "identity"):
                raise HTTPException(403, "community_wallet_invalid_proof")
            raw_path = scope.get("raw_path", scope["path"].encode()).decode("ascii")
            if scope.get("query_string"):
                raw_path += "?" + scope["query_string"].decode("ascii")
        except (UnicodeError, ValueError):
            return await JSONResponse({"error": {"code": "community_wallet_invalid_proof"}}, status_code=403)(scope, receive, send)
        except HTTPException as error:
            return await JSONResponse({"error": {"code": error.detail}}, status_code=error.status_code)(scope, receive, send)

        state = {"verified": False, "wallet": {
            "client": proof["client"], "user": proof["user"], "idem": idem,
            "token_hash": _token_hash(authorization[7:]),
        }}
        digest = hashlib.sha256()
        count = 0

        async def verified_receive():
            nonlocal count
            message = await receive()
            if message["type"] == "http.request" and not state["verified"]:
                chunk = message.get("body", b"")
                count += len(chunk)
                if count > MAX_BODY:
                    raise HTTPException(413, "community_wallet_body_too_large")
                digest.update(chunk)
                if not message.get("more_body", False):
                    canonical = _canonical(proof["client"], proof["user"], proof["timestamp"],
                                           proof["nonce"], raw_path, idem, digest.hexdigest())
                    expected = hmac.new(secret.encode(), canonical, hashlib.sha256).hexdigest()
                    if not hmac.compare_digest(expected, proof["signature"]):
                        raise HTTPException(403, "community_wallet_invalid_proof")
                    try:
                        _remember_nonce(proof["client"], proof["nonce"], int(time.time()))
                    except sqlite3.Error:
                        raise HTTPException(503, "community_wallet_verification_unavailable") from None
                    state["verified"] = True
            return message

        context = _current.set(state)
        try:
            await self.app(scope, verified_receive, send)
        finally:
            _current.reset(context)


def current_wallet(token):
    state = _current.get()
    if state is None:
        return None
    if not state["verified"] or not hmac.compare_digest(state["wallet"]["token_hash"], _token_hash(token)):
        raise HTTPException(403, "community_wallet_unverified_task")
    return dict(state["wallet"])


def wallet_digest(digest, wallet):
    if wallet is None:
        return digest
    return hashlib.sha256((digest + "\n" + wallet["client"] + "\n" + wallet["user"]
                           + "\n" + wallet["idem"] + "\n" + wallet["token_hash"]).encode()).hexdigest()


def sign_request(wallet, token, url, headers, **kwargs):
    """Serialize once, then sign the exact downstream request (including multipart)."""
    if wallet is None:
        return {"headers": headers, **kwargs}
    secret, client = _config()
    if (wallet.get("client") != client
            or not hmac.compare_digest(wallet.get("token_hash", ""), _token_hash(token))):
        raise HTTPException(403, "community_wallet_task_mismatch")
    target = urlsplit(url)
    upstream = urlsplit(os.environ.get("UPSTREAM_URL", "http://new-api:3000"))
    if ((target.scheme, target.netloc) != (upstream.scheme, upstream.netloc)
            or target.username or target.password or target.fragment):
        raise HTTPException(503, "community_wallet_invalid_upstream")
    clean = {key: value for key, value in headers.items()
             if not key.lower().startswith("x-community-") and key.lower() != "idempotency-key"}
    # HTTPX handles JSON encoding and file boundaries; content is sent unchanged.
    request = httpx.Request("POST", url, headers=clean, **kwargs)
    content = bytearray()
    for chunk in request.stream:
        if len(content) + len(chunk) > MAX_BODY:
            raise HTTPException(413, "community_wallet_body_too_large")
        content.extend(chunk)
    body = bytes(content)
    wire = dict(request.headers)
    wire.pop("transfer-encoding", None)
    wire["content-length"] = str(len(body))
    timestamp, nonce = str(int(time.time())), secrets.token_hex(16)
    path = target.path + ("?" + target.query if target.query else "")
    canonical = _canonical(client, wallet["user"], timestamp, nonce, path,
                           wallet["idem"], hashlib.sha256(body).hexdigest())
    wire.update({"X-Community-Client": client, "X-Community-User": wallet["user"],
                 "X-Community-Timestamp": timestamp, "X-Community-Nonce": nonce,
                 "X-Community-Signature": hmac.new(secret.encode(), canonical, hashlib.sha256).hexdigest(),
                 "Idempotency-Key": wallet["idem"]})
    return {"headers": wire, "content": body}
