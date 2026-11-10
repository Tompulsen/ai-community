#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Deploy this repository's two verified images on the community server.

Run after GitHub main and both revision-tagged images have been verified.
Only the community web/studio and New API studio OAuth origin are changed.
"""
import fcntl
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import yaml

os.umask(0o077)
SHA = sys.argv[1]
assert len(SHA) == 40 and all(c in '0123456789abcdef' for c in SHA)
SOURCE = Path('/opt/community-remix-20261108/ai-community')
COMPOSE = Path('/opt/ai-community/deploy/compose.yml')
ACCOUNT_SOURCE = Path('/opt/new-api-source')
ACCOUNT_COMPOSE = Path('/opt/1panel/apps/new-api/new-api/docker-compose.yml')
CONFIG = COMPOSE.parent / 'private/config/default.yml'
STUDIO_ENV = COMPOSE.parent / 'private/studio.env'
ORIGIN = 'https://zaiduyu.top'
RECORD = Path('/opt/community-studio-releases') / SHA[:12]
ARCHIVE = Path('/opt/1panel/www/sites/zaiduyu.top/source/ai-community.tar.gz')


def run(args):
    return subprocess.check_output([str(a) for a in args], text=True, stderr=subprocess.PIPE).strip()


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]


def compose(path, project, *args):
    return run(['docker', 'compose', '-p', project, '-f', path, *args])


def environment(container):
    return dict(v.split('=', 1) for v in container['Config']['Env'] if '=' in v)


def mounts(container):
    return sorted((m['Type'], m['Source'], m['Destination']) for m in container['Mounts'])


def containers():
    return {c['Name']: c for c in json.loads(run(['docker', 'inspect', *run(['docker', 'ps', '-aq', '--no-trunc']).split()]))}


def healthy(name):
    deadline = time.monotonic() + 210
    while time.monotonic() < deadline:
        c = inspect(name)
        if c['State'].get('Health', {}).get('Status') == 'healthy':
            return c
        if not c['State']['Running']:
            raise RuntimeError('Container stopped: ' + name)
        time.sleep(3)
    raise RuntimeError('Health timeout: ' + name)


def http(path, body=None):
    request = urllib.request.Request('http://127.0.0.1:13000' + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Host': 'zaiduyu.top', 'Origin': ORIGIN, 'Content-Type': 'application/json'})
    try:
        response = urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    return response.status, {key.lower(): value for key, value in response.headers.items()}, response.read()


locks = []
for lockpath in ['/opt/octopus-chat/update.lock', '/opt/ai-community/.deploy.lock']:
    lock = open(lockpath, 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    locks.append(lock)

assert not run(['git', '-C', SOURCE, 'status', '--porcelain']), 'Dirty community source'
run(['git', '-C', SOURCE, 'pull', '--ff-only', '--quiet', 'origin', 'main'])
assert run(['git', '-C', SOURCE, 'rev-parse', 'HEAD']) == SHA, 'Main changed; verify its images first'
assert run(['git', '-C', SOURCE, 'rev-parse', 'origin/main']) == SHA
before = containers()
web_before, account_before, chat = (before['/' + n] for n in ['ai-community-web-1', 'ZY-newapi', 'ZY-chat'])
assert before['/ZY-image-playground']['State']['Running'], 'Required image site must be running'
for name in ['ai-community-web-1', 'ZY-newapi', 'ZY-chat']:
    assert before['/' + name]['State'].get('Health', {}).get('Status') == 'healthy', name

# This is an account configuration change, not a New API source upgrade.
# Keep its deployed image and verify that revision belongs to the published main history.
assert not run(['git', '-C', ACCOUNT_SOURCE, 'status', '--porcelain']), 'Dirty account source'
run(['git', '-C', ACCOUNT_SOURCE, 'fetch', '--quiet', 'origin', 'main'])
account_revision = account_before['Config']['Labels']['org.opencontainers.image.revision']
account_remote_main = run(['git', '-C', ACCOUNT_SOURCE, 'rev-parse', 'origin/main'])
run(['git', '-C', ACCOUNT_SOURCE, 'merge-base', '--is-ancestor', account_revision, account_remote_main])

images = {}
for service, registry in [('web', 'ai-community'), ('studio', 'ai-community-studio')]:
    ref = 'ghcr.io/tompulsen/' + registry + ':sha-' + SHA
    run(['docker', 'pull', '--quiet', ref])
    image = json.loads(run(['docker', 'image', 'inspect', ref]))[0]
    assert image['Config']['Labels']['org.opencontainers.image.revision'] == SHA
    images[service] = (ref, image['Id'])
print('SOURCE_AND_IMAGES_VERIFIED', SHA, flush=True)

cfg = yaml.safe_load(CONFIG.read_text())
assert cfg['url'].rstrip('/') == ORIGIN
chat_env = environment(chat)
shared_secret = cfg['newApiSso']['studioSecret']
assert len(shared_secret) >= 32 and shared_secret == chat_env['COMMUNITY_SSO_SECRET']
assert cfg['newApiSso']['issuer'] == chat_env['NEW_API_PUBLIC_URL']
env = {key: chat_env[key] for key in ['NEW_API_BASE_URL', 'NEW_API_PUBLIC_URL', 'NEW_API_TRUST_PROXY', 'NEW_API_IMAGE_BASE_URL', 'NEW_API_ASYNC_BASE_URL'] if chat_env.get(key)}
# Both attached networks have a "redis" alias; pin the existing session database.
env.update(COMMUNITY_SSO_ORIGIN=ORIGIN, STUDIO_PUBLIC_ORIGIN=ORIGIN,
    COMMUNITY_SSO_SECRET=shared_secret, NEW_API_REDIS_URL='redis://ZY-redis:6379/3',
    NEW_API_SESSION_SECRET=secrets.token_urlsafe(48))
if STUDIO_ENV.exists():
    # Preserve the studio's sessions during later releases.
    existing = environment(inspect('ai-community-studio-1'))
    env['NEW_API_SESSION_SECRET'] = existing['NEW_API_SESSION_SECRET']
assert not any('\n' in value or '\r' in value or '$' in value or "'" in value for value in env.values()), 'Unexpected dotenv value encoding'

assert not (RECORD / 'before.json').exists(), 'Release already attempted; inspect its record'
RECORD.mkdir(parents=True, exist_ok=True)
originals = {}
for path in [COMPOSE, ACCOUNT_COMPOSE, CONFIG, STUDIO_ENV]:
    originals[path] = path.read_bytes() if path.exists() else None
    if path.exists():
        shutil.copy2(path, RECORD / ('before-' + ('account-' if path == ACCOUNT_COMPOSE else '') + path.name))
for name, c in [('web', web_before), ('account', account_before)]:
    run(['docker', 'tag', c['Image'], 'community-studio-rollback-' + name + ':' + c['Id'][:12]])
if '/ai-community-studio-1' in before:
    c = before['/ai-community-studio-1']
    run(['docker', 'tag', c['Image'], 'community-studio-rollback-studio:' + c['Id'][:12]])
(RECORD / 'before.json').write_text(json.dumps({'sha': SHA, 'containers': {name: {'id': c['Id'], 'image': c['Image'], 'mounts': mounts(c)} for name, c in before.items()}}, indent=2))

changed = False
try:
    assert inspect('ai-community-web-1')['Id'] == web_before['Id'], 'Concurrent deployment'
    assert inspect('ZY-newapi')['Id'] == account_before['Id'], 'Concurrent account deployment'
    template = yaml.safe_load((SOURCE / 'deploy/compose.yml').read_text())
    community = yaml.safe_load(COMPOSE.read_text())
    accounts = yaml.safe_load(ACCOUNT_COMPOSE.read_text())
    community['services']['web']['image'] = images['web'][0]
    community['services']['web'].setdefault('environment', {})['COMMUNITY_STUDIO_UPSTREAM'] = 'http://studio:3000'
    studio = template['services']['studio']
    studio.pop('build', None)
    studio['image'] = images['studio'][0]
    community['services']['studio'] = studio
    community['networks']['accounts'] = {'external': True, 'name': '1panel-network'}
    accounts['services']['new-api']['environment']['STUDIO_SSO_ORIGIN'] = ORIGIN
    # Pin the existing verified account image while changing only its environment.
    accounts['services']['new-api']['image'] = 'ghcr.io/tompulsen/new-api:sha-' + account_revision
    run(['docker', 'tag', account_before['Image'], accounts['services']['new-api']['image']])
    cfg['newApiSso']['studioOrigin'] = ORIGIN
    changed = True
    STUDIO_ENV.write_text(''.join(key + "='" + value + "'\n" for key, value in env.items()))
    os.chmod(STUDIO_ENV, 0o600)
    COMPOSE.write_text(yaml.safe_dump(community, sort_keys=False))
    ACCOUNT_COMPOSE.write_text(yaml.safe_dump(accounts, sort_keys=False))
    CONFIG.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True))
    # Validate both resolved documents without logging credentials.
    compose(COMPOSE, 'ai-community', 'config', '--quiet')
    compose(ACCOUNT_COMPOSE, 'new-api', 'config', '--quiet')
    compose(COMPOSE, 'ai-community', 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'studio')
    studio_after = healthy('ai-community-studio-1')
    compose(ACCOUNT_COMPOSE, 'new-api', 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'new-api')
    account_after = healthy('ZY-newapi')
    compose(COMPOSE, 'ai-community', 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'web')
    web_after = healthy('ai-community-web-1')
    assert web_after['Image'] == images['web'][1] and studio_after['Image'] == images['studio'][1]
    assert account_after['Image'] == account_before['Image']
    for previous, current, added in [(web_before, web_after, {'COMMUNITY_STUDIO_UPSTREAM': 'http://studio:3000'}),
                                      (account_before, account_after, {'STUDIO_SSO_ORIGIN': ORIGIN})]:
        assert mounts(previous) == mounts(current)
        assert previous['HostConfig']['PortBindings'] == current['HostConfig']['PortBindings']
        assert previous['HostConfig']['RestartPolicy'] == current['HostConfig']['RestartPolicy']
        assert set(previous['NetworkSettings']['Networks']) == set(current['NetworkSettings']['Networks'])
        assert environment(current) == {**environment(previous), **added}
    assert http('/healthz')[0] == 200
    status, _, body = http('/api/newapi/config')
    settings = json.loads(body)
    assert status == 200 and settings['enabled'] and settings['studioOrigin'] == ORIGIN and settings['studioPath'] == '/studio'
    status, _, body = http('/studio/api/new-api/status')
    settings = json.loads(body)
    assert status == 200 and settings['data']['enabled'] and settings['data']['configured']
    status, headers, _ = http('/studio/community-embed')
    assert status == 200 and ('frame-ancestors ' + ORIGIN) in headers.get('content-security-policy', '')
    assert http('/studio/api/v1/chat/completions', {'model': 'gpt-6.1-sol', 'messages': []})[0] == 401
    assert http('/api/new-api/community/callback')[0] == 400
    after = containers()
    for name, previous in before.items():
        if name in ['/ai-community-web-1', '/ai-community-studio-1', '/ZY-newapi']:
            continue
        current = after[name]
        assert current['Id'] == previous['Id'] and mounts(current) == mounts(previous), name
        assert current['State']['Running'] == previous['State']['Running'], name
    assert after['/ZY-image-playground']['State']['Running']
    if ARCHIVE.exists():
        shutil.copy2(ARCHIVE, RECORD / 'source.before.tar.gz')
    staged = RECORD / 'ai-community.tar.gz'
    run(['git', '-C', SOURCE, 'archive', '--format=tar.gz', '--prefix=ai-community/', '--output=' + str(staged), SHA])
    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(staged, str(ARCHIVE) + '.next')
    os.chmod(str(ARCHIVE) + '.next', 0o644)
    os.replace(str(ARCHIVE) + '.next', ARCHIVE)
    # Compose removes its replaced containers. Remove only stopped old IDs verified above.
    removed = []
    current_ids = {c['Id']: c for c in containers().values()}
    for name in ['/ai-community-web-1', '/ai-community-studio-1', '/ZY-newapi']:
        old = before.get(name)
        if old and old['Id'] in current_ids and old['Id'] != after[name]['Id']:
            candidate = current_ids[old['Id']]
            assert not candidate['State']['Running'] and mounts(candidate) == mounts(old)
            run(['docker', 'container', 'rm', old['Id']])
            removed.append(old['Id'])
    remaining = containers()
    stopped = [{'name': c['Name'], 'id': c['Id'], 'reason': 'Pre-existing or unrelated; preserved for ownership review'} for c in remaining.values() if not c['State']['Running']]
    result = {'sha': SHA, 'accountRevision': account_revision, 'accountRemoteMain': account_remote_main,
              'accountChange': 'OAuth origin configuration only; New API source and image unchanged',
              'healthy': True, 'userBillingRequired': True,
              'publicStudioOrigin': ORIGIN, 'storageAndUnrelatedServicesPreserved': True,
              'removedStoppedContainers': removed, 'remainingStopped': stopped,
              'runningContainers': sum(c['State']['Running'] for c in remaining.values())}
    (RECORD / 'result.json').write_text(json.dumps(result, indent=2))
    print('DEPLOYED', json.dumps(result), flush=True)
except BaseException:
    if changed:
        # Restore configuration first, even when the candidate Compose cannot parse.
        # Recovery of one service must not block recovery of the other service.
        rollback_errors = []
        def recover(label, action):
            try:
                action()
            except BaseException:
                rollback_errors.append(label)
        for path, content in originals.items():
            recover('restore ' + str(path), lambda path=path, content=content: path.unlink(missing_ok=True) if content is None else path.write_bytes(content))
        recover('account image', lambda: run(['docker', 'tag', account_before['Image'], account_before['Config']['Image']]))
        recover('web image', lambda: run(['docker', 'tag', web_before['Image'], web_before['Config']['Image']]))
        recover('account service', lambda: compose(ACCOUNT_COMPOSE, 'new-api', 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'new-api'))
        recover('web service', lambda: compose(COMPOSE, 'ai-community', 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'web'))
        def verify_restored(name, previous):
            assert healthy(name)['Image'] == previous['Image']
        recover('account health', lambda: verify_restored('ZY-newapi', account_before))
        recover('web health', lambda: verify_restored('ai-community-web-1', web_before))
        if '/ai-community-studio-1' in before:
            previous = before['/ai-community-studio-1']
            recover('studio image', lambda: run(['docker', 'tag', previous['Image'], previous['Config']['Image']]))
            recover('studio service', lambda: compose(COMPOSE, 'ai-community', 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'studio'))
            recover('studio health', lambda: verify_restored('ai-community-studio-1', previous))
        else:
            def cleanup_candidate():
                failed = containers().get('/ai-community-studio-1')
                if failed:
                    assert not failed['Mounts']
                    assert failed['Config']['Labels']['com.docker.compose.service'] == 'studio'
                    assert failed['Config']['Labels']['com.docker.compose.project'] == 'ai-community'
                    if failed['State']['Running']:
                        run(['docker', 'stop', '--time', '20', failed['Id']])
                    assert not inspect(failed['Id'])['State']['Running']
                    run(['docker', 'container', 'rm', failed['Id']])
            recover('candidate cleanup', cleanup_candidate)
        if (RECORD / 'source.before.tar.gz').exists():
            recover('source archive', lambda: shutil.copy2(RECORD / 'source.before.tar.gz', ARCHIVE))
        if rollback_errors:
            print('ROLLBACK_REQUIRES_ATTENTION', json.dumps(rollback_errors), flush=True)
        else:
            print('ROLLED_BACK; previous service images and configuration restored', flush=True)
    raise
