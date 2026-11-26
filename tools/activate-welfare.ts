// Run only after the new web has taken over and all previous web workers have exited.
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import pg from 'pg'
import { createLotteryService } from '../server/lottery.ts'
import type { AppConfig } from '../server/types.ts'

if (process.argv[2] !== '--old-workers-stopped') throw new Error('Verify deployment completion before activating welfare points')
const config = parse(await readFile(process.env.CONFIG_PATH || '.config/default.yml', 'utf8')) as AppConfig
const db = new pg.Pool({ host: config.db.host, port: config.db.port || 5432, user: config.db.user, password: config.db.pass,
  database: config.db.db, max: 1, connectionTimeoutMillis: 8000, statement_timeout: 15000 })
try { console.log(JSON.stringify(await createLotteryService({ db, config }).activateWelfare())) }
finally { await db.end() }
