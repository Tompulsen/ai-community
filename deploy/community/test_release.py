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
        self.commands, self.probe_ports, self.events = [], [], []
        self.proxy_port, self.proxy_generation = 33000, 0
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
        if args[:2] == ['docker', 'top']:
            return f'PID COMMAND\n{100 + self.proxy_generation} nginx: worker process\n'.encode()
        if args[:3] == ['docker', 'image', 'inspect']:
            image = {'Id': 'sha256:new', 'Config': {'Env': ['NODE_ENV=production'], 'Labels': {
                'org.opencontainers.image.revision': 'b' * 40,
                'org.opencontainers.image.source': 'https://github.com/Tompulsen/ai-community'}}}
            return json.dumps([image]).encode()
        if args[:2] == ['docker', 'cp']:
            (Path(args[-1]) / 'entry-hash.js').write_bytes(b'js')
        elif args[:2] == ['docker', 'exec']:
            if args[3:] == ['nginx', '-s', 'reload']:
                self.proxy_generation += 1
                self.proxy_port = int(release.re.search(r'proxy_pass http://127\.0\.0\.1:(\d+);',
                                                       self.vhost.read_text())[1])
                self.events.append(('proxy', self.proxy_port))
            return self.html if args[3] == 'cat' else b''
        elif args[:2] == ['docker', 'compose']:
            definition = json.loads(Path(args[args.index('-f') + 1]).read_bytes())
            if 'run' in args:
                name = args[args.index('--name') + 1]
                self.items[name] = copy.deepcopy(self.before[self.current])
            elif 'up' in args:
                self.switches += 1
                self.events.append(('up', 'rollback' if 'unified_web' in definition['services'] else 'new'))
                if 'unified_web' in definition['services']:
                    self.fail('rollback')
                    self.items.update(copy.deepcopy(self.before))
                else:
                    if self.failure == 'candidate-exit' and not self.failed:
                        self.failed = True
                        for name, item in self.items.items():
                            if name.startswith('ai-community-check-'):
                                item['State']['Running'] = False
                        raise RuntimeError('candidate exited during new-start')
                    self.fail('new-start')
                    web = copy.deepcopy(self.before[self.current])
                    web.update({'Name': '/' + release.WEB, 'Id': 'new-web', 'Image': 'sha256:new'})
                    env = {'NODE_ENV': 'production', **definition['services']['web']['environment']}
                    web['Config']['Env'] = [k + '=' + v for k, v in env.items()]
                    self.items[release.WEB] = web
        elif args[:2] == ['docker', 'kill']:
            self.events.append(('stop', args[-1]))
            draining = self.failure == 'worker-draining' and args[-1] == release.WEB \
                or self.failure == 'retired-draining' and args[-1] == self.current
            if not draining:
                self.items[args[-1]]['State']['Running'] = False
        elif args[:2] == ['docker', 'wait']:
            if self.failure == 'worker-draining' and args[-1] == release.WEB \
                    or self.failure == 'retired-draining' and args[-1] == self.current:
                raise subprocess.TimeoutExpired(args, timeout)
            return b'0\n'
        elif args[:2] == ['docker', 'stop']:
            self.items[args[-1]]['State']['Running'] = False
        elif args[:2] == ['docker', 'rm']:
            self.events.append(('remove', args[-1]))
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
        self.events.append(('probe', port, self.proxy_port))
        if self.failure == 'verify-candidate-exit' and not self.failed and port is None and self.proxy_port == 13000:
            self.failed = True
            for name, item in self.items.items():
                if name.startswith('ai-community-check-'):
                    item['State']['Running'] = False
            raise RuntimeError('candidate exited during verify')
        self.fail({43000: 'candidate', 13000: 'new-validation',
                   None: 'candidate-proxy' if self.proxy_port == 43000 else 'proxy'}[port])
        return [{'port': port, 'status': 200}]

    def wait_requests(self, name, guard=None):
        self.events.append(('request-drain', name))
        if name.startswith('ai-community-check-'):
            self.fail('candidate-draining')
        if guard:
            if self.failure == 'candidate-exit-request-wait':
                for candidate, item in self.items.items():
                    if candidate.startswith('ai-community-check-'):
                        item['State']['Running'] = False
            guard()

    def wait_proxy(self, workers, guard=None):
        self.events.append(('proxy-drain', self.proxy_port))
        if guard:
            if self.failure == 'candidate-exit-proxy-wait':
                for candidate, item in self.items.items():
                    if candidate.startswith('ai-community-check-'):
                        item['State']['Running'] = False
            guard()

    def request(self, path, port=None, method='GET', timeout=15):
        if path == '/healthz' and port == 43000:
            running = any(item['State']['Running'] for name, item in self.items.items()
                          if name.startswith('ai-community-check-'))
            return (200 if running else 503), {}, b''
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
                                ('wait_request_drain', self.wait_requests), ('wait_proxy_workers', self.wait_proxy),
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
            self.assertEqual(fixture.probe_ports, [43000, None, 13000, None])
            candidate = next(command[command.index('--name') + 1] for command in fixture.commands
                             if command[:2] == ('docker', 'compose') and 'run' in command)
            order = [fixture.events.index(event) for event in [
                ('proxy', 43000), ('probe', None, 43000), ('proxy-drain', 43000),
                ('request-drain', release.WEB), ('stop', release.WEB), ('up', 'new'),
                ('probe', 13000, 43000), ('proxy', 13000), ('probe', None, 13000),
                ('proxy-drain', 13000), ('request-drain', candidate), ('stop', candidate),
                ('remove', candidate)]]
            self.assertEqual(order, sorted(order))

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
            self.assertFalse(any(command[:2] == ('docker', 'kill') and command[-1] == release.WEB
                                 for command in fixture.commands))

    def test_candidate_proxy_failure_restores_traffic_without_restarting_old_web(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = ReleaseHarness(Path(root), 'candidate-proxy')
            original_wait = fixture.wait_requests
            def wait_requests(name, guard=None):
                if name.startswith('ai-community-check-'):
                    report = fixture.report()
                    self.assertEqual(report['phase'], 'failed')
                    self.assertIn('injected candidate-proxy', report['error'])
                return original_wait(name, guard)
            fixture.wait_requests = wait_requests
            with self.assertRaisesRegex(RuntimeError, 'injected candidate-proxy'):
                fixture.run()
            self.assertEqual(fixture.items, fixture.before)
            self.assertEqual(fixture.switches, 0)
            self.assertEqual(fixture.vhost.read_bytes(), fixture.proxy_before)
            self.assertEqual(fixture.report()['rollback'], 'restored')
            self.assertNotIn(('stop', release.WEB), fixture.events)

    def test_candidate_exit_during_either_wait_preserves_old_web_and_restores_proxy(self):
        for failure in ['candidate-exit-proxy-wait', 'candidate-exit-request-wait']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as root:
                fixture = ReleaseHarness(Path(root), failure)
                with self.assertRaisesRegex(AssertionError, 'Candidate health check failed'):
                    fixture.run()
                self.assertEqual(fixture.items[release.WEB], fixture.before[release.WEB])
                self.assertNotIn(('stop', release.WEB), fixture.events)
                self.assertEqual(fixture.switches, 0)
                self.assertEqual(fixture.vhost.read_bytes(), fixture.proxy_before)
                self.assertEqual(fixture.report()['rollback'], 'restored')

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
                restore = fixture.events.index(('up', 'rollback'))
                fallback = max(index for index, event in enumerate(fixture.events[:restore])
                               if event == ('proxy', 43000))
                self.assertLess(fallback, restore)
                self.assertIn(('probe', None, 43000), fixture.events[fallback:restore])
                self.assertIn(('proxy-drain', 43000), fixture.events[fallback:restore])

    def test_rollback_failure_preserves_the_candidate_serving_traffic(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = ReleaseHarness(Path(root), 'new-validation')
            original_fail = fixture.fail
            def fail(phase):
                if phase == 'rollback':
                    raise RuntimeError('injected rollback')
                original_fail(phase)
            fixture.fail = fail
            with self.assertRaisesRegex(RuntimeError, 'injected new-validation'):
                fixture.run()
            report = fixture.report()
            candidate = report['retainedCandidate']
            self.assertTrue(fixture.items[candidate]['State']['Running'])
            self.assertEqual(fixture.proxy_port, 43000)
            self.assertIn('injected rollback', report['rollback'])
            self.assertNotIn(('stop', candidate), fixture.events)
            self.assertNotIn(('remove', candidate), fixture.events)

    def test_candidate_exit_does_not_prevent_restoring_the_old_web(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = ReleaseHarness(Path(root), 'candidate-exit')
            with self.assertRaisesRegex(RuntimeError, 'candidate exited during new-start'):
                fixture.run()
            report = fixture.report()
            self.assertTrue(report['candidateUnavailable'])
            self.assertEqual(report['rollback'], 'restored')
            self.assertTrue(fixture.items[release.WEB]['State']['Running'])
            self.assertEqual(fixture.items[release.WEB]['Image'], fixture.before[release.WEB]['Image'])
            self.assertEqual(fixture.vhost.read_bytes(), fixture.proxy_before)

    def test_retired_web_drain_timeout_is_not_force_recreated_during_rollback(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = ReleaseHarness(Path(root), 'retired-draining')
            with self.assertRaises(subprocess.TimeoutExpired):
                fixture.run()
            report = fixture.report()
            self.assertIn('still draining', report['rollback'])
            self.assertEqual(fixture.switches, 1)
            self.assertEqual(fixture.events.count(('stop', fixture.current)), 1)
            self.assertTrue(fixture.items[fixture.current]['State']['Running'])
            self.assertTrue(fixture.items[report['retainedCandidate']]['State']['Running'])
            self.assertEqual(fixture.proxy_port, 43000)

    def test_dead_candidate_does_not_replace_a_healthy_new_web_during_rollback(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = ReleaseHarness(Path(root), 'verify-candidate-exit')
            with self.assertRaisesRegex(RuntimeError, 'candidate exited during verify'):
                fixture.run()
            report = fixture.report()
            self.assertIn('verified production web was preserved', report['rollback'])
            self.assertEqual(fixture.proxy_port, 13000)
            self.assertEqual(fixture.items[release.WEB]['Image'], 'sha256:new')
            self.assertEqual(fixture.switches, 1)
            failed_probe = fixture.events.index(('probe', None, 13000))
            self.assertNotIn(('proxy', 43000), fixture.events[failed_probe:])
            self.assertNotIn(('stop', release.WEB), fixture.events[failed_probe:])

    def test_candidate_drain_timeout_keeps_new_web_and_candidate_without_killing_it(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = ReleaseHarness(Path(root), 'candidate-draining')
            fixture.run()
            report = fixture.report()
            candidate = report['retainedCandidate']
            self.assertEqual(report['phase'], 'complete')
            self.assertEqual(fixture.proxy_port, 13000)
            self.assertTrue(fixture.items[candidate]['State']['Running'])
            self.assertEqual(fixture.items[release.WEB]['Image'], 'sha256:new')
            self.assertNotIn(('stop', candidate), fixture.events)

    def test_draining_worker_is_not_killed_or_replaced_on_timeout(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = ReleaseHarness(Path(root), 'worker-draining')
            with self.assertRaises(subprocess.TimeoutExpired):
                fixture.run()
            report = fixture.report()
            self.assertEqual(report['failedPhase'], 'worker-handoff')
            self.assertIn('still draining', report['rollback'])
            self.assertEqual(fixture.switches, 0)
            for name, item in fixture.before.items():
                self.assertEqual(fixture.items[name], item)
            candidate = report['retainedCandidate']
            self.assertTrue(fixture.items[candidate]['State']['Running'])
            self.assertEqual(fixture.proxy_port, 43000)
            signals = [command for command in fixture.commands if command[:2] == ('docker', 'kill')]
            self.assertEqual(signals, [('docker', 'kill', '--signal', 'SIGTERM', release.WEB)])
            self.assertEqual(json.loads(fixture.compose.read_bytes()), fixture.original)
            self.assertIn('127.0.0.1:43000;', fixture.vhost.read_text())

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
        candidate = release.proxy_config(source, 43000)
        self.assertEqual(candidate.count('proxy_pass http://127.0.0.1:43000;'), 2)
        self.assertEqual(release.proxy_config(candidate), result)
        with self.assertRaises(AssertionError):
            release.proxy_config(source, 23000)
        with self.assertRaises(AssertionError):
            release.proxy_config('unexpected configuration')

    def test_split_proxy_preserves_production_include_and_only_inlines_the_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'root.conf'
            fragment = '''location ^~ / {
    proxy_pass http://127.0.0.1:13000;
    proxy_set_header Host $host;
    proxy_read_timeout 300s;
    proxy_buffering off;
}
'''
            root.write_text(fragment)
            source = '''server {
    # Current assets first; archived versions contain static files only.
    location ^~ /assets/ {
        proxy_pass http://127.0.0.1:13000;
    }
    root /www/sites/zhangyu-community/index;
    limit_conn perserver 20;
    include /www/sites/zhangyu-community/proxy/*.conf;
}
'''
            with patch.object(release, 'PROXY_ROOT', root):
                self.assertEqual(release.proxy_config(source), source)
                candidate = release.proxy_config(source, 43000)
                self.assertNotIn(release.PROXY_INCLUDE, candidate)
                self.assertEqual(candidate.count('proxy_pass http://127.0.0.1:43000;'), 2)
                self.assertIn('limit_conn perserver 20;', candidate)
                self.assertIn('proxy_read_timeout 300s;', candidate)
                self.assertEqual(root.read_text(), fragment)
                with self.assertRaisesRegex(AssertionError, 'asset upstream'):
                    release.proxy_config(source.replace(':13000;', ':23000;'), 43000)
                root.write_text(fragment.replace(':13000;', ':23000;'))
                with self.assertRaisesRegex(AssertionError, 'root upstream'):
                    release.proxy_config(source, 43000)
                root.write_text(fragment)
                (root.parent / 'extra.conf').write_text('location /extra {}')
                with self.assertRaisesRegex(AssertionError, 'proxy fragments'):
                    release.proxy_config(source, 43000)

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

    def test_proxy_html_waits_for_old_workers_to_serve_the_new_index(self):
        for name in ['candidate', release.WEB]:
            with self.subTest(name=name), \
                    patch.object(release, 'execute', return_value=b'new html') as execute, \
                    patch.object(release, 'request', side_effect=[(200, {}, b'old html'), (200, {}, b'new html')]) as request, \
                    patch.object(release.time, 'monotonic', return_value=0), \
                    patch.object(release.time, 'sleep') as sleep:
                release.wait_proxy_html(name)
                execute.assert_called_once_with(['docker', 'exec', name, 'cat', '/app/dist/index.html'])
                self.assertEqual(request.call_count, 2)
                sleep.assert_called_once_with(0.25)

    def test_proxy_html_timeout_reports_the_last_http_status_and_hash(self):
        with patch.object(release, 'execute', return_value=b'new html'), \
                patch.object(release, 'request', return_value=(503, {}, b'last html')), \
                patch.object(release.time, 'monotonic', side_effect=[0, 0, 15]):
            with self.assertRaisesRegex(RuntimeError, 'within 15 seconds: HTTP 503, HTML SHA256 ' + release.digest(b'last html')):
                release.wait_proxy_html('candidate')

    def test_proxy_drain_waits_only_for_workers_from_before_reload(self):
        with patch.object(release, 'proxy_workers', side_effect=[{'101', '102'}, {'102'}, {'103'}]), \
                patch.object(release.time, 'sleep') as sleep:
            release.wait_proxy_workers({'101', '102'})
        self.assertEqual(sleep.call_count, 2)

    def test_proxy_drain_timeout_preserves_the_application(self):
        with patch.object(release, 'proxy_workers', return_value={'101'}), \
                patch.object(release.time, 'monotonic', side_effect=[0, 621]), \
                patch.object(release, 'execute') as execute:
            with self.assertRaisesRegex(RuntimeError, 'still draining'):
                release.wait_proxy_workers({'101'})
        execute.assert_not_called()


if __name__ == '__main__':
    unittest.main()
