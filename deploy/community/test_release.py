import copy
from contextlib import ExitStack, redirect_stdout
import importlib.util
from http.server import BaseHTTPRequestHandler, HTTPServer
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
from threading import Thread
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('community_release', Path(__file__).with_name('release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseHarness:
    image = 'ghcr.io/tompulsen/ai-community@sha256:' + 'a' * 64
    current = 'ai-community-unified-login-test'
    legacy = 'ai-community-legacy-display-test'
    html = b'<html>app</html>'

    def __init__(self, root, failure=None, trusted_proxy=None, gateway='172.18.0.1'):
        self.root, self.failure = root, failure
        self.commands, self.probe_ports = [], []
        self.failed, self.switches = False, 0
        self.compose, self.vhost = root / 'deploy/compose.json', root / 'site.conf'
        self.compose.parent.mkdir()
        (root / 'releases').mkdir()
        config = root / 'private'
        config.mkdir()
        (config / 'default.yml').write_bytes(b'keep-private-config')
        self.env = {'NODE_ENV': 'production', 'NEW_API_SESSION_SECRET': 'unchanged-secret'}
        if trusted_proxy is not None:
            self.env['TRUSTED_PROXY_CIDRS'] = trusted_proxy
        self.items = {}
        for name in [release.WEB, self.current, self.legacy, 'ai-community-db-1', 'ZY-openresty']:
            flags = dict.fromkeys(release.WORKER_FLAGS, '1') if name != release.WEB else {}
            self.items[name] = {
                'Name': '/' + name, 'Id': name + '-before', 'Image': 'sha256:' + name,
                'State': {'Running': True, 'ExitCode': 0, 'StartedAt': 'unchanged', 'Health': {'Status': 'healthy'}},
                'Config': {'Env': [k + '=' + v for k, v in {**self.env, **flags}.items()]},
                'HostConfig': {'NetworkMode': 'proxy-network', 'PortBindings': {'3000/tcp': [{'HostPort': '13000'}]}},
                'NetworkSettings': {'Networks': {'proxy-network': {'Gateway': gateway}, 'database': {'Gateway': '172.19.0.1'}}},
                'Mounts': [{'Type': 'bind', 'Source': str(config), 'Destination': '/app/.config', 'RW': False}],
            }
        self.before = copy.deepcopy(self.items)
        service = {'image': 'old-tag', 'environment': dict(self.env), 'ports': ['13000:3000']}
        unified = copy.deepcopy(service)
        unified['environment'].update(dict.fromkeys(release.WORKER_FLAGS, '1'))
        unified['ports'] = ['33000:3000']
        self.original = {'services': {'web': service, 'unified_web': unified, 'db': {'image': 'postgres'}}}
        self.compose.write_text(json.dumps(self.original))
        self.proxy_before = b'''server {
    # Preserve previously loaded hashed frontend assets;
    location ^~ /assets/ { proxy_pass http://127.0.0.1:33000; }
    location @community_previous_assets { proxy_pass http://127.0.0.1:13000; }
    location @community_legacy_assets { proxy_pass http://127.0.0.1:23000; }
    location / { proxy_pass http://127.0.0.1:33000; }
}
'''
        self.vhost.write_bytes(self.proxy_before)

    def inspect(self, names):
        return {name: copy.deepcopy(self.items[name]) for name in names}

    def execute(self, args, timeout=60, data=None):
        self.commands.append(tuple(args))
        if args[:2] == ['docker', 'ps']:
            return '\n'.join(self.items).encode()
        if args[:3] == ['docker', 'image', 'inspect']:
            image = {'Id': 'sha256:new', 'Config': {'Env': ['NODE_ENV=production'], 'Labels': {
                'org.opencontainers.image.revision': 'b' * 40,
                'org.opencontainers.image.source': 'https://github.com/Tompulsen/ai-community'}}}
            return json.dumps([image]).encode()
        if args[:2] == ['docker', 'cp']:
            (Path(args[-1]) / 'entry-hash.js').write_bytes(b'js')
        elif args[:2] == ['docker', 'exec']:
            return self.html if args[3] == 'cat' else b''
        elif args[:2] == ['docker', 'compose']:
            definition = json.loads(Path(args[args.index('-f') + 1]).read_bytes())
            if 'run' in args:
                name = args[args.index('--name') + 1]
                self.items[name] = copy.deepcopy(self.before[self.current])
            elif 'up' in args:
                self.switches += 1
                if 'unified_web' in definition['services']:
                    self.items.update(copy.deepcopy(self.before))
                else:
                    self.fail('new-start')
                    web = copy.deepcopy(self.before[self.current])
                    web.update({'Name': '/' + release.WEB, 'Id': 'new-web', 'Image': 'sha256:new'})
                    env = {'NODE_ENV': 'production', **definition['services']['web']['environment']}
                    web['Config']['Env'] = [k + '=' + v for k, v in env.items()]
                    self.items[release.WEB] = web
        elif args[:2] == ['docker', 'kill']:
            if self.failure != 'worker-draining':
                self.items[args[-1]]['State']['Running'] = False
        elif args[:2] == ['docker', 'wait']:
            if self.failure == 'worker-draining':
                raise subprocess.TimeoutExpired(args, timeout)
            return b'0\n'
        elif args[:2] == ['docker', 'stop']:
            self.items[args[-1]]['State']['Running'] = False
        elif args[:2] == ['docker', 'rm']:
            del self.items[args[-1]]
        else:
            raise AssertionError('Unexpected operation: ' + repr(args))
        return b''

    def fail(self, phase):
        if self.failure == phase and not self.failed:
            self.failed = True
            raise RuntimeError('injected ' + phase)

    def probes(self, port=None):
        self.probe_ports.append(port)
        self.fail({43000: 'candidate', 13000: 'new-validation', None: 'proxy'}[port])
        return [{'port': port, 'status': 200}]

    def request(self, path, port=None, method='GET'):
        body = self.html if path == '/discover' else b'js'
        return 200, {'x-content-type-options': 'nosniff', 'content-type': 'text/javascript',
                     'content-length': str(len(body))}, b'' if method == 'HEAD' else body

    def run(self):
        real_open = os.open

        def mapped_path(*parts):
            path = Path(*parts)
            return self.root / 'releases' if str(path).replace('\\', '/') == '/opt/ai-community-next/releases' else path

        def lock_open(path, *args, **kwargs):
            if str(path) == '/opt/ai-community-next/deploy/.release.lock':
                path = self.root / 'release.lock'
            return real_open(path, *args, **kwargs)

        with ExitStack() as stack:
            for name, value in [('COMPOSE', self.compose), ('VHOST', self.vhost), ('ARCHIVE', self.root / 'archive'),
                                ('Path', mapped_path), ('execute', self.execute), ('inspect', self.inspect),
                                ('probes', self.probes), ('request', self.request),
                                ('wait_healthy', lambda name: self.inspect([name])[name])]:
                stack.enter_context(patch.object(release, name, value))
            stack.enter_context(patch.object(release.os, 'geteuid', return_value=0, create=True))
            stack.enter_context(patch.object(release.os, 'open', side_effect=lock_open))
            stack.enter_context(patch.dict('sys.modules', {'fcntl': SimpleNamespace(LOCK_EX=1, LOCK_NB=2, flock=lambda *_: None)}))
            stack.enter_context(redirect_stdout(io.StringIO()))
            release.main(self.image)

    def report(self):
        return json.loads(next((self.root / 'releases').glob('*/result.json')).read_bytes())


class ReleaseFlowTests(unittest.TestCase):
    def test_success_retires_old_apps_after_checks_and_keeps_data_services(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = ReleaseHarness(Path(root))
            fixture.run()
            report = fixture.report()
            self.assertEqual(report['phase'], 'complete')
            self.assertEqual(report['workerContainer'], release.WEB)
            for name in [fixture.current, fixture.legacy]:
                self.assertFalse(fixture.items[name]['State']['Running'])
            self.assertEqual(fixture.items['ai-community-db-1'], fixture.before['ai-community-db-1'])
            desired = json.loads(fixture.compose.read_bytes())
            self.assertEqual(set(desired['services']), {'web', 'db'})
            self.assertEqual(desired['services']['web']['image'], fixture.image)
            self.assertEqual(desired['services']['web']['environment']['TRUSTED_PROXY_CIDRS'], 'loopback,172.18.0.1')
            self.assertEqual(fixture.probe_ports, [43000, 13000, None])

    def test_candidate_failure_does_not_stop_or_reconfigure_production(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = ReleaseHarness(Path(root), 'candidate')
            with self.assertRaisesRegex(RuntimeError, 'injected candidate'):
                fixture.run()
            self.assertEqual(json.loads(fixture.compose.read_bytes()), fixture.original)
            self.assertEqual(fixture.vhost.read_bytes(), fixture.proxy_before)
            self.assertEqual(fixture.items, fixture.before)
            self.assertEqual(fixture.switches, 0)
            self.assertNotIn('rollback', fixture.report())
            self.assertFalse(any(command[:2] == ('docker', 'kill') for command in fixture.commands))

    def test_application_switch_failures_restore_old_config_and_services(self):
        for failure in ['new-start', 'new-validation', 'proxy']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as root:
                fixture = ReleaseHarness(Path(root), failure)
                with self.assertRaisesRegex(RuntimeError, 'injected ' + failure):
                    fixture.run()
                report = fixture.report()
                self.assertEqual(report['failedPhase'], 'verify' if failure == 'proxy' else 'application-switch')
                self.assertEqual(report['rollback'], 'restored')
                self.assertEqual(fixture.vhost.read_bytes(), fixture.proxy_before)
                restored = json.loads(fixture.compose.read_bytes())
                for service, name in [('web', release.WEB), ('unified_web', fixture.current)]:
                    self.assertEqual(restored['services'][service]['image'], fixture.before[name]['Image'])
                    self.assertTrue(fixture.items[name]['State']['Running'])
                self.assertEqual(fixture.switches, 2)
                self.assertEqual(fixture.probe_ports[-1], None)
                self.assertEqual(fixture.items['ai-community-db-1'], fixture.before['ai-community-db-1'])

    def test_draining_worker_is_not_killed_or_replaced_on_timeout(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = ReleaseHarness(Path(root), 'worker-draining')
            with self.assertRaises(subprocess.TimeoutExpired):
                fixture.run()
            report = fixture.report()
            self.assertEqual(report['failedPhase'], 'worker-handoff')
            self.assertIn('still draining', report['rollback'])
            self.assertEqual(fixture.switches, 0)
            self.assertEqual(fixture.items, fixture.before)
            signals = [command for command in fixture.commands if command[:2] == ('docker', 'kill')]
            self.assertEqual(signals, [('docker', 'kill', '--signal', 'SIGTERM', release.WEB)])
            self.assertEqual(json.loads(fixture.compose.read_bytes()), fixture.original)
            self.assertEqual(fixture.vhost.read_bytes(), fixture.proxy_before)

    def test_proxy_trust_preserves_explicit_setting_and_ignores_other_networks(self):
        for configured, gateway, expected in [('loopback,192.0.2.10', '172.18.0.1', 'loopback,192.0.2.10'),
                                              (None, None, 'loopback')]:
            with self.subTest(configured=configured), tempfile.TemporaryDirectory() as root:
                fixture = ReleaseHarness(Path(root), trusted_proxy=configured, gateway=gateway)
                fixture.run()
                env = json.loads(fixture.compose.read_bytes())['services']['web']['environment']
                self.assertEqual(env['TRUSTED_PROXY_CIDRS'], expected)


class ReleaseTests(unittest.TestCase):
    def test_http_headers_are_case_insensitive(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header('x-content-type-options', 'nosniff')
                self.send_header('Content-Type', 'text/javascript')
                self.send_header('Content-Length', '2')
                self.end_headers()
                self.wfile.write(b'js')

            def log_message(self, *_):
                pass

        with HTTPServer(('127.0.0.1', 0), Handler) as server:
            thread = Thread(target=server.handle_request)
            thread.start()
            status, headers, body = release.request('/asset.js', server.server_port)
            thread.join(timeout=3)
        self.assertEqual(status, 200)
        self.assertEqual(body, b'js')
        self.assertEqual(headers['x-content-type-options'], 'nosniff')
        self.assertEqual(headers['content-type'], 'text/javascript')
        self.assertEqual(headers['content-length'], '2')

    def test_atomic_replacement_preserves_target_and_symlink_permissions(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / 'config'
            release.write_private(target, b'before')
            release.atomic_write(target, b'after')
            self.assertEqual(target.read_bytes(), b'after')

    def test_consolidation_preserves_configuration_and_data_services(self):
        old = {'services': {'web': {'ports': ['127.0.0.1:13000:3000']},
                            'unified_web': {'container_name': 'old', 'ports': ['33000:3000'],
                                            'environment': {'SECRET': 'keep', 'DISABLE_MEDIA_WORKER': '1',
                                                            'DISABLE_LOTTERY_WORKER': '1'},
                                            'volumes': ['uploads:/app/files'], 'networks': ['database'],
                                            'labels': {'community.unified-login': 'old', 'custom': 'keep'}},
                            'db': {'image': 'postgres:18-alpine'}, 'redis': {'image': 'redis'},
                            'documents': {'image': 'documents'}}, 'volumes': {'uploads': {}}}
        before = copy.deepcopy(old)
        result = release.definition(old, 'new-digest')
        self.assertEqual(old, before)
        self.assertNotIn('unified_web', result['services'])
        web = result['services']['web']
        self.assertEqual(web['environment'], {'SECRET': 'keep'})
        self.assertEqual(web['ports'], old['services']['web']['ports'])
        self.assertEqual(web['volumes'], old['services']['unified_web']['volumes'])
        self.assertEqual(web['labels'], {'custom': 'keep'})
        self.assertEqual(web['image'], 'new-digest')
        self.assertNotIn('container_name', web)
        for service in ['db', 'redis', 'documents']:
            self.assertEqual(result['services'][service], old['services'][service])
        self.assertEqual(release.definition(result, 'next')['services']['web']['image'], 'next')

    def test_proxy_only_replaces_asset_chain_and_business_upstream(self):
        source = '''server {
    location / { return 301 https://example$request_uri; }
}
server {
    location = /source/archive.tar.gz { alias /source/archive.tar.gz; }
    # Preserve previously loaded hashed frontend assets; business APIs use the root route.
    location ^~ /assets/ { proxy_pass http://127.0.0.1:33000; }
    location @community_previous_assets { proxy_pass http://127.0.0.1:13000; }
    location @community_legacy_assets { proxy_pass http://127.0.0.1:23000; }
    location / {
        proxy_pass http://127.0.0.1:33000;
        proxy_buffering off;
    }
}
'''
        result = release.proxy_config(source)
        self.assertIn('location / { return 301', result)
        self.assertIn('alias /source/archive.tar.gz;', result)
        self.assertIn('proxy_buffering off;', result)
        self.assertIn('try_files $uri =404;', result)
        self.assertIn('internal;', result)
        self.assertEqual(result.count('proxy_pass http://127.0.0.1:13000;'), 2)
        self.assertNotIn(':33000', result)
        self.assertNotIn(':23000', result)
        self.assertEqual(release.proxy_config(result), result)
        with self.assertRaises(AssertionError):
            release.proxy_config('unexpected configuration')

    def test_archive_deduplicates_and_rejects_changed_url_without_overwrite(self):
        with tempfile.TemporaryDirectory() as root:
            source, archive = Path(root) / 'source', Path(root) / 'archive'
            source.mkdir()
            (source / 'entry-hash.js').write_bytes(b'old-content')
            entries = release.merge_assets(source, archive)
            self.assertEqual(entries['/assets/entry-hash.js']['sha256'], release.digest(b'old-content'))
            self.assertEqual(release.merge_assets(source, archive), entries)
            (source / 'entry-hash.js').write_bytes(b'changed-content')
            with self.assertRaisesRegex(AssertionError, 'Asset conflict'):
                release.merge_assets(source, archive)
            self.assertEqual((archive / 'entry-hash.js').read_bytes(), b'old-content')

    def test_archive_rejects_hidden_files_and_empty_sources(self):
        with tempfile.TemporaryDirectory() as root:
            source, archive = Path(root) / 'source', Path(root) / 'archive'
            source.mkdir()
            with self.assertRaisesRegex(AssertionError, 'Empty asset tree'):
                release.merge_assets(source, archive)
            (source / '.private').write_bytes(b'private')
            with self.assertRaisesRegex(AssertionError, 'Hidden assets'):
                release.merge_assets(source, archive)

    def test_production_shutdown_sends_only_sigterm_and_waits(self):
        with patch.object(release, 'execute', side_effect=[b'', b'0\n']) as execute:
            release.graceful_stop('application')
        self.assertEqual(execute.call_args_list[0].args[0], ['docker', 'kill', '--signal', 'SIGTERM', 'application'])
        self.assertEqual(execute.call_args_list[1].args[0], ['docker', 'wait', 'application'])
        with patch.object(release, 'execute', side_effect=[b'', b'137\n']):
            with self.assertRaisesRegex(AssertionError, 'did not exit gracefully'):
                release.graceful_stop('application')


if __name__ == '__main__':
    unittest.main()
