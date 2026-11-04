"""Create deployment configuration without placing credentials in source files."""
from pathlib import Path
import argparse, json, re, secrets, os

parser = argparse.ArgumentParser()
parser.add_argument('--admin-file', required=True)
parser.add_argument('--domain', default='zaiduyu.top')
args = parser.parse_args()
if not re.fullmatch(r'[a-z0-9.-]+', args.domain):
    raise SystemExit('Invalid domain')
private = Path(__file__).resolve().parent / 'private'
config = private / 'config'
config.mkdir(parents=True, exist_ok=True)
if (config / 'default.yml').exists():
    raise SystemExit('Existing deployment configuration preserved; refusing to rotate credentials.')
source = Path(args.admin_file).read_text(encoding='utf-8-sig')
values = {k.strip(): v.strip() for k,v in re.findall(r'^([^\n:：]+)[:：](.*)$', source, re.M)}
username = values.get('账户', values.get('账号', ''))
password = values.get('密码', '')
if not re.fullmatch(r'[A-Za-z0-9_]{1,20}', username) or not password:
    raise SystemExit('Administrator file must contain a valid username and password.')
db_password = secrets.token_hex(32)
setup_password = secrets.token_hex(32)
(private / 'database.env').write_text(f'POSTGRES_DB=community\nPOSTGRES_USER=community\nPOSTGRES_PASSWORD={db_password}\n', encoding='utf-8')
(config / 'default.yml').write_text(f'''url: https://{args.domain}/
port: 3000
setupPassword: {setup_password}
db:
  host: db
  port: 5432
  db: community
  user: community
  pass: {db_password}
  extra:
    max: 10
redis:
  host: redis
  port: 6379
id: aidx
proxyBypassHosts: []
fulltextSearch:
  provider: sqlLike
clusterLimit: 1
maxFileSize: 52428800
''', encoding='utf-8')
(private / 'bootstrap.json').write_text(json.dumps({'username': username, 'password': password, 'setupPassword': setup_password}, ensure_ascii=False), encoding='utf-8')
for file in private.rglob('*'):
    if file.is_file():
        os.chmod(file, 0o600)
print('Private database configuration and administrator bootstrap prepared; no credentials printed.')
