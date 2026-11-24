"""Capacity regressions against the prepared video service; never call live models."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import shutil

import httpx
import pytest

from test_community_wallet import settings, TOKEN
from test_proxy_integration import load_service, RealAsyncClient


def new_job(api, core, suffix):
    return api.submit_video(core.owner_for(TOKEN), 'capacity-test-' + suffix,
                            {'model': 'video-fixture', 'prompt': 'test'}, TOKEN, '127.0.0.1')


def stopped_job(api, core, suffix, status='save_failed'):
    row = new_job(api, core, suffix)
    with core.db() as c:
        c.execute('UPDATE video_jobs SET status=?,reserved=4096,upstream_id=? WHERE id=?',
                  (status, 'upstream-' + suffix, row['id']))
    return api.video_row(row['id'])


def retry(api, identifier, token=TOKEN):
    async def invoke():
        async with RealAsyncClient(transport=httpx.ASGITransport(api.app), base_url='http://proxy') as client:
            return await client.post('/async-videos/v1/tasks/' + identifier + '/retry-save',
                                     headers={'Authorization': 'Bearer ' + token})
    return asyncio.run(invoke())


def test_failed_downloads_release_capacity_without_repeating_generation(monkeypatch):
    api, core, _ = load_service(monkeypatch, 'video')
    reserve = api.MAX_VIDEO + 1024**2
    monkeypatch.setattr(api, 'VIDEO_QUOTA', reserve * 3)
    paid = []

    def upstream(request):
        if request.method == 'POST':
            paid.append(request)
            return httpx.Response(202, json={'id': 'upstream-' + str(len(paid))})
        if request.url.path.endswith('/content'):
            return httpx.Response(503, json={'error': {'code': 'unavailable'}})
        return httpx.Response(200, json={'status': 'completed'})

    async def run():
        async with RealAsyncClient(transport=httpx.MockTransport(upstream)) as client:
            for index in range(5):
                job = new_job(api, core, str(index))
                for step in range(5):
                    with core.db() as c:
                        c.execute('UPDATE video_jobs SET next_attempt=0 WHERE id=?', (job['id'],))
                    row, claim = api.claim_video()
                    await api.process_video(client, row, claim)
                    if step == 2:
                        assert api.video_row(job['id'])['reserved'] == reserve
                saved = api.video_row(job['id'])
                assert saved['status'] == 'save_failed'
                assert saved['reserved'] == 4096 + len(saved['payload'])
                assert saved['upstream_id'] and saved['payload']
            assert new_job(api, core, 'after-failures')['status'] == 'queued'
    asyncio.run(run())
    assert len(paid) == 5


@pytest.mark.parametrize('status', [404, 410])
def test_missing_upstream_content_stops_download_and_releases_reservation(monkeypatch, status):
    api, core, _ = load_service(monkeypatch, 'video')
    row = new_job(api, core, 'gone')
    with core.db() as c:
        c.execute("UPDATE video_jobs SET status='saving',upstream_id='upstream-existing' WHERE id=?", (row['id'],))
    calls = []
    def upstream(request):
        calls.append(request.method)
        return httpx.Response(status, json={'error': {'code': 'artifact_gone'}})
    async def run():
        async with RealAsyncClient(transport=httpx.MockTransport(upstream)) as client:
            claimed, claim = api.claim_video()
            await api.process_video(client, claimed, claim)
    asyncio.run(run())
    current = api.video_row(row['id'])
    assert current['status'] == 'save_failed' and current['attempts'] == 1
    assert current['error'] == 'video_content_gone'
    assert current['reserved'] == 4096 + len(row['payload'])
    assert api.claim_video() is None
    assert calls == ['GET']
    assert retry(api, row['id']).status_code == 202
    content = b'\x00\x00\x00\x18ftypisom' + b'video-fixture'
    def available(request):
        calls.append(request.method)
        return httpx.Response(200, content=content, headers={'content-type': 'video/mp4'})
    async def save_existing():
        async with RealAsyncClient(transport=httpx.MockTransport(available)) as client:
            claimed, claim = api.claim_video()
            await api.process_video(client, claimed, claim)
    asyncio.run(save_existing())
    current = api.video_row(row['id'])
    assert current['status'] == 'succeeded' and current['payload'] is None
    assert current['reserved'] == len(content) + 4096
    assert api.video_path(row['id']).read_bytes() == content
    assert calls == ['GET', 'GET']


def test_maintenance_repairs_old_reservations_and_preserves_files_and_payload(monkeypatch):
    api, core, _ = load_service(monkeypatch, 'video')
    rows = [stopped_job(api, core, 'stopped-' + status, status) for status in ('save_failed', 'indeterminate')]
    active = new_job(api, core, 'active')
    for row in rows:
        api.video_path(row['id']).write_bytes(b'valid-retained-file')
        api.video_path(row['id']).with_suffix('.part').write_bytes(b'partial')
        with core.db() as c:
            c.execute('UPDATE video_jobs SET reserved=? WHERE id=?', (api.MAX_VIDEO + 1024**2, row['id']))
    for _ in range(2):
        api.cleanup_videos()
        for row in rows:
            current = api.video_row(row['id'])
            assert current['reserved'] == 4096 + len(row['payload']) + len(b'valid-retained-filepartial')
            assert current['payload'] == row['payload']
            assert current['status'] == row['status']
            assert api.video_path(row['id']).read_bytes() == b'valid-retained-file'
            assert api.video_path(row['id']).with_suffix('.part').read_bytes() == b'partial'
        assert api.video_row(active['id']) == active


def test_concurrent_retry_reserves_capacity_once_and_does_not_submit_models(monkeypatch):
    api, core, _ = load_service(monkeypatch, 'video')
    rows = [stopped_job(api, core, str(index)) for index in range(2)]
    reserve = api.MAX_VIDEO + 1024**2
    monkeypatch.setattr(api, 'VIDEO_QUOTA', reserve + 4096)
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda row: retry(api, row['id']), rows))
    assert sorted(r.status_code for r in responses) == [202, 503]
    statuses = [api.video_row(row['id']) for row in rows]
    assert sorted(row['status'] for row in statuses) == ['save_failed', 'saving']
    assert sum(row['reserved'] for row in statuses) == reserve + 4096
    saving = next(row for row in statuses if row['status'] == 'saving')
    assert retry(api, saving['id']).status_code == 409
    assert api.video_row(saving['id']) == saving
    assert retry(api, saving['id'], 'different-owner').status_code == 404


def test_large_request_payload_is_reserved_with_the_video_on_admission_and_retry(monkeypatch):
    api, core, _ = load_service(monkeypatch, 'video')
    payload = {'model': 'video-fixture', 'prompt': 'test', 'reference': 'a' * (3 * 1024**2)}
    monkeypatch.setattr(api, 'VIDEO_QUOTA', 4 * 1024**2)
    with pytest.raises(core.AdmissionError, match='video_storage_capacity_reached'):
        api.submit_video(core.owner_for(TOKEN), 'large-admission', payload, TOKEN, '127.0.0.1')
    with core.db() as c:
        assert c.execute('SELECT count(*) FROM video_jobs').fetchone()[0] == 0
    monkeypatch.setattr(api, 'VIDEO_QUOTA', 10 * 1024**2)
    row = api.submit_video(core.owner_for(TOKEN), 'large-admission', payload, TOKEN, '127.0.0.1')
    assert row['reserved'] >= api.MAX_VIDEO + len(row['payload']) + 4096
    with core.db() as c:
        c.execute("UPDATE video_jobs SET status='save_failed' WHERE id=?", (row['id'],))
    api.cleanup_videos()
    before = api.video_row(row['id'])
    monkeypatch.setattr(api, 'VIDEO_QUOTA', before['reserved'] + api.MAX_VIDEO - 1)
    assert retry(api, row['id']).status_code == 503
    assert api.video_row(row['id']) == before
    monkeypatch.setattr(api, 'VIDEO_QUOTA', before['reserved'] + api.MAX_VIDEO)
    assert retry(api, row['id']).status_code == 202
    assert api.video_row(row['id'])['reserved'] >= api.MAX_VIDEO + len(row['payload']) + 4096


@pytest.mark.parametrize('reason', ['capacity', 'disk', 'expired', 'claimed', 'state-changed'])
def test_retry_rejection_keeps_the_original_job(monkeypatch, reason):
    api, core, _ = load_service(monkeypatch, 'video')
    row = stopped_job(api, core, reason)
    status = 503
    if reason == 'capacity':
        monkeypatch.setattr(api, 'VIDEO_QUOTA', 4096)
    elif reason == 'disk':
        monkeypatch.setattr(api.shutil, 'disk_usage', lambda _: shutil._ntuple_diskusage(1, 1, 0))
    else:
        with core.db() as c:
            if reason == 'expired':
                c.execute('UPDATE video_jobs SET expires=0 WHERE id=?', (row['id'],))
                status = 410
            elif reason == 'claimed':
                c.execute("UPDATE video_jobs SET claim='busy' WHERE id=?", (row['id'],))
                status = 409
            else:
                c.execute("UPDATE video_jobs SET status='succeeded' WHERE id=?", (row['id'],))
                status = 409
        if reason == 'state-changed':
            async def stale_owned(*_):
                return row
            monkeypatch.setattr(api, 'owned_video', stale_owned)
    before = api.video_row(row['id'])
    assert retry(api, row['id']).status_code == status
    assert api.video_row(row['id']) == before


def test_startup_releases_legacy_failed_reservations_before_workers(monkeypatch):
    api, core, _ = load_service(monkeypatch, 'video')
    row = stopped_job(api, core, 'legacy')
    with core.db() as c:
        c.execute('UPDATE video_jobs SET reserved=? WHERE id=?', (api.MAX_VIDEO + 1024**2, row['id']))
    async def start():
        async with api.lifespan(api.app):
            assert api.video_row(row['id'])['reserved'] == 4096 + len(row['payload'])
    asyncio.run(start())
