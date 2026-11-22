import assert from 'node:assert/strict'
import test from 'node:test'
import { handleLottery } from './lottery.ts'

function fixture(balance, query = '') {
  const reads = [], responses = []
  const ctx = {
    url: new URL('https://community.test/api/lottery/balance' + query),
    req: { method: 'GET', headers: { 'x-new-api-user': 'owner' } },
    requireUser: () => ({ id: 'owner' }),
    db: { async query(sql, params) {
      assert.equal(sql, 'SELECT balance FROM community_lottery_account WHERE "userId"=$1')
      assert.deepEqual(params, ['owner']); reads.push(params)
      return { rows: balance === undefined ? [] : [{ balance }] }
    } },
    json: (status, value) => responses.push({ status, value }),
  }
  return { ctx, reads, responses }
}

test('navigation only reads the signed-in users credited balance without syncing rewards', async () => {
  for (const balance of [0, 1, 120, 2147483647]) {
    const { ctx, reads, responses } = fixture(balance)
    assert.equal(await handleLottery(ctx), true)
    assert.equal(reads.length, 1)
    assert.deepEqual(responses, [{ status: 200, value: { userId: 'owner', balance } }])
  }
})

test('an account without lottery history returns zero without creating account rows', async () => {
  const { ctx, responses } = fixture()
  await handleLottery(ctx)
  assert.equal(responses[0].value.balance, 0)
})

test('anonymous and mismatched account requests stop before the balance query', async () => {
  const { ctx, reads } = fixture(8)
  ctx.req.headers['x-new-api-user'] = 'other'
  await assert.rejects(handleLottery(ctx), error => error.message === 'LOTTERY_ACCOUNT_CHANGED' && error.statusCode === 409)
  ctx.requireUser = () => { throw new Error('AUTH_REQUIRED') }
  await assert.rejects(handleLottery(ctx), /AUTH_REQUIRED/)
  assert.equal(reads.length, 0)
})

test('user selectors cannot read someone elses chances, and database failures do not become zero', async () => {
  const { ctx, reads, responses } = fixture(8, '?userId=other')
  await assert.rejects(handleLottery(ctx), /LOTTERY_INVALID/)
  assert.equal(reads.length, 0)
  ctx.url.search = ''
  ctx.db.query = async () => { throw new Error('offline') }
  await assert.rejects(handleLottery(ctx), /offline/)
  assert.equal(responses.length, 0)
})
