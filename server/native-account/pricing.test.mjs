import test from 'node:test'
import assert from 'node:assert/strict'
import { modelPriceRows } from './pricing.ts'

const status = { quota_display_type: 'CUSTOM', custom_currency_symbol: '积分', custom_currency_exchange_rate: 5000 }
const fixed = { model_name: 'gpt-image-2', enable_groups: ['default', '生图'], quota_type: 1, model_price: 0.25 }
const catalog = (model = fixed) => ({ data: [model], group_ratio: { default: 0.04, 生图: 0.6 }, auto_groups: ['default', '生图'] })

const videoSchema = { seconds: { type: 'number', unit: 'second' }, resolution: { enum: ['480p', '720p', '1080p'] }, input_images: { type: 'number', unit: 'count' } }
const provider = (billing_expr, plugin_name = 'Sora') => ({ plugin_name, billing_mode: 'tiered_expr', billing_expr, billing_usage_schema: videoSchema })
const videoCatalog = variants => ({ data: [{ model_name: 'grok-imagine-video-1.5', enable_groups: ['视频'],
  billing_mode: 'tiered_expr', billing_expr: 'tier("base", 0)', billing_usage_schema: videoSchema, billing_plugin_variants: variants }],
  group_ratio: { 视频: 1 }, auto_groups: ['视频'] })

test('video prices use every provider override in points instead of the zero model-level fallback', () => {
  const result = modelPriceRows(videoCatalog([
    provider('tier("base", u("input_images") * 0 + u("seconds") * 0.15)', 'xAI'),
    provider('tier("base", u("seconds") * 0.15)'),
  ]), status)
  assert.deepEqual(result.rows[0].videoRates, [
    { providerKey: '0', provider: 'xAI', perSecond: 750, perRequest: 0 }, { providerKey: '1', provider: 'Sora', perSecond: 750, perRequest: 0 },
  ])
  assert.match(result.rows[0].price, /750.*秒/)
  assert.equal(result.rows[0].requestPrice, undefined)
})

test('video resolution tiers keep their group multiplier, zero prices and fixed task charges', () => {
  const data = videoCatalog([provider('v1:u("resolution") == "480p" ? tier("low", u("seconds") * 0) : u("resolution") == "720p" ? tier("mid", 0.1 + u("seconds") * 0.32) : tier("high", u("seconds") * 0.65)')])
  data.group_ratio.视频 = 0.5
  assert.deepEqual(modelPriceRows(data, status).rows[0].videoRates, [
    { providerKey: '0', provider: 'Sora', resolution: '480p', perSecond: 0, perRequest: 0 },
    { providerKey: '0', provider: 'Sora', resolution: '720p', perSecond: 800, perRequest: 250 },
    { providerKey: '0', provider: 'Sora', resolution: '1080p', perSecond: 1625, perRequest: 0 },
  ])
})

test('reference video billing follows the executing plugin key without changing unit prices', () => {
  const expression = 'tier("base", u("seconds") * 0.15)'
  const variants = [
    { ...provider(expression, 'C兼容'), plugin_key: 'c-compatible' },
    { ...provider(expression, 'C兼容'), plugin_key: 'another-video' },
  ]
  const rates = modelPriceRows(videoCatalog(variants), status).rows[0].videoRates
  assert.deepEqual(rates, [
    { providerKey: '0', provider: 'C兼容', billReferenceVideo: true, perSecond: 750, perRequest: 0 },
    { providerKey: '1', provider: 'C兼容', perSecond: 750, perRequest: 0 },
  ])
})

test('unsupported or malformed provider charges never leave a partial video quote', () => {
  for (const expression of [
    'tier("base", u("seconds") * -1)', 'tier("base", u("seconds") * 0.15 + u("input_images") * 0.2)',
    'tier("base", u("unknown") * 0 + u("seconds") * 0.15)', 'tier("base", fixed(0.15))',
    'tier("base", u("seconds") * 0.15) ||| param("quality") == "high" => * 2',
    'tier("base", u("seconds") * Infinity)', 'tier("base", u("seconds") * 0.15) + malicious()',
    'u("resolution") == "720p" ? tier("x", u("seconds") * 0.15) : tier("x", u("tokens") * 2)',
  ]) {
    const row = modelPriceRows(videoCatalog([provider('tier("base", u("seconds") * 0.15)'), provider(expression, 'other')]), status).rows[0]
    assert.equal(row.videoRates, undefined, expression)
    assert.equal(row.requestPrice, undefined, expression)
  }
  const malformed = provider('tier("base", u("seconds") * 0.15)')
  malformed.billing_usage_schema = { seconds: { type: 'number', unit: 'token' } }
  assert.equal(modelPriceRows(videoCatalog([malformed]), status).rows[0].videoRates, undefined)
})

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
