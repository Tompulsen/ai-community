"""Consolidate and release the existing community service without data migration."""
import copy
import datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import sys
import tempfile
import time

COMPOSE = Path('/opt/ai-community-next/deploy/compose.json')
VHOST = Path('/opt/1panel/www/conf.d/www.zhangyuapi.com.conf')
ARCHIVE = Path('/opt/1panel/www/sites/zaiduyu.top/community-assets')
NGINX_ARCHIVE = '/www/sites/zaiduyu.top/community-assets'
HOST = 'www.zhangyuapi.com'
PROXY = 'ZY-openresty'
WEB = 'ai-community-web-1'
WORKER_FLAGS = ('DISABLE_LOTTERY_WORKER', 'DISABLE_MEDIA_WORKER')


def execute(args, timeout=60, data=None):
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{args[0]} {args[1]} failed (exit {result.returncode})')
    return result.stdout


def inspect(names):
    return {x['Name'].lstrip('/'): x for x in json.loads(execute(['docker', 'inspect', *names]))}


def environment(item):
    return dict(value.split('=', 1) for value in item['Config']['Env'] if '=' in value)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_private(path, data):
    atomic_write(path, data, 0o600)


def atomic_write(path, data, mode=None):
    target = path.resolve()
    permissions = mode if mode is not None else target.stat().st_mode & 0o777
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as pending:
        pending.write(data)
        pending.flush()
        os.fsync(pending.fileno())
    os.chmod(pending.name, permissions)
    os.replace(pending.name, target)


def definition(original, image):
    result = copy.deepcopy(original)
    service = copy.deepcopy(result['services'].get('unified_web', result['services']['web']))
    service.pop('container_name', None)
    service['image'] = image
    service['pull_policy'] = 'never'
    service['ports'] = copy.deepcopy(result['services']['web']['ports'])
    service['stop_grace_period'] = '10m'
    for key in WORKER_FLAGS:
        service['environment'].pop(key, None)
    service['labels'] = {k: v for k, v in service.get('labels', {}).items()
                         if not k.startswith(('community.', 'org.opencontainers.image.'))}
    result['services']['web'] = service
    result['services'].pop('unified_web', None)
    return result


def proxy_config(original):
    markers = ['    # Preserve previously loaded hashed frontend assets;',
               '    # Current assets first; archived versions contain static files only.']
    starts = [original.index(marker) for marker in markers if marker in original]
    assert len(starts) == 1, 'Unrecognized asset proxy configuration'
    start = starts[0]
    end = original.index('    location / {', start)
    block = f'''    # Current assets first; archived versions contain static files only.
    location ^~ /assets/ {{
        limit_except GET HEAD {{ deny all; }}
        proxy_pass http://127.0.0.1:13000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_intercept_errors on;
        error_page 404 = @community_archived_assets;
    }}
    location @community_archived_assets {{
        internal;
        root {NGINX_ARCHIVE};
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable";
        add_header X-Content-Type-Options nosniff always;
        add_header X-Community-Node "vm-20261107" always;
    }}

'''
    result = (original[:start] + block + original[end:]).replace(
        'proxy_pass http://127.0.0.1:33000;', 'proxy_pass http://127.0.0.1:13000;')
    assert ':33000' not in result and ':23000' not in result
    assert result.count('proxy_pass http://127.0.0.1:13000;') == 2
    return result


def merge_assets(source, archive):
    files = {}
    for item in source.rglob('*'):
        assert not item.is_symlink(), 'Asset symlinks are not allowed'
        if not item.is_file():
            continue
        relative = item.relative_to(source)
        assert not any(part.startswith('.') for part in relative.parts), 'Hidden assets are not allowed'
        body = item.read_bytes()
        target = archive / relative
        assert not any(p.is_symlink() for p in (target, *target.parents)), 'Archive symlinks are not allowed'
        if target.exists():
            assert target.is_file() and digest(target.read_bytes()) == digest(body), f'Asset conflict: {relative}'
        else:
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as pending:
                pending.write(body)
            os.replace(pending.name, target)
            target.chmod(0o644)
        files['/assets/' + relative.as_posix()] = {'sha256': digest(body), 'bytes': len(body)}
    assert files, 'Empty asset tree'
    return files


def request(path, port=None, method='GET'):
    if port is not None:
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=15)
    else:
        # Cloudflare Origin CA is checked by Cloudflare, not the host CA store.
        connection = http.client.HTTPSConnection('127.0.0.1', context=ssl._create_unverified_context(), timeout=15)
    try:
        connection.request(method, path, headers={'Host': HOST, 'User-Agent': 'Community-Release-Verification/1'})
        response = connection.getresponse()
        return response.status, {k.lower(): v for k, v in response.getheaders()}, response.read()
    finally:
        connection.close()


