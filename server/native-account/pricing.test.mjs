import test from 'node:test'
import assert from 'node:assert/strict'
import { modelPriceRows } from './pricing.ts'

const status = { quota_display_type: 'CUSTOM', custom_currency_symbol: '积分', custom_currency_exchange_rate: 5000 }
const fixed = { model_name: 'gpt-image-2', enable_groups: ['default', '生图'], quota_type: 1, model_price: 0.25 }
const catalog = (model = fixed) => ({ data: [model], group_ratio: { default: 0.04, 生图: 0.6 }, auto_groups: ['default', '生图'] })

test('fixed prices preserve numeric points with each personalized group ratio and routing order', () => {
  const result = modelPriceRows(catalog(), status)
  assert.deepEqual(result.autoGroups, ['default', '生图'])
  assert.equal(result.currency, '积分')
  assert.deepEqual(result.rows.map(row => [row.group, row.requestPrice, row.imageCountMultiplier]), [
    ['default', 50, true], ['生图', 750, true],
  ])
})

test('zero and fractional prices retain their complete precision', () => {
  const zero = modelPriceRows(catalog({ ...fixed, model_price: 0 }), status)
  assert.equal(zero.rows[0].requestPrice, 0)
  const price = 0.00000123456789
  const fractional = modelPriceRows(catalog({ ...fixed, model_price: price }), status)
  assert.equal(fractional.rows[0].requestPrice, price * 0.04 * 5000)
})

test('a fixed expression is a per-request charge and context tiers are not collapsed', () => {
  const model = { ...fixed, billing_mode: 'tiered_expr', billing_expr: 'tier("standard", fixed(0.25))' }
  const result = modelPriceRows(catalog(model), status)
  assert.equal(result.rows[0].requestPrice, 50)
  assert.equal(result.rows[0].imageCountMultiplier, false)
  const tiers = modelPriceRows(catalog({ ...model, billing_expr: 'len <= 100 ? tier("small", fixed(0.1)) : tier("big", fixed(0.5))' }), status)
  assert.equal(tiers.rows[0].requestPrice, undefined)
  assert.equal(tiers.rows[0].details.tiers.length, 2)
})

test('image token rates include image input and cache costs without a fabricated request total', () => {
  const result = modelPriceRows(catalog({ ...fixed, billing_mode: 'tiered_expr',
    billing_expr: 'tier("standard", p * 5 + cr * 1.25 + img * 8 + img_cr * 2 + c * 30)' }), status)
  assert.equal(result.rows[0].requestPrice, undefined)
  assert.equal(result.rows[0].details.unit, 'tokens')
  assert.deepEqual(result.rows[0].details.tiers[0].extras, [
    { label: '缓存读取', amount: '积分 250' },
    { label: '图片输入', amount: '积分 1,600' },
    { label: '图片缓存读取', amount: '积分 400' },
  ])
})

test('unknown charges, image_count expressions and plugins cannot yield partial numeric prices', () => {
  for (const model of [
    { ...fixed, billing_expr: 'tier("standard", p * 5 + c * 30 + mystery * 1)' },
    { ...fixed, billing_expr: 'tier("standard", fixed(0.25) * image_count)' },
    { ...fixed, billing_plugin_variants: [{ name: 'plugin' }] },
  ]) {
    const row = modelPriceRows(catalog(model), status).rows[0]
    assert.equal(row.billing, '动态计费')
    assert.equal(row.requestPrice, undefined)
    assert.equal(row.details, undefined)
  }
})

test('routing candidates are validated, deduplicated and never invented from global ratios', () => {
  assert.deepEqual(modelPriceRows({ ...catalog(), auto_groups: ['生图', '', 1, '生图', 'default'] }, status).autoGroups, ['生图', 'default'])
  assert.deepEqual(modelPriceRows({ ...catalog(), auto_groups: null }, status).autoGroups, [])
  assert.equal(modelPriceRows(catalog({ ...fixed, model_price: Number.MAX_VALUE }), status).rows[0].requestPrice, undefined)
})
