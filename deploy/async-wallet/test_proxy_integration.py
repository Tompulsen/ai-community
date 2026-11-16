"""Run against the matching patched service sources, never against live models."""
import asyncio
import base64
import importlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import uuid

import httpx
import pytest
from cryptography.fernet import Fernet

from test_community_wallet import settings, signature, signed_headers, intent, TOKEN

RealAsyncClient, RealClient = httpx.AsyncClient, httpx.Client
PNG = b'\x89PNG\r\n\x1a\n' + b'fixture-image'


def load_service(monkeypatch, kind):
    directory = Path(os.environ['ASYNC_PROXY_SOURCE_ROOT']) / (kind + '-async') / 'service'
    monkeypatch.setenv('ENCRYPTION_KEY', Fernet.generate_key().decode())
    monkeypatch.setenv('MIN_FREE_BYTES', '0')
    monkeypatch.setenv('MAX_IMAGE_BYTES', str(1024 * 1024))
    monkeypatch.setenv('MAX_VIDEO_BYTES', str(1024 * 1024))
    name = 'proxy_fixture_' + uuid.uuid4().hex
    spec = importlib.util.spec_from_file_location(name, directory / '__init__.py', submodule_search_locations=[str(directory)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    api = importlib.import_module(name + ('.api' if kind == 'image' else '.video'))
    core = importlib.import_module(name + '.core')
    tasks = importlib.import_module(name + '.tasks')
    async def authorize(request):
        token = request.headers['authorization'][7:]
        return core.owner_for(token), token, '127.0.0.1'
    monkeypatch.setattr(api, 'authorize', authorize)
    monkeypatch.setattr(tasks, 'enqueue_job', lambda *_args, **_kwargs: None)
    if hasattr(api, 'enqueue_job'):
        monkeypatch.setattr(api, 'enqueue_job', lambda *_args, **_kwargs: None)
    return api, core, tasks


def mock_upstream(monkeypatch, callback):
    transport = httpx.MockTransport(callback)
    def sync_factory(**kwargs):
        kwargs.pop('transport', None)
        return RealClient(transport=transport, **kwargs)
    def async_factory(**kwargs):
        kwargs.pop('transport', None)
        return RealAsyncClient(transport=transport, **kwargs)
    monkeypatch.setattr(httpx, 'Client', sync_factory)
    monkeypatch.setattr(httpx, 'AsyncClient', async_factory)


async def submit(app, path, body, content_type='application/json', nonce='a' * 32):
    headers = signed_headers(body, path, nonce)
    headers['Content-Type'] = content_type
    async with RealAsyncClient(transport=httpx.ASGITransport(app), base_url='http://proxy') as client:
        return await client.post(path, headers=headers, content=body)


@pytest.mark.parametrize('mode', ['sync-json', 'sync-sse', 'async-json', 'async-edit'])
def test_image_json_sse_and_queued_upload_retain_wallet_intent(monkeypatch, mode):
    api, core, tasks = load_service(monkeypatch, 'image')
    calls = []
    def upstream(request):
        body = request.read()
        calls.append(request)
        assert request.headers['X-Community-User'] == '17'
        assert request.headers['X-Community-Signature'] == signature(request.headers, request.url.raw_path.decode(), body)
        assert request.headers['Authorization'] == 'Bearer ' + TOKEN
        if mode == 'async-edit':
            assert request.url.path == '/v1/images/edits'
            assert PNG in body
            assert request.headers['Content-Type'].startswith('multipart/form-data; boundary=')
        else:
            assert request.url.path == '/v1/images/generations'
            assert json.loads(body)['model'] == 'image-fixture'
        if mode == 'sync-sse':
            result = {'type': 'image_generation.completed', 'b64_json': base64.b64encode(PNG).decode()}
            return httpx.Response(200, content=('data: ' + json.dumps(result) + '\n\ndata: [DONE]\n\n').encode(), headers={'content-type': 'text/event-stream'})
        return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(PNG).decode()}]})
    mock_upstream(monkeypatch, upstream)
    path = '/async-images/v1/tasks' if mode == 'async-json' else '/v1/images/generations'
    body = json.dumps({'model': 'image-fixture', 'prompt': 'a test', **({'stream': True} if mode == 'sync-sse' else {})}).encode()
    content_type = 'application/json'
    if mode == 'async-edit':
        path = '/async-images/v1/edits'
        raw = httpx.Request('POST', 'http://proxy' + path, files={
            'model': (None, 'image-fixture'), 'prompt': (None, 'a test'), 'image': ('ref.png', PNG, 'image/png')})
        body, content_type = raw.read(), raw.headers['Content-Type']
    response = asyncio.run(submit(api.app, path, body, content_type))
    assert response.status_code == (202 if mode.startswith('async') else 200), response.text
    if mode.startswith('async'):
        job = response.json()['id']
        with core.db() as connection:
            row = connection.execute('SELECT * FROM jobs WHERE id=?', (job,)).fetchone()
        assert core.unseal(row['payload'])['wallet'] == intent()
        tasks.generate.call_local(job)
        with core.db() as connection:
            row = connection.execute('SELECT * FROM jobs WHERE id=?', (job,)).fetchone()
        assert row['status'] == 'succeeded', dict(row)
        repeated = asyncio.run(submit(api.app, path, body, content_type, nonce='b' * 32))
        assert repeated.json()['id'] == job
        tasks.generate.call_local(job)
    else:
        assert 'b64_json' in response.text
    assert len(calls) == 1