def probes(port=None):
    paths = {'/healthz': 200, '/discover': 200, '/api/session': 200,
             '/api/new-api/session': 200, '/api/works': 200, '/api/tags': 200,
             '/api/creators': 200, '/api/announcements': 200,
             '/api/notifications': 401, '/api/library': 401, '/api/admin/submissions': 401,
             '/assets/community-release-missing.js': 404}
    results = []
    for path, expected in paths.items():
        status, _, body = request(path, port)
        assert status == expected, f'{path}: HTTP {status}, expected {expected}'
        if path == '/api/session':
            assert json.loads(body).get('user') is None
        if path == '/api/works':
            assert isinstance(json.loads(body).get('items'), list)
        results.append({'path': path, 'status': status})
    return results


def wait_healthy(name):
    for _ in range(45):
        current = inspect([name])[name]
        assert current['State']['Running'], 'Application exited'
        if current['State'].get('Health', {}).get('Status') == 'healthy':
            return current
        time.sleep(1)
    raise RuntimeError('Application health check timed out')


def graceful_stop(name):
    execute(['docker', 'kill', '--signal', 'SIGTERM', name])
    # A timed-out client must never escalate to SIGKILL on production work.
    code = execute(['docker', 'wait', name], timeout=620).decode().strip()
    assert code == '0', f'{name} did not exit gracefully (exit {code})'


