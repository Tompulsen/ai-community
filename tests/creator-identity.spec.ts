import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'
import type { Creator, Work } from '../src/data'

type ProfileCreator = Creator & { receivedLikesCount?: number }
const screenshotDirectory = '.impeccable/review/profile-layout'
const creator: ProfileCreator = {
  id: '3', username: 'root', name: '章鱼创作者',
  bio: '图片与视频创作', count: 1, followed: false, followersCount: 2, followingCount: 2,
  receivedLikesCount: 38, avatarUrl: '/assets/brand/octopus-community.jpg',
}
const second: Creator = {
  id: '42', username: 'ocean-creator', name: '另一位创作者',
  bio: '', count: 0, followed: false,
}
const third: Creator = {
  id: '7', username: 'river-creator', name: '河流创作者',
  bio: '', count: 0, followed: false,
}

function work(id: string, title: string, authorId: string): Work {
  return {
    id, title, authorId, version: 1, fileIds: [], author: '创作者', avatar: '创', kind: 'image',
    cover: '/assets/brand/octopus-community.jpg', coverAspectRatio: 1, tags: [], prompt: '', model: 'fixture',
    likes: 1, date: '2026-11-13T00:00:00Z', owned: authorId === '3', liked: id === 'liked-work',
    saved: id === 'saved-work', status: 'published',
  }
}
const contentTab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).or(page.getByRole('button', { name, exact: true }))
const profileIdentity = (page: Page) => page.locator('.profile-copy > .caption-5, .profile-account-id')
const peopleDialog = (page: Page) => page.locator('dialog[aria-labelledby="profile-people-heading"]')

async function mockCreators(page: Page, currentId = '', patch: Partial<ProfileCreator> = {}) {
  const fixture = await mockUnifiedAccount(page, Boolean(currentId))
  if (currentId) {
    fixture.state.user.id = currentId
    fixture.state.user.accountId = currentId
    fixture.state.user.username = currentId === '3' ? 'root' : 'ocean-creator'
  }
  const profile: ProfileCreator = { ...creator, ...patch }
  const reads: URL[] = []
  const publicWork = work('public-work', '公开创作作品', '3')
  const savedWork = work('saved-work', '收藏的作品', '42')
  const likedWork = work('liked-work', '喜欢的作品', '7')
  await page.route('**/api/creators', route => route.fulfill({ json: { items: [profile, second, third] } }))
  await page.route('**/api/works?**', route => {
    if (route.request().method() !== 'GET') return route.fallback()
    reads.push(new URL(route.request().url()))
    return route.fulfill({ json: { items: [publicWork], nextCursor: null } })
  })
  await page.route('**/api/library**', route => {
    const url = new URL(route.request().url())
    reads.push(url)
    return route.fulfill({ json: { items: [url.searchParams.get('tab') === 'saved' ? savedWork : likedWork], nextCursor: null } })
  })
  await page.route('**/api/users/**', route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const url = new URL(route.request().url()), path = url.pathname
    reads.push(url)
    if (path.endsWith('/followers') || path.endsWith('/following')) {
      const direction = path.endsWith('/followers') ? 'followers' : 'following'
      const appended = url.searchParams.has('cursor')
      const first = direction === 'followers' ? second : third, last = direction === 'followers' ? third : second
      return route.fulfill({ json: { items: [appended ? last : first], nextCursor: appended ? null : `${direction}-next` } })
    }
    return route.fulfill({ json: { user: [profile, second, third].find(person => path.endsWith(`/${person.id}`)) || profile } })
  })
  return { ...fixture, reads, profile, publicWork, savedWork, likedWork }
}

test('guests see numeric account IDs without handles in creator cards, profiles and people dialogs', async ({ page }) => {
  const fixture = await mockCreators(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await mkdir(screenshotDirectory, { recursive: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await page.goto('/community')
    await expect(page.locator('.creator-name > .caption-5')).toHaveText(['账号ID:3', '账号ID:42', '账号ID:7'])
    const rootLink = page.locator('.creator-card').filter({ hasText: '账号ID:3' }).getByRole('link')
    await expect(rootLink).toHaveAttribute('href', `/community?creator=${creator.id}`)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${screenshotDirectory}/cards-${width}.png`, fullPage: true })
    await rootLink.click()
    await expect(page).toHaveURL(`/community?creator=${creator.id}`)
    await expect(profileIdentity(page)).toHaveText('账号ID:3')
    await expect(page.locator('.profile-copy h1')).toHaveText('root')
    await expect(page.getByRole('link', { name: '编辑资料', exact: true })).toHaveCount(0)
    await expect(page.locator('.community-page')).not.toContainText('na_')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${screenshotDirectory}/profile-${width}.png`, fullPage: true })
    for (const [name, expectedId, title] of [['查看粉丝', '42', '粉丝'], ['查看关注', '7', '关注']]) {
      await page.getByRole('button', { name, exact: true }).click()
      const dialog = peopleDialog(page)
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeVisible()
      await expect(dialog.locator('.person-identity .caption-5')).toHaveText([`账号ID:${expectedId}`])
      await expect(dialog.locator('.person-identity').first()).toHaveAttribute('href', `/community?creator=${expectedId}`)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `${screenshotDirectory}/${title === '粉丝' ? 'followers' : 'following'}-${width}.png`, fullPage: true })
      await dialog.getByRole('button', { name: '关闭列表', exact: true }).click()
      await expect(dialog).not.toBeVisible()
    }
  }
  expect(fixture.state.authenticated).toBe(false)
  expect(errors).toEqual([])
})

