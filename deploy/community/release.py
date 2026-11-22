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
VHOST = Path('/opt/1panel/www/conf.d/zhangyu-community.conf')
PROXY_ROOT = Path('/opt/1panel/www/sites/zhangyu-community/proxy/root.conf')
PROXY_INCLUDE = 'include /www/sites/zhangyu-community/proxy/*.conf;'
ARCHIVE = Path('/opt/1panel/www/sites/zaiduyu.top/community-assets')
NGINX_ARCHIVE = '/www/sites/zaiduyu.top/community-assets'
HOST = 'www.zhangyuapi.com'
PROXY = 'ZY-openresty'
WEB = 'ai-community-web-1'
WORKER_FLAGS = ('DISABLE_LOTTERY_WORKER', 'DISABLE_MEDIA_WORKER')
REQUEST_DRAIN_SECONDS = 720


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


def proxy_config(original, port=13000):
    assert port in (13000, 43000), 'Unrecognized application port'
    if PROXY_INCLUDE in original:
        assert original.count(PROXY_INCLUDE) == 1, 'Unexpected proxy includes'
        assert sorted(PROXY_ROOT.parent.iterdir()) == [PROXY_ROOT] and not PROXY_ROOT.is_symlink(), \
            'Unrecognized proxy fragments'
        root = PROXY_ROOT.read_text()
        expected = ['http://127.0.0.1:13000']
        assert re.findall(r'proxy_pass\s+([^;]+);', original) == expected, 'Unrecognized asset upstream'
        assert re.findall(r'proxy_pass\s+([^;]+);', root) == expected, 'Unrecognized root upstream'
        upstream = 'proxy_pass http://127.0.0.1:13000;'
        assert original.count(upstream) == root.count(upstream) == 1, 'Unrecognized proxy syntax'
        assert root.count('location ^~ / {') == 1, 'Unrecognized root proxy location'
        assert '    # Current assets first; archived versions contain static files only.' in original, \
            'Unrecognized asset proxy configuration'
        if port == 13000:
            return original
        return original.replace(PROXY_INCLUDE, root.rstrip()).replace(upstream, 'proxy_pass http://127.0.0.1:43000;')
    markers = ['    # Preserve previously loaded hashed frontend assets;',
               '    # Current assets first; archived versions contain static files only.']
    starts = [original.index(marker) for marker in markers if marker in original]
    assert len(starts) == 1, 'Unrecognized asset proxy configuration'
    start = starts[0]
    end = original.index('    location / {', start)
    block = f'''    # Current assets first; archived versions contain static files only.
    location ^~ /assets/ {{
        limit_except GET HEAD {{ deny all; }}
        proxy_pass http://127.0.0.1:{port};
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
    result = re.sub(r'proxy_pass http://127\.0\.0\.1:(?:13000|33000|43000);',
                    f'proxy_pass http://127.0.0.1:{port};', original[:start] + block + original[end:])
    assert ':33000' not in result and ':23000' not in result
    assert result.count(f'proxy_pass http://127.0.0.1:{port};') == 2
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


def request(path, port=None, method='GET', timeout=15):
    if port is not None:
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
    else:
        # Cloudflare Origin CA is checked by Cloudflare, not the host CA store.
        connection = http.client.HTTPSConnection('127.0.0.1', context=ssl._create_unverified_context(), timeout=timeout)
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


def wait_proxy_html(name):
    expected = digest(execute(['docker', 'exec', name, 'cat', '/app/dist/index.html']))
    deadline = time.monotonic() + 15
    last_error = 'No response was received'
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError(f'Proxy did not serve {name} HTML within 15 seconds: {last_error}')
        try:
            status, _, body = request('/discover', timeout=min(5, remaining))
            actual = digest(body)
            if status == 200 and actual == expected:
                return
            last_error = f'HTTP {status}, HTML SHA256 {actual}, expected {expected}'
        except Exception as error:
            last_error = f'{type(error).__name__}: {error}'
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError(f'Proxy did not serve {name} HTML within 15 seconds: {last_error}')
        time.sleep(min(0.25, remaining))


def graceful_stop(name):
    execute(['docker', 'kill', '--signal', 'SIGTERM', name])
    # A timed-out client must never escalate to SIGKILL on production work.
    code = execute(['docker', 'wait', name], timeout=620).decode().strip()
    assert code == '0', f'{name} did not exit gracefully (exit {code})'


def proxy_workers():
    lines = execute(['docker', 'top', PROXY, '-eo', 'pid,args']).decode().splitlines()
    return {line.split(None, 1)[0] for line in lines[1:] if 'nginx: worker process' in line}


def reload_proxy(data):
    workers = proxy_workers()
    assert workers, 'Could not identify the current proxy workers'
    atomic_write(VHOST, data)
    execute(['docker', 'exec', PROXY, 'nginx', '-t'])
    execute(['docker', 'exec', PROXY, 'nginx', '-s', 'reload'])
    return workers


def wait_proxy_workers(workers, guard=None):
    deadline = time.monotonic() + 620
    while workers & proxy_workers():
        if guard:
            guard()
        if time.monotonic() >= deadline:
            raise RuntimeError('Previous proxy workers are still draining; their application was preserved')
        time.sleep(1)


def wait_request_drain(name, guard=None):
    # Legacy images have no task counter; this is an operational grace, not proof of idleness.
    print(json.dumps({'phase': 'request-drain', 'container': name,
                      'seconds': REQUEST_DRAIN_SECONDS}), flush=True)
    deadline = time.monotonic() + REQUEST_DRAIN_SECONDS
    while True:
        if guard:
            guard()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        time.sleep(min(1, remaining))


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
    candidate_proxy = proxy_config(proxy_bytes.decode(), 43000)
    (release / 'proxy.next.conf').write_text(next_proxy)
    report = {'revision': revision, 'image': image, 'release': str(release), 'phase': 'prepare'}
    candidate = 'ai-community-check-' + stamp.lower()
    candidate_created = False
    cutover = False
    handoff_started = False
    stopping = set()
    retired = []
    def compose(*args, file=COMPOSE, timeout=60):
        return execute(['docker', 'compose', '--project-directory', str(COMPOSE.parent),
                        '-p', 'ai-community', '-f', str(file), *args], timeout)
    def save_report():
        write_private(release / 'result.json', json.dumps(report, indent=2).encode())
    def check_candidate():
        status, _, _ = request('/healthz', 43000, timeout=5)
        assert status == 200, 'Candidate health check failed during worker handoff'
    def stop_application(name):
        assert name not in stopping, f'{name} is still draining; no second signal was sent'
        stopping.add(name)
        graceful_stop(name)
        stopping.remove(name)
    def cleanup_candidate(workers):
        nonlocal candidate_created
        wait_proxy_workers(workers)
        if inspect([candidate])[candidate]['State']['Running']:
            wait_request_drain(candidate)
            stop_application(candidate)
        execute(['docker', 'rm', candidate])
        candidate_created = False
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
        try:
            for config in (next_proxy, candidate_proxy):
                check.write_text("events {}\nhttp {\nlog_format main '$remote_addr';\n"
                                 "limit_conn_zone $binary_remote_addr zone=perip:10m;\n"
                                 "limit_conn_zone $server_name zone=perserver:10m;\n"
                                 'include /usr/local/openresty/nginx/conf/mime.types;\n' + config + '\n}\n')
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
        assert COMPOSE.read_bytes() == compose_bytes and VHOST.read_bytes() == proxy_bytes, 'Deployment changed during preparation'
        fresh = inspect(list({WEB, current_name}))
        assert all(fresh[n]['Id'] == before[n]['Id'] and fresh[n]['Image'] == before[n]['Image']
                   for n in fresh), 'Application changed during preparation'
        cutover = True
        report['phase'] = 'candidate-switch'
        save_report()
        print(json.dumps({'phase': 'candidate-switch', 'port': 43000}), flush=True)
        previous_workers = reload_proxy(candidate_proxy.encode())
        report['candidateProxyChecks'] = probes()
        wait_proxy_html(candidate)
        report['phase'] = 'worker-handoff'
        save_report()
        print(json.dumps({'phase': 'worker-handoff', 'graceSeconds': 600}), flush=True)
        wait_proxy_workers(previous_workers, guard=check_candidate)
        wait_request_drain(WEB, guard=check_candidate)
        check_candidate()
        # The old worker exits while the candidate continues serving requests.
        handoff_started = True
        stop_application(WEB)
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
        candidate_workers = reload_proxy(next_proxy.encode())
        report['phase'] = 'verify'
        print(json.dumps({'phase': 'verify', 'assetCount': len(assets)}), flush=True)
        report['proxyChecks'] = probes()
        wait_proxy_html(WEB)
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
                stop_application(name)
                retired.append(name)
        after = inspect(list(before))
        for name, item in before.items():
            if name in sources:
                continue
            assert after[name]['Id'] == item['Id'] and after[name]['State']['StartedAt'] == item['State']['StartedAt'], f'Protected service changed: {name}'
        assert [n for n, x in after.items() if n.startswith('ai-community-') and x['State']['Running']] == [n for n, x in after.items() if n in [WEB, 'ai-community-db-1', 'ai-community-redis-1', 'ai-community-documents-1'] and x['State']['Running']]
        assert all(digest(Path(p, 'default.yml').read_bytes()) == h for p, h in original_configs.items())
        try:
            cleanup_candidate(candidate_workers)
        except BaseException as cleanup_error:
            report['cleanupError'] = str(cleanup_error)
            report['retainedCandidate'] = candidate
        report.update({'phase': 'complete', 'retiredContainers': retired, 'verifiedAssetFiles': len(assets),
                       'protectedContainersUnchanged': True, 'configurationUnchanged': True,
                       'workerContainer': WEB, 'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
        print(json.dumps(report, indent=2), flush=True)
    except BaseException as error:
        failed_phase = report['phase']
        report.update({'phase': 'failed', 'failedPhase': failed_phase, 'error': str(error)})
        save_report()
        if cutover:
            try:
                if handoff_started:
                    names = execute(['docker', 'ps', '-a', '--format', '{{.Names}}']).decode().splitlines()
                    candidate_running = candidate_created and candidate in names and inspect([candidate])[candidate]['State']['Running']
                    if candidate_running:
                        previous_workers = reload_proxy(candidate_proxy.encode())
                        report['fallbackChecks'] = probes()
                        wait_proxy_workers(previous_workers)
                    else:
                        report['candidateUnavailable'] = True
                        if WEB in names and inspect([WEB])[WEB]['State']['Running']:
                            wait_healthy(WEB)
                            report['preservedWebChecks'] = probes(13000)
                            reload_proxy(next_proxy.encode())
                            report['preservedProxyChecks'] = probes()
                            raise RuntimeError('Candidate unavailable; verified production web was preserved without destructive rollback')
                    for name in {WEB, current_name}:
                        assert name not in stopping or name not in names or not inspect([name])[name]['State']['Running'], \
                            f'{name}: Previous worker is still draining; no forced termination was attempted'
                    for name in dict.fromkeys([WEB, current_name]):
                        if name in names and inspect([name])[name]['State']['Running']:
                            if name == WEB:
                                wait_request_drain(WEB)
                            stop_application(name)
                    atomic_write(COMPOSE, (release / 'rollback.compose.json').read_bytes())
                    services = ['web'] + (['unified_web'] if 'unified_web' in rollback['services'] else [])
                    compose('up', '--detach', '--no-deps', '--force-recreate', *services, timeout=660)
                    for name in retired:
                        if name.startswith('ai-community-legacy-display-'):
                            execute(['docker', 'start', name])
                    wait_healthy(WEB)
                    if current_name != WEB:
                        wait_healthy(current_name)
                candidate_workers = reload_proxy(proxy_bytes)
                report['rollbackChecks'] = probes()
                report['rollback'] = 'restored'
                save_report()
                if candidate_created and candidate in execute(['docker', 'ps', '-a', '--format', '{{.Names}}']).decode().splitlines():
                    try:
                        cleanup_candidate(candidate_workers)
                    except BaseException as cleanup_error:
                        report['cleanupError'] = str(cleanup_error)
                        report['retainedCandidate'] = candidate
                else:
                    candidate_created = False
            except BaseException as rollback_error:
                report['rollback'] = str(rollback_error)
                report['retainedCandidate'] = candidate
        raise
    finally:
        try:
            if candidate_created and not cutover:
                stop_application(candidate)
                execute(['docker', 'rm', candidate])
            elif candidate_created:
                report['retainedCandidate'] = candidate
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
