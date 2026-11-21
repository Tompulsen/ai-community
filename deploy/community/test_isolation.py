import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

policy, release = load('isolation'), load('release')


class IsolationTests(unittest.TestCase):
    def test_validation_includes_live_services_under_inactive_compose_profiles(self):
        container = {'Config': {'Labels': {'com.docker.compose.project.config_files': '/private/redis.json'}}}
        definition = {'services': {'redis': {'profiles': ['manual'], 'networks': {'community_accounts': {}}}}}
        def compose(args):
            self.assertEqual(args[:2], ['docker', 'compose'])
            self.assertEqual(args[-3:], ['config', '--format', 'json'])
            self.assertIn('/private/redis.json', args)
            return json.dumps(definition if '--profile' in args and args[args.index('--profile') + 1] == '*' else {'services': {}}).encode()
        with patch.object(policy, 'execute', side_effect=compose):
            self.assertEqual(policy.upstream_compose(container)['services']['redis'], definition['services']['redis'])

    def community(self):
        return {'services': {'web': {'image': 'old', 'environment': {'SESSION_SECRET': 'preserved'},
                 'networks': {'accounts': None, 'database': None, 'outbound': None},
                 'volumes': ['config:/app/.config:ro', 'files:/app/files'], 'ports': ['127.0.0.1:13000:3000']},
                 'db': {'image': 'postgres'}, 'redis': {'image': 'redis'}},
                'networks': {'accounts': {'name': '1panel-network', 'external': True},
                             'database': {'name': 'ai-community_database', 'internal': True},
                             'outbound': {'name': 'ai-community_outbound'}}, 'volumes': {'files': {}}}

    def test_only_web_network_and_security_change_and_next_release_preserves_them(self):
        original = self.community()
        before = copy.deepcopy(original)
        result = policy.community_definition(original)
        self.assertEqual(original, before)
        self.assertEqual(policy.community_definition(result), result)
        for name in ('db', 'redis'):
            self.assertEqual(result['services'][name], before['services'][name])
        web = result['services']['web']
        self.assertEqual(web['environment'], {'SESSION_SECRET': 'preserved', 'ENABLE_MCP': 'false'})
        self.assertEqual(web['volumes'], before['services']['web']['volumes'])
        self.assertEqual(web['ports'], before['services']['web']['ports'])
        self.assertEqual(result['networks']['accounts'], {'name': policy.NETWORK, 'external': True})
        next_release = release.definition(result, 'new')
        self.assertEqual(policy.community_definition(next_release), next_release)

    def test_unknown_or_host_network_and_privileged_service_are_rejected(self):
        for key, value in [('network_mode', 'host'), ('privileged', True), ('cap_add', ['NET_ADMIN'])]:
            original = self.community()
            original['services']['web'][key] = value
            with self.assertRaises(AssertionError): policy.community_definition(original)
        original = self.community()
        original['services']['web']['networks']['extra'] = None
        with self.assertRaises(AssertionError): policy.community_definition(original)

    def test_upstream_keeps_its_existing_network_address_environment_and_ports(self):
        for name, (service, aliases) in policy.UPSTREAMS.items():
            original = {'services': {service: {'environment': {'SECRET': 'keep'}, 'ports': ['127.0.0.1:3000:3000'],
                        'networks': {'existing': {'aliases': ['old'], 'ipv4_address': '172.18.0.4'}}}},
                        'networks': {'existing': {'name': '1panel-network', 'external': True}}}
            before = copy.deepcopy(original)
            result = policy.upstream_definition(original, name)
            self.assertEqual(original, before)
            self.assertEqual(policy.upstream_definition(result, name), result)
            self.assertEqual(result['services'][service]['networks']['community_accounts']['aliases'], aliases)
            del result['services'][service]['networks']['community_accounts']
            del result['networks']['community_accounts']
            self.assertEqual(result, before)

    def test_untrusted_network_members_and_public_bridge_are_rejected(self):
        network = {'Name': policy.NETWORK, 'Driver': 'bridge', 'Internal': True, 'Containers': {}}
        policy.validate_network(network)
        network['Containers']['mysql'] = {'Name': 'ZY-mysql'}
        with self.assertRaises(AssertionError): policy.validate_network(network)
        network['Containers'] = {}
        network['Internal'] = False
        with self.assertRaises(AssertionError): policy.validate_network(network)

    def test_runtime_rejects_reenabled_mcp_shared_network_or_new_privileges(self):
        network = {'Name': policy.NETWORK, 'Driver': 'bridge', 'Internal': True,
                   'Containers': {n: {'Name': n} for n in [policy.WEB, *policy.UPSTREAMS]}}
        web = {'NetworkSettings': {'Networks': dict.fromkeys([policy.NETWORK, 'ai-community_database', 'ai-community_outbound'], {})},
               'Config': {'Env': ['ENABLE_MCP=false'], 'User': 'community'},
               'HostConfig': {'CapDrop': ['ALL'], 'SecurityOpt': ['no-new-privileges:true']},
               'Mounts': [{'Destination': '/app/.config', 'RW': False}, {'Destination': '/app/files', 'RW': True}]}
        mysql = {'NetworkSettings': {'Networks': {'1panel-network': {}}}}
        policy.validate_runtime(web, mysql, network)
        for change in ('mcp', 'network', 'cap', 'mount'):
            altered = copy.deepcopy(web)
            if change == 'mcp': altered['Config']['Env'] = ['ENABLE_MCP=true']
            if change == 'network': altered['NetworkSettings']['Networks']['1panel-network'] = {}
            if change == 'cap': altered['HostConfig']['CapDrop'] = []
            if change == 'mount': altered['Mounts'][0]['RW'] = True
            with self.assertRaises(AssertionError): policy.validate_runtime(altered, mysql, network)


if __name__ == '__main__':
    unittest.main()
