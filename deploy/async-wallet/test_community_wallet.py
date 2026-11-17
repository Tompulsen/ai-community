import asyncio
import hashlib
import hmac
import time

import httpx
import pytest
from fastapi import FastAPI, Request
from starlette.exceptions import HTTPException

import community_wallet as wallet

SECRET = 'test-community-secret-' * 3
TOKEN = 'sk-test-personal-token'
CLIENT = 'https://community.example'


@pytest.fixture(autouse=True)
def settings(monkeypatch, tmp_path):
    monkeypatch.setenv('COMMUNITY_WALLET_ENABLED', 'true')
    monkeypatch.setenv('COMMUNITY_WALLET_SECRET', SECRET)
    monkeypatch.setenv('COMMUNITY_WALLET_CLIENT_ID', CLIENT)
    monkeypatch.setenv('UPSTREAM_URL', 'http://new-api:3000')
    monkeypatch.setenv('DATA_DIR', str(tmp_path))


def intent():
    return {'client': CLIENT, 'user': '17', 'idem': 'request-test-00001',
            'token_hash': hashlib.sha256(TOKEN.encode()).hexdigest()}


def signature(headers, path, body):
    canonical = '\n'.join(['community-wallet-v1', headers['X-Community-Client'], headers['X-Community-User'],
                           headers['X-Community-Timestamp'], headers['X-Community-Nonce'], 'POST', path,
                           headers['Idempotency-Key'], hashlib.sha256(body).hexdigest()])
    return hmac.new(SECRET.encode(), canonical.encode(), hashlib.sha256).hexdigest()


def signed_headers(body=b'{}', path='/async-images/v1/tasks', nonce='a' * 32):
    headers = {'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json',
               'X-Community-Client': CLIENT, 'X-Community-User': '17',
               'X-Community-Timestamp': str(int(time.time())), 'X-Community-Nonce': nonce,
               'Idempotency-Key': 'request-test-00001'}
    headers['X-Community-Signature'] = signature(headers, path, body)
    return headers


def app_for(path='/async-images/v1/tasks', admit_early=False):
    app = FastAPI()
    app.add_middleware(wallet.CommunityWalletMiddleware, paths=(path,))
    @app.post(path)
    async def endpoint(request: Request):
        if admit_early:
            wallet.current_wallet(TOKEN)
        await request.body()
        result = wallet.current_wallet(request.headers.get('authorization', '')[7:])
        return {'wallet': result}
    return app


def post(app, headers, body=b'{}', path='/async-images/v1/tasks'):
    async def invoke():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://proxy') as client:
            return await client.post(path, headers=headers, content=body)
    return asyncio.run(invoke())


def test_proof_is_verified_before_admission_and_replay_is_durable():
    headers = signed_headers()
    response = post(app_for(), headers)
    assert response.status_code == 200
    assert response.json()['wallet'] == intent()
    assert post(app_for(), headers).status_code == 409
    assert wallet.current_wallet(TOKEN) is None


@pytest.mark.parametrize('mutation', ['body', 'path', 'user', 'expired', 'signature'])
def test_tampered_proof_is_never_admitted(mutation):
    headers = signed_headers()
    body = b'{}'
    if mutation == 'body': body = b'{"changed":1}'
    elif mutation == 'path': headers = signed_headers(path='/v1/images/generations')
    elif mutation == 'user': headers['X-Community-User'] = '18'
    elif mutation == 'expired': headers['X-Community-Timestamp'] = str(int(time.time()) - 61)
    else: headers['X-Community-Signature'] = '0' * 64
    assert post(app_for(), headers, body).status_code == 403


def test_unsigned_call_stays_ordinary_and_missing_config_never_downgrades_signed_call(monkeypatch):
    monkeypatch.setenv('COMMUNITY_WALLET_ENABLED', 'false')
    assert post(app_for(), {'Authorization': 'Bearer ' + TOKEN}).json() == {'wallet': None}
    assert post(app_for(), signed_headers()).status_code == 503


def test_incomplete_body_cannot_establish_wallet_context():
    assert post(app_for(admit_early=True), signed_headers()).status_code == 403


def test_json_rewrite_gets_new_signature_for_real_upstream_bytes():
    target = 'http://new-api:3000/v1/images/generations'
    result = wallet.sign_request(intent(), TOKEN, target, {'Authorization': 'Bearer ' + TOKEN},
                                 json={'model': 'image', 'prompt': '中文'})
    request = httpx.Request('POST', target, **result)
    body = request.read()
    headers = request.headers
    assert body == b'{"model":"image","prompt":"\xe4\xb8\xad\xe6\x96\x87"}'
    assert headers['X-Community-Signature'] == signature(headers, '/v1/images/generations', body)
    assert headers['Idempotency-Key'] == intent()['idem']
    assert headers['X-Community-Signature'] != signature(headers, '/async-images/v1/tasks', body)
    assert int(headers['Content-Length']) == len(body)


def test_multipart_boundary_and_binary_payload_are_frozen():
    target = 'http://new-api:3000/v1/videos'
    result = wallet.sign_request(intent(), TOKEN, target, {'Authorization': 'Bearer ' + TOKEN},
                                 files={'model': (None, 'video'), 'input_reference': ('ref.png', b'\x00\xff\r\n', 'image/png')})
    first = httpx.Request('POST', target, **result)
    second = httpx.Request('POST', target, **result)
    body = first.read()
    assert body == second.read()
    assert first.headers['Content-Type'] == second.headers['Content-Type']
    assert b'\x00\xff\r\n' in body
    assert first.headers['X-Community-Signature'] == signature(first.headers, '/v1/videos', body)


def test_stored_payment_intent_cannot_change_api_key_or_upstream():
    with pytest.raises(HTTPException):
        wallet.sign_request(intent(), 'sk-other-owner-key', 'http://new-api:3000/v1/videos', {}, json={})
    with pytest.raises(HTTPException):
        wallet.sign_request(intent(), TOKEN, 'https://attacker.example/v1/videos', {}, json={})
    assert wallet.wallet_digest('bodyhash', intent()) != wallet.wallet_digest('bodyhash', None)
    assert wallet.wallet_digest('bodyhash', intent()) != wallet.wallet_digest('bodyhash', {**intent(), 'user': '18'})


def test_ordinary_worker_requests_are_not_signed():
    kwargs = {'json': {'model': 'existing'}, 'headers': {'Authorization': 'Bearer ' + TOKEN}}
    assert wallet.sign_request(None, TOKEN, 'http://new-api:3000/v1/videos', **kwargs) == kwargs