@pytest.mark.parametrize('multipart', [False, True])
def test_video_proxy_uses_native_bytes_path_and_recovers_without_reposting(monkeypatch, multipart):
    api, core, _ = load_service(monkeypatch, 'video')
    path = '/async-videos/v1/tasks'
    if multipart:
        raw = httpx.Request('POST', 'http://proxy' + path, files={
            'model': (None, 'video-fixture'), 'prompt': (None, 'a test'),
            'input_reference': ('ref.png', PNG, 'image/png'), 'metadata': (None, '{"aspect_ratio":"16:9"}')})
        body, content_type = raw.read(), raw.headers['Content-Type']
    else:
        body = json.dumps({'model': 'video-fixture', 'prompt': 'a test', 'seconds': '8',
                           'metadata': {'ratio': '16:9', 'content': []}}).encode()
        content_type = 'application/json'
    response = asyncio.run(submit(api.app, path, body, content_type))
    assert response.status_code == 202, response.text
    job = response.json()['id']
    row = api.video_row(job)
    stored = core.unseal(row['payload'])
    assert stored['wallet'] == intent()
    assert row['api_format'] == 'videos'
    assert base64.b64decode(stored['wire']['body']) == body
    calls = []
    def upstream(request):
        calls.append(request)
        if request.method == 'POST':
            assert request.url.path == '/v1/videos'
            assert request.read() == body
            assert request.headers['Content-Type'] == content_type
            assert request.headers['X-Community-Signature'] == signature(request.headers, '/v1/videos', body)
            return httpx.Response(200, json={'id': 'video-upstream-id', 'status': 'queued'})
        assert request.url.path == '/v1/videos/video-upstream-id'
        assert 'X-Community-Signature' not in request.headers
        return httpx.Response(200, json={'id': 'video-upstream-id', 'status': 'in_progress'})
    async def run_worker():
        async with RealAsyncClient(transport=httpx.MockTransport(upstream)) as client:
            claim = 'test-claim'
            with core.db() as connection:
                connection.execute('UPDATE video_jobs SET claim=? WHERE id=?', (claim, job))
            await api.process_video(client, row, claim)
            current = api.video_row(job)
            assert current['status'] == 'generating'
            with core.db() as connection:
                connection.execute('UPDATE video_jobs SET claim=? WHERE id=?', (claim, job))
            await api.process_video(client, current, claim)
    asyncio.run(run_worker())
    repeated = asyncio.run(submit(api.app, path, body, content_type, nonce='b' * 32))
    assert repeated.json()['id'] == job
    assert [request.method for request in calls] == ['POST', 'GET']


@pytest.mark.parametrize('kind', ['image', 'video'])
@pytest.mark.parametrize('enabled', ['true', 'false'])
def test_ordinary_queued_requests_keep_existing_path_and_never_acquire_wallet(monkeypatch, kind, enabled):
    monkeypatch.setenv('COMMUNITY_WALLET_ENABLED', enabled)
    api, core, tasks = load_service(monkeypatch, kind)
    path = '/async-' + ('images' if kind == 'image' else 'videos') + '/v1/tasks'
    headers = {'Authorization': 'Bearer ' + TOKEN, 'Idempotency-Key': 'ordinary-request-01'}
    payload = {'model': kind + '-fixture', 'prompt': 'ordinary request'}
    async def request():
        async with RealAsyncClient(transport=httpx.ASGITransport(api.app), base_url='http://proxy') as client:
            return await client.post(path, headers=headers, json=payload)
    response = asyncio.run(request())
    assert response.status_code == 202, response.text
    job = response.json()['id']
    table = 'jobs' if kind == 'image' else 'video_jobs'
    with core.db() as connection:
        row = connection.execute('SELECT * FROM ' + table + ' WHERE id=?', (job,)).fetchone()
    stored = core.unseal(row['payload'])
    assert stored.get('wallet') is None
    assert stored.get('wire') is None
    if kind == 'video':
        assert row['api_format'] == 'generations'
    calls = []
    def upstream(request):
        calls.append(request)
        assert request.url.path == ('/v1/images/generations' if kind == 'image' else '/v1/video/generations')
        assert not any(key.startswith('x-community-') for key in request.headers)
        assert request.headers['Authorization'] == 'Bearer ' + TOKEN
        assert json.loads(request.read())['model'] == payload['model']
        if kind == 'image':
            return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(PNG).decode()}]})
        return httpx.Response(200, json={'id': 'ordinary-upstream-id', 'status': 'queued'})
    if kind == 'image':
        mock_upstream(monkeypatch, upstream)
        tasks.generate.call_local(job)
        with core.db() as connection:
            result = connection.execute('SELECT status FROM jobs WHERE id=?', (job,)).fetchone()
        assert result['status'] == 'succeeded'
    else:
        async def run_worker():
            async with RealAsyncClient(transport=httpx.MockTransport(upstream)) as client:
                with core.db() as connection:
                    connection.execute('UPDATE video_jobs SET claim=? WHERE id=?', ('ordinary-claim', job))
                await api.process_video(client, row, 'ordinary-claim')
        asyncio.run(run_worker())
        assert api.video_row(job)['status'] == 'generating'
    assert len(calls) == 1