def main(image):
    assert os.geteuid() == 0 and COMPOSE.is_file() and VHOST.is_file()
    assert re.fullmatch(r'ghcr\.io/tompulsen/ai-community@sha256:[a-f0-9]{64}', image), 'Use a published digest'
    lock = os.open('/opt/ai-community-next/deploy/.release.lock', os.O_CREAT | os.O_RDWR, 0o600)
    import fcntl
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    before = inspect(execute(['docker', 'ps', '-a', '--format', '{{.Names}}']).decode().splitlines())
    current_name = next((n for n, x in before.items() if n.startswith('ai-community-unified-login-') and x['State']['Running']), WEB)
    current = before[current_name]
    assert before[WEB]['State']['Running'] and current['State'].get('Health', {}).get('Status') == 'healthy'
    target = json.loads(execute(['docker', 'image', 'inspect', image]))[0]
    revision = target['Config'].get('Labels', {}).get('org.opencontainers.image.revision', '')
    assert re.fullmatch('[a-f0-9]{40}', revision), 'Image revision label missing'
    assert target['Config']['Labels'].get('org.opencontainers.image.source', '').lower().rstrip('/') == 'https://github.com/tompulsen/ai-community'
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = Path('/opt/ai-community-next/releases') / ('single-web-' + stamp)
    release.mkdir(mode=0o700)
    compose_bytes, proxy_bytes = COMPOSE.read_bytes(), VHOST.read_bytes()
    original = json.loads(compose_bytes)
    desired = definition(original, image)
    expected_env = environment(current)
    previous_image = json.loads(execute(['docker', 'image', 'inspect', current['Image']]))[0]
    defaults = dict(v.split('=', 1) for v in previous_image['Config'].get('Env', []) if '=' in v)
    desired_env = desired['services']['web']['environment']
    runtime_overrides = {k: v for k, v in expected_env.items() if k not in WORKER_FLAGS and
                         (k in desired_env or defaults.get(k) != v)}
    for key, value in expected_env.items():
        if key in WORKER_FLAGS:
            continue
        if key in desired_env:
            assert str(desired_env[key]) == value, f'Runtime configuration drift: {key}'
    desired_env.update(runtime_overrides)
    if 'TRUSTED_PROXY_CIDRS' not in desired_env:
        network = current['NetworkSettings']['Networks'].get(current['HostConfig']['NetworkMode'], {})
        gateway = network.get('Gateway')
        desired_env['TRUSTED_PROXY_CIDRS'] = expected_env.get('TRUSTED_PROXY_CIDRS', 'loopback' + (',' + gateway if gateway else ''))
    runtime_overrides['TRUSTED_PROXY_CIDRS'] = desired_env['TRUSTED_PROXY_CIDRS']
    original_configs = {m['Source']: digest(Path(m['Source'], 'default.yml').read_bytes())
                        for m in current['Mounts'] if m['Destination'] == '/app/.config'}
    rollback = copy.deepcopy(original)
    for service, name in [('web', WEB), ('unified_web', current_name)]:
        if service in rollback['services']:
            rollback['services'][service]['image'] = before[name]['Image']
            rollback['services'][service]['pull_policy'] = 'never'
    for name, body in [('compose.before.json', compose_bytes), ('proxy.before.conf', proxy_bytes),
                       ('containers.before.json', json.dumps(before).encode()),
                       ('rollback.compose.json', json.dumps(rollback, indent=2).encode()),
                       ('compose.next.json', json.dumps(desired, indent=2).encode())]:
        write_private(release / name, body)
    next_proxy = proxy_config(proxy_bytes.decode())
    (release / 'proxy.next.conf').write_text(next_proxy)
    report = {'revision': revision, 'image': image, 'release': str(release), 'phase': 'prepare'}
    candidate = 'ai-community-check-' + stamp.lower()
    candidate_created = False
    cutover = False
    retired = []
    def compose(*args, file=COMPOSE, timeout=60):
        return execute(['docker', 'compose', '--project-directory', str(COMPOSE.parent),
                        '-p', 'ai-community', '-f', str(file), *args], timeout)
    def save_report():
        write_private(release / 'result.json', json.dumps(report, indent=2).encode())
    try:
        assets = {}
        versions = {}
        sources = [n for n, x in before.items() if x['State']['Running'] and
                   (n in [WEB, current_name] or n.startswith('ai-community-legacy-display-'))]
        for name in sources:
            staging = release / ('assets-' + name)
            staging.mkdir()
            execute(['docker', 'cp', name + ':/app/dist/assets/.', str(staging)])
            entries = merge_assets(staging, ARCHIVE / 'assets')
            assets.update(entries)
            versions[name] = list(entries)
        write_private(release / 'asset-manifest.json', json.dumps({'files': assets, 'versions': versions}, indent=2).encode())
        report['archiveFiles'] = len(assets)
        report['archiveBytes'] = sum(x['bytes'] for x in assets.values())
        # Validate the vhost before changing the active on-disk configuration.
        check = ARCHIVE / 'nginx-check.conf'
        check.write_text('events {}\nhttp {\ninclude /usr/local/openresty/nginx/conf/mime.types;\n' + next_proxy + '\n}\n')
        try:
            execute(['docker', 'exec', PROXY, 'nginx', '-t', '-c', NGINX_ARCHIVE + '/nginx-check.conf'])
        finally:
            check.unlink(missing_ok=True)
        compose('config', '--quiet', file=release / 'compose.next.json')
        print(json.dumps({'phase': 'candidate', 'revision': revision, 'archiveFiles': len(assets)}), flush=True)
        compose('run', '--no-deps', '--detach', '--name', candidate, '--publish', '127.0.0.1:43000:3000',
                '-e', 'DISABLE_MEDIA_WORKER=1', '-e', 'DISABLE_LOTTERY_WORKER=1', 'web', file=release / 'compose.next.json')
        candidate_created = True
        wait_healthy(candidate)
        report['candidateChecks'] = probes(43000)
        assert digest(request('/discover', 43000)[2]) == digest(execute(['docker', 'exec', candidate, 'cat', '/app/dist/index.html']))
        staging = release / 'assets-candidate'
        staging.mkdir()
        execute(['docker', 'cp', candidate + ':/app/dist/assets/.', str(staging)])
        candidate_assets = merge_assets(staging, ARCHIVE / 'assets')
        for url, record in candidate_assets.items():
            status, _, body = request(url, 43000)
            assert status == 200 and digest(body) == record['sha256'], f'Candidate asset failed: {url}'
        assets.update(candidate_assets)
        versions['candidate-' + revision] = list(candidate_assets)
        write_private(release / 'asset-manifest.json', json.dumps({'files': assets, 'versions': versions}, indent=2).encode())
        report['archiveFiles'] = len(assets)
        report['archiveBytes'] = sum(x['bytes'] for x in assets.values())
        execute(['docker', 'stop', '--time', '30', candidate], 40)
        execute(['docker', 'rm', candidate])
        candidate_created = False
        assert COMPOSE.read_bytes() == compose_bytes and VHOST.read_bytes() == proxy_bytes, 'Deployment changed during preparation'
        fresh = inspect(list({WEB, current_name}))
        assert all(fresh[n]['Id'] == before[n]['Id'] and fresh[n]['Image'] == before[n]['Image']
                   for n in fresh), 'Application changed during preparation'
        cutover = True
        report['phase'] = 'worker-handoff'
        save_report()
        print(json.dumps({'phase': 'worker-handoff', 'graceSeconds': 600}), flush=True)
        # The old worker must exit before any production worker starts.
        graceful_stop(WEB)
        assert not inspect([WEB])[WEB]['State']['Running']
        assert inspect([WEB])[WEB]['State']['ExitCode'] == 0, 'Previous worker did not exit gracefully'
        report['phase'] = 'application-switch'
        atomic_write(COMPOSE, (release / 'compose.next.json').read_bytes())
        compose('up', '--detach', '--no-deps', '--force-recreate', 'web', timeout=660)
        deployed = wait_healthy(WEB)
        assert deployed['Image'] == target['Id']
        actual_env = environment(deployed)
        for key, value in runtime_overrides.items():
            assert actual_env.get(key) == value, f'Runtime environment changed: {key}'
        assert all(actual_env.get(key) != '1' for key in WORKER_FLAGS)
        mount_key = lambda x: sorted((m['Type'], m['Source'], m['Destination'], m['RW']) for m in x['Mounts'])
        assert mount_key(deployed) == mount_key(current)
        assert sorted(deployed['NetworkSettings']['Networks']) == sorted(current['NetworkSettings']['Networks'])
        assert deployed['HostConfig']['PortBindings'] == before[WEB]['HostConfig']['PortBindings']
        report['applicationChecks'] = probes(13000)
        atomic_write(VHOST, next_proxy.encode())
        execute(['docker', 'exec', PROXY, 'nginx', '-t'])
        execute(['docker', 'exec', PROXY, 'nginx', '-s', 'reload'])
        report['phase'] = 'verify'
        print(json.dumps({'phase': 'verify', 'assetCount': len(assets)}), flush=True)
        report['proxyChecks'] = probes()
        assert digest(request('/discover')[2]) == digest(execute(['docker', 'exec', WEB, 'cat', '/app/dist/index.html']))
        for url, record in assets.items():
            status, headers, body = request(url)
            assert status == 200 and digest(body) == record['sha256'], f'Archived asset failed: {url}'
            assert headers.get('x-content-type-options', '').lower() == 'nosniff', f'Missing nosniff: {url}'
            if url.endswith('.js'):
                assert 'javascript' in headers.get('content-type', ''), f'Incorrect JavaScript MIME: {url}'
        sample = next(url for url in assets if url.endswith('.js'))
        status, headers, body = request(sample, method='HEAD')
        assert status == 200 and not body and int(headers['content-length']) == assets[sample]['bytes']
        for name in sources:
            if name != WEB:
                graceful_stop(name)
                retired.append(name)
        after = inspect(list(before))
        for name, item in before.items():
            if name in sources:
                continue
            assert after[name]['Id'] == item['Id'] and after[name]['State']['StartedAt'] == item['State']['StartedAt'], f'Protected service changed: {name}'
        assert [n for n, x in after.items() if n.startswith('ai-community-') and x['State']['Running']] == [n for n, x in after.items() if n in [WEB, 'ai-community-db-1', 'ai-community-redis-1', 'ai-community-documents-1'] and x['State']['Running']]
        assert all(digest(Path(p, 'default.yml').read_bytes()) == h for p, h in original_configs.items())
        report.update({'phase': 'complete', 'retiredContainers': retired, 'verifiedAssetFiles': len(assets),
                       'protectedContainersUnchanged': True, 'configurationUnchanged': True,
                       'workerContainer': WEB, 'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
        print(json.dumps(report, indent=2), flush=True)
    except BaseException as error:
        failed_phase = report['phase']
        report.update({'phase': 'failed', 'failedPhase': failed_phase, 'error': str(error)})
        if cutover:
            try:
                names = execute(['docker', 'ps', '-a', '--format', '{{.Names}}']).decode().splitlines()
                if WEB in names and inspect([WEB])[WEB]['State']['Running']:
                    if failed_phase == 'worker-handoff':
                        raise RuntimeError('Previous worker is still draining; no forced termination was attempted')
                    graceful_stop(WEB)
                atomic_write(COMPOSE, (release / 'rollback.compose.json').read_bytes())
                services = ['web'] + (['unified_web'] if 'unified_web' in rollback['services'] else [])
                compose('up', '--detach', '--no-deps', '--force-recreate', *services, timeout=660)
                for name in retired:
                    if name.startswith('ai-community-legacy-display-'):
                        execute(['docker', 'start', name])
                wait_healthy(WEB)
                if current_name != WEB:
                    wait_healthy(current_name)
                atomic_write(VHOST, proxy_bytes)
                execute(['docker', 'exec', PROXY, 'nginx', '-t'])
                execute(['docker', 'exec', PROXY, 'nginx', '-s', 'reload'])
                report['rollbackChecks'] = probes()
                report['rollback'] = 'restored'
            except BaseException as rollback_error:
                report['rollback'] = str(rollback_error)
        raise
    finally:
        try:
            if candidate_created:
                execute(['docker', 'stop', '--time', '30', candidate], 40)
                execute(['docker', 'rm', candidate])
        except BaseException as cleanup_error:
            report['cleanupError'] = str(cleanup_error)
        finally:
            try:
                save_report()
            finally:
                os.close(lock)


if __name__ == '__main__':
    assert len(sys.argv) == 2, 'Usage: python3 release.py ghcr.io/tompulsen/ai-community@sha256:<digest>'
    main(sys.argv[1])