test('the current account can edit its profile and switch between works, saved works and liked works', async ({ page }) => {
  const fixture = await mockCreators(page, '3', { isSelf: false })
  await page.goto('/community?creator=3')
  await expect(page.locator('.profile-copy h1')).toHaveText('root')
  await expect(profileIdentity(page)).toHaveText('账号ID:3')
  await expect(page.getByRole('link', { name: '编辑资料', exact: true })).toHaveAttribute('href', '/account?tab=profile')
  await expect(page.getByRole('button', { name: '查看关注', exact: true })).toContainText('2')
  await expect(page.getByRole('button', { name: '查看粉丝', exact: true })).toContainText('2')
  await expect(page.getByText(/收获点赞\s*38/)).toBeVisible()
  await expect(page.getByRole('link', { name: fixture.publicWork.title, exact: true })).toBeVisible()
  expect(fixture.reads.filter(url => url.pathname === '/api/library')).toHaveLength(0)
  await contentTab(page, '收藏').click()
  await expect(page.getByRole('link', { name: fixture.savedWork.title, exact: true })).toBeVisible()
  await contentTab(page, '喜欢').click()
  await expect(page.getByRole('link', { name: fixture.likedWork.title, exact: true })).toBeVisible()
  await contentTab(page, '作品').click()
  await expect(page.getByRole('link', { name: fixture.publicWork.title, exact: true })).toBeVisible()
  expect(fixture.reads.filter(url => url.pathname === '/api/library').map(url => url.searchParams.get('tab'))).toEqual(['saved', 'liked'])
  expect(fixture.reads.some(url => url.pathname === '/api/works' && url.searchParams.get('authorId') === '3')).toBe(true)
})

for (const currentId of ['', '42']) {
  test(`${currentId ? 'another signed-in user' : 'a guest'} cannot load private saved or liked works from a public profile`, async ({ page }) => {
    const fixture = await mockCreators(page, currentId, { isSelf: true })
    await page.goto('/community?creator=3')
    await expect(page.getByRole('link', { name: '编辑资料', exact: true })).toHaveCount(0)
    await contentTab(page, '收藏').click()
    await expect(page.getByText('收藏仅本人可见', { exact: true })).toBeVisible()
    await contentTab(page, '喜欢').click()
    await expect(page.getByText('喜欢仅本人可见', { exact: true })).toBeVisible()
    expect(fixture.reads.filter(url => url.pathname === '/api/library')).toHaveLength(0)
    await expect(profileIdentity(page)).toHaveText('账号ID:3')
  })
}

test('people dialogs preserve pagination and reset the list when switching from followers to following', async ({ page }) => {
  const fixture = await mockCreators(page, '3')
  await page.goto('/community?creator=3')
  const dialog = peopleDialog(page)
  await page.getByRole('button', { name: '查看粉丝', exact: true }).click()
  await expect(dialog.locator('.person-identity .caption-5')).toHaveText(['账号ID:42'])
  await dialog.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(dialog.locator('.person-identity .caption-5')).toHaveText(['账号ID:42', '账号ID:7'])
  await expect(dialog.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: '关闭列表', exact: true }).click()
  await page.getByRole('button', { name: '查看关注', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: '关注', exact: true })).toBeVisible()
  await expect(dialog.locator('.person-identity .caption-5')).toHaveText(['账号ID:7'])
  await dialog.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(dialog.locator('.person-identity .caption-5')).toHaveText(['账号ID:7', '账号ID:42'])
  expect(fixture.reads.filter(url => url.searchParams.has('cursor')).map(url => url.searchParams.get('cursor'))).toEqual(['followers-next', 'following-next'])
})

test('profile avatars, usernames, IDs, descriptions and content tabs fit desktop and small phones', async ({ page }) => {
  const fixture = await mockCreators(page, '3', {
    username: 'studio_creator_42',
    bio: '分享图片和视频创作，记录从构思到作品发布的过程。欢迎交流镜头、色彩和提示词，持续整理每次创作的经验与灵感。',
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await mkdir(screenshotDirectory, { recursive: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await page.goto('/community?creator=3')
    const heading = page.locator('.profile-copy h1')
    await expect(heading).toHaveText(fixture.profile.username)
    await expect(profileIdentity(page)).toHaveText('账号ID:3')
    await expect(page.getByText(fixture.profile.bio, { exact: true })).toBeVisible()
    await expect(contentTab(page, '作品')).toBeVisible()
    await expect(contentTab(page, '收藏')).toBeVisible()
    await expect(contentTab(page, '喜欢')).toBeVisible()
    const avatar = page.locator('.profile-avatar, .creator-profile .avatar').first()
    await expect(avatar).toBeVisible()
    const avatarBounds = await avatar.boundingBox(), titleBounds = await heading.boundingBox()
    expect(avatarBounds!.width).toBe(width === 1440 ? 160 : 80)
    expect(avatarBounds!.height).toBe(width === 1440 ? 160 : 80)
    expect(avatarBounds!.x + avatarBounds!.width).toBeLessThanOrEqual(titleBounds!.x + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${screenshotDirectory}/layout-${width}.png`, fullPage: true })
  }
  expect(errors).toEqual([])
})
