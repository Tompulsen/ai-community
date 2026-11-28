import { expect, test } from 'vitest'
import { displayWalletQuota } from '../shared/studio/wallet'

const display = { quotaDisplayType: 'CUSTOM', quotaPerUnit: 500000, creditExchangeRate: 1, currencySymbol: '✦' }

test('account balance follows New API quota, currency and exchange rate without using point totals', () => {
  expect(displayWalletQuota(3241455000, display)).toBe('✦ 6,482.91')
  expect(displayWalletQuota(500000, { ...display, quotaDisplayType: 'CNY', creditExchangeRate: 7, currencySymbol: '¥' })).toBe('¥ 7')
  expect(displayWalletQuota(625000, { ...display, quotaDisplayType: 'USD', currencySymbol: '$' })).toBe('$ 1.25')
  expect(displayWalletQuota(0, display)).toBe('✦ 0')
  expect(displayWalletQuota(-625000, display)).toBe('✦ -1.25')
  expect(displayWalletQuota(1, display)).toBe('✦ 0.0001')
  expect(displayWalletQuota(12345, { ...display, quotaDisplayType: 'TOKENS' })).toBe('12,345 tokens')
})

test('missing or invalid display settings never become a plausible balance', () => {
  for (const invalid of [{ quotaPerUnit: 0 }, { quotaPerUnit: NaN }, { creditExchangeRate: 0 }, { creditExchangeRate: Infinity }, { currencySymbol: '' }, { quotaDisplayType: 'unknown' }]) {
    expect(displayWalletQuota(3241455000, { ...display, ...invalid })).toBeNull()
  }
  expect(displayWalletQuota(NaN, display)).toBeNull()
  expect(displayWalletQuota(Number.MAX_SAFE_INTEGER + 1, display)).toBeNull()
})
