import copy
import importlib.util
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


policy, isolation, release = load('moderation'), load('isolation'), load('release')


class ModerationDeploymentTests(unittest.TestCase):
    def base(self):
        return isolation.community_definition({'services': {
            'web': {'image': 'old', 'environment': {'PRESERVE_SECRET': 'private'},
                    'ports': ['127.0.0.1:13000:3000'], 'volumes': ['files:/app/files'],
                    'networks': dict.fromkeys(['accounts', 'database', 'outbound'])},
            'db': {'image': 'postgres'}, 'redis': {'image': 'redis'}},
            'networks': {'accounts': {'name': isolation.NETWORK, 'external': True},
                         'database': {'internal': True}, 'outbound': {}}, 'volumes': {'files': {}}})

    def configured(self):
        return policy.definition(self.base(), 'ghcr.io/tompulsen/ai-community-moderation@sha256:' + 'a' * 64, 'b' * 64)

    def test_preserves_existing_services_and_is_idempotent_across_web_release(self):
        base = self.base()
        old = copy.deepcopy(base)
        result = policy.definition(base, 'ghcr.io/tompulsen/ai-community-moderation@sha256:' + 'a' * 64, 'b' * 64)
        self.assertEqual(base, old)
        for name in ('db', 'redis'):
            self.assertEqual(result['services'][name], old['services'][name])
        for key in ('ports', 'volumes'):
            self.assertEqual(result['services']['web'][key], old['services']['web'][key])
        self.assertEqual(result['services']['web']['environment']['PRESERVE_SECRET'], 'private')
        self.assertEqual(policy.definition(result, result['services']['moderation']['image'], 'b' * 64), result)
        self.assertEqual(isolation.community_definition(result), result)
        next_release = release.definition(result, 'new-web-image')
        self.assertEqual(isolation.community_definition(next_release), next_release)

    def test_complete_rollout_keeps_sidecar_and_allows_only_its_new_network(self):
        harness_module = load('test_release')
        flow = harness_module.release
        configured = self.configured()

        class Harness(harness_module.ReleaseHarness):
            def execute(self, args, *positional, **kwargs):
                result = super().execute(args, *positional, **kwargs)
                if args[:2] == ['docker', 'compose'] and 'up' in args and self.items[flow.WEB]['Image'] == 'sha256:new':
                    self.items[flow.WEB]['NetworkSettings']['Networks'][policy.NETWORK] = {}
                return result

        with tempfile.TemporaryDirectory() as directory:
            fixture = Harness(Path(directory))
            sidecar = copy.deepcopy(fixture.items['ai-community-db-1'])
            sidecar.update(Name='/' + policy.CONTAINER, Id='unchanged-model')
            fixture.items[policy.CONTAINER] = sidecar
            fixture.before = copy.deepcopy(fixture.items)
            original_definition = flow.definition

            def definition(original, image):
                result = original_definition(original, image)
                result['networks'] = configured['networks']
                result['services']['web']['networks'] = configured['services']['web']['networks']
                result['services']['web']['environment'].update(configured['services']['web']['environment'])
                result['services']['moderation'] = configured['services']['moderation']
                return result

            with patch.object(flow, 'definition', definition):
                fixture.run()
            self.assertEqual(fixture.report()['phase'], 'complete')
            self.assertEqual(fixture.items[policy.CONTAINER], sidecar)
            self.assertIn(policy.NETWORK, fixture.items[flow.WEB]['NetworkSettings']['Networks'])
            self.assertNotIn('moderation', fixture.original['services'])

    def test_release_only_permits_the_validated_moderation_network_addition(self):
        old = {'NetworkSettings': {'Networks': {'ai-community_accounts': {}, 'ai-community_database': {}, 'ai-community_outbound': {}}}}
        self.assertEqual(release.expected_web_networks(old, self.base()), set(old['NetworkSettings']['Networks']))
        desired = self.configured()
        self.assertEqual(release.expected_web_networks(old, desired), set(old['NetworkSettings']['Networks']) | {policy.NETWORK})
        desired['services']['moderation']['networks']['outbound'] = {}
        with self.assertRaises(AssertionError): release.expected_web_networks(old, desired)

    def test_rejects_public_ports_extra_networks_mounts_privileges_and_mismatched_token(self):
        for key, value in [('ports', ['8080:8080']), ('volumes', ['/var/run/docker.sock:/socket']),
                           ('privileged', True), ('network_mode', 'host'), ('cap_add', ['SYS_ADMIN']),
                           ('networks', {'moderation': {'gw_priority': -1}, 'outbound': {}}),
                           ('mem_limit', '8g'), ('cpus', 8), ('user', 'root')]:
            with self.subTest(key=key):
                config = self.configured()
                config['services']['moderation'][key] = value
                with self.assertRaises(AssertionError): policy.validate_definition(config)
        config = self.configured()
        config['services']['web']['environment']['COMMUNITY_MODERATION_TOKEN'] = 'c' * 64
        with self.assertRaises(AssertionError): policy.validate_definition(config)

    def test_rejects_unpinned_image_short_token_and_public_network(self):
        with self.assertRaises(AssertionError): policy.definition(self.base(), 'image:latest', 'b' * 64)
        with self.assertRaises(AssertionError): policy.definition(self.base(), 'ghcr.io/tompulsen/ai-community-moderation@sha256:' + 'a' * 64, 'short')
        config = self.configured()
        config['networks']['moderation']['internal'] = False
        with self.assertRaises(AssertionError): isolation.community_definition(config)


if __name__ == '__main__':
    unittest.main()
