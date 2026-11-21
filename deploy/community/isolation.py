"""Community network policy and read-only verification; never authenticate to MySQL."""
import copy
import json
import subprocess
from pathlib import Path

NETWORK = 'ai-community_accounts'
WEB = 'ai-community-web-1'
UPSTREAMS = {
    'ZY-newapi': ('new-api', ['1panel-new-api-a8pv']),
    'ZY-redis': ('redis', ['zy-redis']),
    'ZY-image-async': ('image-async', ['image-async']),
}


def community_definition(original):
    result = copy.deepcopy(original)
    web = result['services']['web']
    assert set(web['networks']) == {'accounts', 'database', 'outbound'}, 'Unexpected web networks'
    assert result['networks']['accounts']['name'] in ('1panel-network', NETWORK)
    assert result['networks']['database'].get('internal') is True
    assert not web.get('privileged') and not web.get('network_mode') and not web.get('cap_add')
    result['networks']['accounts'] = {'name': NETWORK, 'external': True}
    web['environment']['ENABLE_MCP'] = 'false'
    web['cap_drop'] = sorted(set(web.get('cap_drop', [])) | {'ALL'})
    security = web.setdefault('security_opt', [])
    assert not any(x.startswith('no-new-privileges') and x != 'no-new-privileges:true' for x in security)
    if 'no-new-privileges:true' not in security:
        security.append('no-new-privileges:true')
    return result


def upstream_definition(original, name):
    result = copy.deepcopy(original)
    service, aliases = UPSTREAMS[name]
    upstream = result['services'][service]
    assert not upstream.get('network_mode'), 'Upstream must use a bridge'
    networks = upstream['networks']
    assert isinstance(networks, dict), 'Use normalized Compose network mappings'
    key = 'community_accounts'
    desired = {'aliases': aliases, 'gw_priority': -1}
    assert key not in networks or networks[key] == desired, 'Conflicting upstream network'
    definition = {'name': NETWORK, 'external': True}
    top = result.setdefault('networks', {})
    assert key not in top or top[key] == definition, 'Conflicting network definition'
    networks[key] = desired
    top[key] = definition
    return result


def validate_network(network):
    assert network['Name'] == NETWORK and network['Driver'] == 'bridge'
    assert network['Internal'] is True, 'Account network must not supply an Internet gateway'
    members = {x['Name'] for x in network.get('Containers', {}).values()}
    assert members <= {WEB, *UPSTREAMS}, 'Unexpected member in private account network'


def validate_runtime(web, mysql, network):
    validate_network(network)
    assert set(web['NetworkSettings']['Networks']) == {NETWORK, 'ai-community_database', 'ai-community_outbound'}
    assert not set(web['NetworkSettings']['Networks']) & set(mysql['NetworkSettings']['Networks'])
    env = dict(v.split('=', 1) for v in web['Config']['Env'] if '=' in v)
    assert env.get('ENABLE_MCP') == 'false', 'MCP must remain explicitly disabled'
    assert 'ALL' in (web['HostConfig'].get('CapDrop') or [])
    assert 'no-new-privileges:true' in (web['HostConfig'].get('SecurityOpt') or [])
    assert not web['HostConfig'].get('Privileged') and not web['HostConfig'].get('CapAdd')
    assert web['Config']['User'] in ('community', '991', '991:991'), 'Web must run unprivileged'
    for mounts in web['Mounts']:
        assert mounts['Destination'] in ('/app/.config', '/app/files'), 'Unexpected secret or host mount'
        assert mounts['Destination'] != '/app/.config' or not mounts['RW']
    members = {x['Name'] for x in network['Containers'].values()}
    assert members == {WEB, *UPSTREAMS}, 'Missing account dependency'


