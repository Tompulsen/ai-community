"""Compose integration for the private CPU moderation service; no deployment side effects."""
import copy
import re

NETWORK = 'ai-community_moderation'
CONTAINER = 'ai-community-moderation-1'
WEB = 'ai-community-web-1'
URL = 'http://moderation:8080'


def definition(original, image, token):
    assert re.fullmatch(r'ghcr\.io/tompulsen/ai-community-moderation@sha256:[a-f0-9]{64}', image), 'Pin the verified moderation image'
    assert re.fullmatch(r'[a-f0-9]{64}', token), 'Use a private random 256-bit service token'
    result = copy.deepcopy(original)
    web = result['services']['web']
    assert set(web['networks']) in ({'accounts', 'database', 'outbound'}, {'accounts', 'database', 'outbound', 'moderation'})
    network = {'name': NETWORK, 'internal': True}
    assert result.get('networks', {}).get('moderation', network) == network, 'Unexpected moderation network'
    result['networks']['moderation'] = network
    web['networks']['moderation'] = {'gw_priority': -1}
    web['environment'].update(COMMUNITY_MODERATION_URL=URL, COMMUNITY_MODERATION_TOKEN=token)
    service = {
        'image': image, 'container_name': CONTAINER, 'restart': 'unless-stopped',
        'user': '10001:10001', 'read_only': True, 'tmpfs': ['/tmp:rw,noexec,nosuid,size=67108864'],
        'environment': {'COMMUNITY_MODERATION_TOKEN': token, 'PYTHONDONTWRITEBYTECODE': '1'},
        'networks': {'moderation': {'aliases': ['moderation'], 'gw_priority': -1}},
        'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
        'cpus': 2.0, 'mem_limit': '1536m', 'pids_limit': 96, 'stop_grace_period': '40s',
        'logging': {'driver': 'json-file', 'options': {'max-size': '10m', 'max-file': '2'}},
    }
    existing = result['services'].get('moderation')
    if existing:
        # Updating a known image is allowed; unrelated existing service settings are not discarded.
        prior = copy.deepcopy(existing)
        prior['image'] = image
        prior['environment']['COMMUNITY_MODERATION_TOKEN'] = token
        assert prior == service, 'Existing moderation service differs; review before replacing'
    result['services']['moderation'] = service
    validate_definition(result)
    return result


def validate_definition(compose):
    service = compose['services']['moderation']
    web = compose['services']['web']
    assert compose['networks']['moderation'] == {'name': NETWORK, 'internal': True}
    assert set(service['networks']) == {'moderation'}, 'Moderation must have no outbound/database/account network'
    assert service['networks']['moderation'].get('gw_priority') == -1
    assert web['networks']['moderation'].get('gw_priority') == -1
    assert service.get('container_name') == CONTAINER
    assert not any(service.get(key) for key in ('ports', 'volumes', 'network_mode', 'privileged', 'cap_add'))
    assert service['user'] == '10001:10001' and service['read_only'] is True
    assert 'ALL' in service['cap_drop'] and 'no-new-privileges:true' in service['security_opt']
    assert 0 < float(service['cpus']) <= 2 and service['mem_limit'] == '1536m'
    assert 0 < int(service['pids_limit']) <= 96
    env = web['environment']
    assert env.get('COMMUNITY_MODERATION_URL') == URL
    assert re.fullmatch(r'[a-f0-9]{64}', env.get('COMMUNITY_MODERATION_TOKEN', ''))
    assert env['COMMUNITY_MODERATION_TOKEN'] == service['environment'].get('COMMUNITY_MODERATION_TOKEN')
    assert re.fullmatch(r'ghcr\.io/tompulsen/ai-community-moderation@sha256:[a-f0-9]{64}', service['image'])


def validate_runtime(web, service, network):
    assert network['Name'] == NETWORK and network['Driver'] == 'bridge' and network['Internal'] is True
    assert {item['Name'] for item in network['Containers'].values()} == {WEB, CONTAINER}
    assert set(service['NetworkSettings']['Networks']) == {NETWORK}
    assert service['Name'].lstrip('/') == CONTAINER
    host = service['HostConfig']
    assert not host.get('PortBindings') and not host.get('Binds') and not host.get('Privileged') and not host.get('CapAdd')
    assert 'ALL' in host['CapDrop'] and 'no-new-privileges:true' in host['SecurityOpt']
    assert host['ReadonlyRootfs'] and 0 < host['Memory'] <= 1536 * 1024 * 1024
    assert 0 < host['NanoCpus'] <= 2_000_000_000 and 0 < host['PidsLimit'] <= 96
    assert service['Config']['User'] == '10001:10001'
    assert service['State']['Running'] and service['State']['Health']['Status'] == 'healthy'
    web_env = dict(value.split('=', 1) for value in web['Config']['Env'] if '=' in value)
    service_env = dict(value.split('=', 1) for value in service['Config']['Env'] if '=' in value)
    assert web_env.get('COMMUNITY_MODERATION_URL') == URL
    assert web_env.get('COMMUNITY_MODERATION_TOKEN') == service_env.get('COMMUNITY_MODERATION_TOKEN')
    assert re.fullmatch(r'[a-f0-9]{64}', web_env.get('COMMUNITY_MODERATION_TOKEN', ''))
