import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'
import type { Creator } from '../src/data'

const creator: Creator = {
  id: '3', accountId: '3', username: 'root', name: '章鱼创作者',
  bio: '图片与视频创作', count: 0, followed: false, followersCount: 2, followingCount: 2,
}
const second: Creator = {
  id: '42', accountId: '42', username: 'ocean-creator', name: '另一位创作者',
  bio: '', count: 0, followed: false,
}
const legacy: Creator = {
  id: 'legacy-local-user', username: 'legacy_user', name: '未绑定的旧创作者',
  bio: '', count: 0, followed: false,
}

async function mockCreators(page: Page, authenticated = false) {
  const fixture = await mockUnifiedAccount(page, authenticated)
  await page.route('**/api/creators', route => route.fulfill({ json: { items: [creator, second, legacy] } }))
  await page.route('**/api/users/**', route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/followers') || path.endsWith('/following')) return route.fulfill({ json: { items: [second, legacy], nextCursor: null } })
    return route.fulfill({ json: { user: path.endsWith(`/${legacy.id}`) ? legacy : path.endsWith(`/${second.id}`) ? second : creator } })
  })
  return fixture
}

test('guests see the real Octopus identity in creator cards, public profiles and follower lists on desktop and phone', async ({ page }) => {
  const fixture = await mockCreators(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await mkdir('.impeccable/review/creator-identity', { recursive: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await page.goto('/community')
    await expect(page.locator('.creator-name > .caption-5')).toHaveText(['账号ID:3 @root', '账号ID:42 @ocean-creator', '@legacy_user'])
    const rootLink = page.locator('.creator-card').filter({ hasText: '账号ID:3 @root' }).getByRole('link')
    await expect(rootLink).toHaveAttribute('href', `/community?creator=${creator.id}`)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.impeccable/review/creator-identity/cards-${width}.png`, fullPage: true })
    await rootLink.click()
    await expect(page).toHaveURL(`/community?creator=${creator.id}`)
    await expect(page.locator('.profile-copy > .caption-5')).toHaveText('账号ID:3 @root')
    await expect(page.locator('.community-page')).not.toContainText('na_')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.impeccable/review/creator-identity/profile-${width}.png`, fullPage: true })
    for (const name of ['粉丝 · 2', '关注 · 2']) {
      await page.getByRole('button', { name, exact: true }).click()
      await expect(page.locator('.person-identity .caption-5')).toHaveText(['账号ID:42 @ocean-creator', '@legacy_user'])
      await expect(page.locator('.person-identity').first()).toHaveAttribute('href', `/community?creator=${second.id}`)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.screenshot({ path: `.impeccable/review/creator-identity/people-${width}.png`, fullPage: true })
  }
  expect(fixture.state.authenticated).toBe(false)
  expect(errors).toEqual([])
})

test('viewing another account uses its Octopus ID for profile, message and follow references', async ({ page }) => {
  const fixture = await mockCreators(page, true)
  await page.goto(`/community?creator=${creator.id}`)
  await expect(page.locator('.profile-copy > .caption-5')).toHaveText('账号ID:3 @root')
  await expect(page.locator('.profile-actions').getByRole('link', { name: '私信', exact: true })).toHaveAttribute('href', `/messages/${creator.id}`)
  await page.locator('.profile-actions').getByRole('button', { name: '关注', exact: true }).click()
  await expect(page.locator('.profile-actions').getByRole('button', { name: '已关注', exact: true })).toBeVisible()
  expect(fixture.mutations.find(item => item.path.endsWith('/follow'))).toMatchObject({
    path: `/api/users/${creator.id}/follow`, body: { active: true },
  })
  await expect(page).toHaveURL(`/community?creator=${creator.id}`)
})

test('unlinked legacy profiles retain their original username without inventing an account number', async ({ page }) => {
  await mockCreators(page)
  await page.goto(`/community?creator=${legacy.id}`)
  await expect(page.locator('.profile-copy > .caption-5')).toHaveText('@legacy_user')
  await expect(page.locator('.profile-copy')).not.toContainText('账号ID:')
  await expect(page).toHaveURL(`/community?creator=${legacy.id}`)
})

test('linked accounts awaiting a verified username show only their account number on every public identity line', async ({ page }) => {
  await mockCreators(page)
  const pending: Creator = { ...second, id: '7', accountId: '7', username: '', name: '待同步的创作者', followersCount: 1, followingCount: 1 }
  await page.route('**/api/creators', route => route.fulfill({ json: { items: [pending] } }))
  await page.route('**/api/users/**', route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ json: path.endsWith('/followers') || path.endsWith('/following') ? { items: [pending], nextCursor: null } : { user: pending } })
  })
  await page.goto('/community')
  await expect(page.locator('.creator-name > .caption-5')).toHaveText('账号ID:7')
  await page.locator('.creator-card').getByRole('link').click()
  await expect(page.locator('.profile-copy > .caption-5')).toHaveText('账号ID:7')
  for (const name of ['粉丝 · 1', '关注 · 1']) {
    await page.getByRole('button', { name, exact: true }).click()
    await expect(page.locator('.person-identity .caption-5')).toHaveText('账号ID:7')
  }
})