def execute(args):
    result = subprocess.run(args, capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError(f'{args[0]} {args[1]} failed (exit {result.returncode})')
    return result.stdout


def upstream_compose(container):
    files = container['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
    # Inactive profiles still own live containers and must keep their isolation settings.
    command = ['docker', 'compose', '--profile', '*']
    for file in files:
        command.extend(['-f', file])
    return json.loads(execute(command + ['config', '--format', 'json']))


def verify():
    items = json.loads(execute(['docker', 'inspect', WEB, 'ZY-mysql', *UPSTREAMS]))
    inventory = {x['Name'].lstrip('/'): x for x in items}
    network = json.loads(execute(['docker', 'network', 'inspect', NETWORK]))[0]
    validate_runtime(inventory[WEB], inventory['ZY-mysql'], network)
    compose = json.loads(Path('/opt/ai-community-next/deploy/compose.json').read_bytes())
    assert community_definition(compose) == compose, 'Community Compose policy drift'
    for name, (service, aliases) in UPSTREAMS.items():
        container = inventory[name]
        assert set(aliases) <= set(container['NetworkSettings']['Networks'][NETWORK]['Aliases'] or [])
        definition = upstream_compose(container)
        assert definition['services'][service]['networks']['community_accounts']['aliases'] == aliases
        assert definition['services'][service]['networks']['community_accounts']['gw_priority'] == -1
        assert definition['networks']['community_accounts']['name'] == NETWORK
        assert definition['networks']['community_accounts']['external'] is True
    mysql_ip = inventory['ZY-mysql']['NetworkSettings']['Networks']['1panel-network']['IPAddress']
    # Refusing known live database IPs matters: a DNS lookup failure alone proves no isolation.
    targets = [{'name': 'mysql-direct', 'host': mysql_ip, 'port': 3306, 'allowed': False},
               {'name': 'mysql-x', 'host': mysql_ip, 'port': 33060, 'allowed': False},
               {'name': 'container-loopback', 'host': '127.0.0.1', 'port': 3306, 'allowed': False},
               {'name': 'host-shared-bridge', 'host': '172.18.0.1', 'port': 3306, 'allowed': False},
               {'name': 'host-outbound-bridge', 'host': '172.21.0.1', 'port': 3306, 'allowed': False},
               {'name': 'account-api', 'host': '1panel-new-api-a8pv', 'port': 3000, 'allowed': True},
               {'name': 'account-sessions', 'host': 'zy-redis', 'port': 6379, 'allowed': True},
               {'name': 'image-async', 'host': 'image-async', 'port': 8000, 'allowed': True},
               {'name': 'community-db', 'host': 'db', 'port': 5432, 'allowed': True},
               {'name': 'community-redis', 'host': 'ai-community-redis-1', 'port': 6379, 'allowed': True}]
    probe = '''const net=require('node:net');
const results=await Promise.all(targets.map(t=>new Promise(resolve=>{
 const s=net.createConnection({host:t.host,port:t.port});let done=false;
 const finish=state=>{if(done)return;done=true;s.destroy();resolve({name:t.name,state,passed:(state==='open')===t.allowed})};
 s.once('connect',()=>finish('open'));s.once('error',e=>finish(e.code));s.setTimeout(1800,()=>finish('timeout'));
})));console.log(JSON.stringify(results));'''
    code = '(async()=>{const targets=' + json.dumps(targets) + ';' + probe + '})()'
    results = json.loads(execute(['docker', 'exec', WEB, 'node', '-e', code]))
    assert all(x['passed'] for x in results), 'Dependency or database isolation check failed: ' + json.dumps(results)
    application = '''
const {getNewApiRedis,closeNewApiRedis}=await import('./server/native-account/session.ts');
const checks=[];
try {
 if(await getNewApiRedis().ping()!=='PONG')throw new Error('Account Redis PING failed');
 checks.push({name:'account-session-redis',result:'PONG'});
 for(const [name,url] of [['account-status',process.env.NEW_API_BASE_URL+'/api/status'],
   ['image-health',process.env.NEW_API_IMAGE_BASE_URL+'/healthz'],
   ['public-account',process.env.NEW_API_PUBLIC_URL+'/api/status']]) {
   const response=await fetch(url,{signal:AbortSignal.timeout(8000)});
   const body=await response.json();
   if(!response.ok || (name!=='image-health' && body.success!==true))throw new Error(name+' failed');
   checks.push({name,status:response.status});
 }
 console.log(JSON.stringify(checks));
} finally {await closeNewApiRedis();}
'''
    application_checks = json.loads(execute(['docker', 'exec', '-w', '/app', WEB, 'node', '--input-type=module', '-e', application]))
    return {'network': NETWORK, 'mcpDisabled': True, 'unprivileged': True, 'composePersisted': True,
            'connectivity': results, 'application': application_checks, 'mysqlAuthenticationAttempts': 0, 'mysqlQueries': 0}


if __name__ == '__main__':
    print(json.dumps(verify(), indent=2))
