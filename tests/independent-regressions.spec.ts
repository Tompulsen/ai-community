import { expect, test, type Page } from '@playwright/test'
import type { Work } from '../src/data'

const origin = process.env.COMMUNITY_REGRESSION_ORIGIN || 'http://localhost:18775'
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
  throw new Error('Run these mocked tests against a local preview only.')
}
test.use({ baseURL: origin, serviceWorkers: 'block' })

const user = { id: 'regression-user', username: 'regression', name: '回归测试用户', bio: '', isAdmin: false, isModerator: false }
const work: Work = {
  id: 'regression-work', authorId: user.id, version: 7, fileIds: [],
  title: '回归测试作品', author: user.name, avatar: '回', kind: 'resource',
  cover: '', tags: [], prompt: '原始提示词', model: 'fixture-model',
  likes: 0, date: '2026-11-12T00:00:00Z', owned: true,
  liked: false, saved: false, status: 'published', body: '原始内容',
}

async function mockApp(page: Page, authenticated = false) {
  const unexpected: string[] = []
  // Fulfill every API request, including mutations, so no business request leaves the browser.
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== new URL(origin).origin) {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`)
      return route.abort()
    }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (request.method() === 'GET') {
      if (url.pathname === '/api/session') return route.fulfill({ json: { user: authenticated ? user : null, csrfToken: 'fixture-csrf' } })
      if (url.pathname === '/api/site') return route.fulfill({ json: { brand: '章鱼社区', logoUrl: '' } })
      if (url.pathname === '/api/works') return route.fulfill({ json: { items: [work], nextCursor: null } })
      if (url.pathname === `/api/works/${work.id}`) return route.fulfill({ json: { work } })
      if (['/api/tags', '/api/creators', '/api/announcements', '/api/community/ads', '/api/notifications', '/api/messages/threads', `/api/works/${work.id}/comments`].includes(url.pathname)) {
        return route.fulfill({ json: { items: [], nextCursor: null } })
      }
    }
    if (url.pathname === `/api/works/${work.id}/view` && request.method() === 'POST') {
      return route.fulfill({ json: { viewsCount: 1 } })
    }
    unexpected.push(`${request.method()} ${url.pathname}`)
    return route.fulfill({ status: 501, json: { error: 'Unexpected regression fixture request' } })
  })
  return unexpected
}

test('sort changes reach the API and replace the displayed results', async ({ page }) => {
  const unexpected = await mockApp(page, true)
  await page.route('**/api/works?*', async route => {
    const sort = new URL(route.request().url()).searchParams.get('sort')
    if (sort === 'following') return route.fulfill({ json: { items: [], nextCursor: null } })
    return route.fulfill({ json: { items: [{ ...work, title: sort === 'latest' ? '最新结果' : '精选结果' }], nextCursor: null } })
  })
  await page.goto('/discover')
  await expect(page.getByRole('link', { name: '精选结果', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '最新', exact: true }).click()
  await expect(page.getByRole('link', { name: '最新结果', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '精选结果', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '关注', exact: true }).click()
  await expect(page.getByRole('heading', { name: '还没有关注的作品', exact: true })).toBeVisible()
  await expect(page.locator('article.work-card')).toHaveCount(0)
  expect(unexpected).toEqual([])
})

test('pagination appends results and a new search discards the old cursor', async ({ page }) => {
  const unexpected = await mockApp(page)
  const queries: URLSearchParams[] = []
  await page.route('**/api/works?*', async route => {
    const params = new URL(route.request().url()).searchParams
    queries.push(params)
    const title = params.has('query') ? '筛选结果' : params.has('cursor') ? '第二页结果' : '第一页结果'
    return route.fulfill({ json: { items: [{ ...work, id: title, title }], nextCursor: title === '第一页结果' ? 'fixture-page-2' : null } })
  })
  await page.goto('/discover')
  await expect(page.getByRole('link', { name: '第一页结果', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(page.locator('article.work-card')).toHaveCount(2)
  expect(queries.some(params => params.get('cursor') === 'fixture-page-2')).toBe(true)
  await page.getByRole('button', { name: '展开搜索作品', exact: true }).click()
  await page.getByLabel('搜索作品', { exact: true }).fill('回归筛选')
  await expect(page.getByRole('link', { name: '筛选结果', exact: true })).toBeVisible()
  await expect(page.locator('article.work-card')).toHaveCount(1)
  const search = queries.find(params => params.get('query') === '回归筛选')
  expect(search).toBeDefined()
  expect(search!.has('cursor')).toBe(false)
  expect(unexpected).toEqual([])
})

test('community direct navigation and refresh preserve the announcements tab', async ({ page }) => {
  const unexpected = await mockApp(page)
  await page.route('**/api/announcements', route => route.fulfill({ json: {
    items: [{ id: 'fixture-news', title: '回归测试公告', body: '公告正文', date: '2026-11-12' }],
  } }))
  await page.goto('/community?tab=announcements')
  for (let pass = 0; pass < 2; pass++) {
    await expect(page).toHaveURL(/\/community\?tab=announcements$/)
    await expect(page.getByRole('heading', { name: '社区', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '社区公告', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.locator('summary').filter({ hasText: '回归测试公告' }).click()
    await expect(page.getByText('公告正文', { exact: true })).toBeVisible()
    if (pass === 0) await page.reload()
  }
  expect(unexpected).toEqual([])
})

test('draft conflict preserves every edited field and retries with version and CSRF', async ({ page }) => {
  const unexpected = await mockApp(page, true)
  const draft: Work = { ...work, status: 'draft', sourceUrl: 'https://example.invalid/original', license: 'CC0' }
  await page.route('**/api/library**', route => route.fulfill({ json: { items: [draft], nextCursor: null } }))
  const writes: { body: Record<string, unknown>; csrf: string | undefined }[] = []
  await page.route(`**/api/works/${work.id}`, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { work: draft } })
    if (route.request().method() !== 'PATCH') return route.fallback()
    writes.push({ body: route.request().postDataJSON(), csrf: route.request().headers()['x-csrf-token'] })
    return route.fulfill({ status: 409, json: { error: '作品已被修改，请刷新后重试。' } })
  })
  await page.goto('/library?tab=draft')
  await page.getByRole('button', { name: `编辑作品：${work.title}`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑作品', exact: true })
  await expect(dialog.getByLabel('作品标题', { exact: true })).toHaveValue(draft.title)
  const fields = {
    '作品标题': '保留的标题', '资源内容': '保留的资源正文', '生成提示词': '保留的提示词',
    '标签': '回归', '模型': '保留的模型', '来源链接': 'https://example.invalid/edited', '授权许可': 'CC-BY-4.0',
  }
  for (const [label, value] of Object.entries(fields)) await dialog.getByLabel(label, { exact: true }).fill(value)
  for (let attempt = 1; attempt <= 2; attempt++) {
    await dialog.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText('作品已被修改，请刷新后重试。')
    for (const [label, value] of Object.entries(fields)) await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(value)
    expect(writes).toHaveLength(attempt)
  }
  expect(writes[0]).toEqual({
    csrf: 'fixture-csrf',
    body: {
      title: fields['作品标题'], kind: 'resource', body: fields['资源内容'], prompt: fields['生成提示词'],
      tags: ['回归'], model: fields['模型'], sourceUrl: fields['来源链接'], license: fields['授权许可'],
      fileIds: [], referenceFileIds: [], version: 7, status: 'pending',
    },
  })
  expect(writes[1]).toEqual(writes[0])
  expect(unexpected).toEqual([])
})

for (const width of [1440, 390]) {
  test(`multiple attachments and reference previews work at ${width}px`, async ({ page }) => {
    const unexpected = await mockApp(page)
    await page.setViewportSize({ width, height: 900 })
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
    await page.route('**/regression-assets/*.png', route => route.fulfill({ contentType: 'image/png', body: png }))
    const files = ['first', 'second', 'reference'].map(id => ({ id, name: `${id}.png`, type: 'image/png', url: `/regression-assets/${id}.png` }))
    await page.route(`**/api/works/${work.id}`, route => route.fulfill({ json: {
      work: { ...work, kind: 'image', files: files.slice(0, 2), fileIds: ['first', 'second'], referenceFiles: files.slice(2) },
    } }))
    await page.goto(`/work/${work.id}`)
    const media = page.locator('.detail-media')
    await expect(media.getByRole('img', { name: 'first.png', exact: true })).toBeVisible()
    await expect.poll(() => media.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    await page.getByRole('button', { name: '下一个文件', exact: true }).click()
    await expect(media.getByRole('img', { name: 'second.png', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '下一个文件', exact: true }).click()
    await expect(media.getByRole('img', { name: 'first.png', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '预览 reference.png', exact: true }).click()
    await expect(media.getByRole('img', { name: 'reference.png', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '放大预览', exact: true }).click()
    const preview = page.getByRole('dialog', { name: '作品文件预览', exact: true })
    await expect(preview.getByRole('img', { name: 'reference.png', exact: true })).toBeVisible()
    await preview.getByRole('button', { name: '关闭预览', exact: true }).click()
    await expect(preview).not.toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(unexpected).toEqual([])
  })
}

test('new administrator sections use their real contracts and preserve a refused settings edit', async ({ page }) => {
  const unexpected = await mockApp(page, true)
  await page.route('**/api/session', route => route.fulfill({ json: { user: { ...user, isAdmin: true }, csrfToken: 'fixture-csrf' } }))
  const config = {
    communityPublicationMode: 'before', communityAutoBanEnabled: true, communityViolationThreshold: 3,
    communityFeedMode: 'shuffle', communityFeedPoolSize: 200, communityPullToRefresh: true,
    uploadLimits: { image: 20, video: 100, audio: 20, document: 20, other: 10 },
  }
  const writes: { body: Record<string, unknown>; csrf: string | undefined }[] = []
  await page.route('**/api/admin/**', route => {
    const request = route.request(), pathname = new URL(request.url()).pathname
    if (pathname === '/api/admin/submissions') return route.fulfill({ json: { items: [] } })
    if (pathname === '/api/admin/community/config') {
      if (request.method() === 'GET') return route.fulfill({ json: { config, version: 'config-v1' } })
      writes.push({ body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] })
      return route.fulfill({ status: 503, json: { error: '设置服务暂不可用' } })
    }
    if (pathname === '/api/admin/tags') return route.fulfill({ json: { items: [{ id: 'fixture-tag', category: 'image', name: '保留标签' }] } })
    if (pathname === '/api/admin/community/ads') return route.fulfill({ json: { items: [{ id: 'communityAd1', enabled: false, title: '', imageUrl: '', linkUrl: '' }], version: 'ads-v1' } })
    if (pathname === '/api/admin/users') return route.fulfill({ json: { items: [{ ...user, isSuspended: false, isProtected: true, violationCount: 0, violationBaseline: 0 }], nextCursor: null } })
    if (pathname === '/api/admin/reports') return route.fulfill({ json: { items: [], nextCursor: null } })
    return route.fallback()
  })
  await page.goto('/admin')
  const tabs = page.getByRole('navigation', { name: '管理分类', exact: true })
  for (const label of ['作品审核', '抽奖管理', '社区设置', '内容标签', '广告位', '用户管理', '举报处理']) await expect(tabs.getByRole('button', { name: label, exact: true })).toBeVisible()
  await tabs.getByRole('button', { name: '社区设置', exact: true }).click()
  await page.getByLabel('违规次数阈值', { exact: true }).fill('4')
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('设置服务暂不可用')
  await expect(page.getByLabel('违规次数阈值', { exact: true })).toHaveValue('4')
  await expect(page.getByRole('button', { name: '保存社区设置', exact: true })).toBeEnabled()
  expect(writes).toHaveLength(1)
  expect(writes[0]!.csrf).toBe('fixture-csrf')
  expect(writes[0]!.body.communityViolationThreshold).toBe(4)
  await tabs.getByRole('button', { name: '内容标签', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '保留这次修改？' })).toBeVisible()
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await expect(page.getByText('保留标签', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '添加标签', exact: true })).toBeDisabled()
  await tabs.getByRole('button', { name: '广告位', exact: true }).click()
  await expect(page.getByRole('heading', { name: '广告位 1', exact: true })).toBeVisible()
  await tabs.getByRole('button', { name: '用户管理', exact: true }).click()
  await expect(page.getByRole('button', { name: '封禁', exact: true })).toBeDisabled()
  await tabs.getByRole('button', { name: '举报处理', exact: true }).click()
  await expect(page.getByRole('heading', { name: '举报处理', exact: true })).toBeVisible()
  expect(unexpected).toEqual([])
})

test('ordinary members cannot see administrative controls or trigger privileged reads', async ({ page }) => {
  const unexpected = await mockApp(page, true)
  const privileged: string[] = []
  await page.route('**/api/admin/**', route => {
    privileged.push(route.request().url())
    return route.fulfill({ status: 403, json: { error: 'Forbidden' } })
  })
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: '需要审核员权限', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '管理分类', exact: true })).toHaveCount(0)
  expect(privileged).toEqual([])
  expect(unexpected).toEqual([])
})

test('messages enforce mutual-follow permission, paginate, and retry the same emoji receipt', async ({ page }) => {
  const unexpected = await mockApp(page, true)
  const peer = { ...user, id: 'regression-peer', name: '私信对象', username: 'peer' }
  let canSend = false
  const sent: { body: Record<string, unknown>; csrf: string | undefined }[] = []
  const requests: string[] = []
  await page.route('**/api/messages/**', route => {
    const request = route.request(), url = new URL(request.url())
    requests.push(`${request.method()} ${url.pathname}${url.search}`)
    if (url.pathname === '/api/messages/threads') return route.fulfill({ json: {
      items: [{ user: url.searchParams.has('cursor') ? { ...peer, id: 'second-peer', name: '第二位对象' } : peer, lastMessage: { id: 'last', text: '😊', date: '2026-11-12T10:00:00Z', owned: false }, unread: 1 }],
      nextCursor: url.searchParams.has('cursor') ? null : 'threads-next',
    } })
    if (url.pathname.endsWith('/read')) return route.fulfill({ json: { ok: true } })
    if (request.method() === 'GET') return route.fulfill({ json: {
      user: peer, canSend, reason: canSend ? '' : '双方互相关注后，可以分享作品和表情。',
      items: url.searchParams.has('cursor') ? [{ id: 'older', text: '🙏', date: '2026-11-12T09:00:00Z', owned: false }] : [{ id: 'latest', text: '😊', date: '2026-11-12T10:00:00Z', owned: false }],
      nextCursor: url.searchParams.has('cursor') ? null : 'messages-next',
    } })
    sent.push({ body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] })
    if (sent.length === 1) return route.fulfill({ status: 503, json: { error: '私信暂不可用' } })
    return route.fulfill({ json: { message: { id: 'sent', text: sent[0]!.body.text, date: '2026-11-12T11:00:00Z', owned: true, read: false } } })
  })
  await page.goto('/messages/regression-peer')
  await expect(page.getByText('双方互相关注后，可以分享作品和表情。', { exact: true })).toBeVisible()
  const emoji = page.getByRole('button', { name: '发送表情 👍', exact: true })
  await expect(emoji).toBeDisabled()
  await expect(page.getByRole('button', { name: '分享作品', exact: true })).toBeDisabled()
  await expect(page.locator('.message-composer textarea, .message-composer input[type=file]')).toHaveCount(0)
  await page.getByRole('button', { name: '加载更早消息', exact: true }).click()
  await expect(page.locator('.message-history .message-row')).toHaveCount(2)
  await page.getByRole('button', { name: '更多会话', exact: true }).click()
  await expect(page.getByRole('link').filter({ hasText: '第二位对象' })).toBeVisible()
  expect(requests.some(value => value.includes('cursor=messages-next'))).toBe(true)
  expect(requests.some(value => value.includes('cursor=threads-next'))).toBe(true)
  expect(sent).toEqual([])
  canSend = true
  await page.reload()
  await expect(emoji).toBeEnabled()
  await emoji.click()
  await expect(page.getByRole('alert').filter({ hasText: '私信暂不可用' })).toBeVisible()
  await expect(emoji).toBeDisabled()
  await page.getByRole('button', { name: '重试发送', exact: true }).click()
  await expect(page.locator('.message-history .message-row.owned')).toHaveCount(1)
  await expect(emoji).toBeEnabled()
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect(sent[0]!.body.text).toBe('👍')
  expect(sent[0]!.csrf).toBe('fixture-csrf')
  expect(unexpected).toEqual([])
})

test('one Studio iframe survives in-app navigation and keeps background result controls', async ({ page }) => {
  const unexpected = await mockApp(page, true)
  const contexts: { action: string; context: string }[] = []
  let starts = 0
  await page.route('**/api/newapi/studio/start', route => {
    starts++
    return route.fulfill({ json: { code: 'a'.repeat(43), origin: new URL(origin).origin, subject: 'fixture-subject', userId: user.id } })
  })
  await page.route('**/api/newapi/studio/context', route => {
    contexts.push(route.request().postDataJSON())
    return route.fulfill({ json: { ok: true } })
  })
  await page.route('**/studio/community-embed?*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><p>Isolated Studio fixture</p><script>
    const params = new URLSearchParams(location.search);
    const identity = {context:params.get('context'),attempt:params.get('attempt'),subject:'fixture-subject',userId:${JSON.stringify(user.id)}};
    const task = {id:'00111111-1111-4111-8111-111111111111',sessionId:'fixture-session',kind:'image',title:'后台任务回归',model:'fixture-model',createdAt:1,state:'running'};
    const send = value => parent.postMessage({type:'community-studio',...identity,...value},location.origin);
    window.completeFixtureTask = () => {task.state='complete';send({status:'background-tasks',tasks:[task]})};
    addEventListener('message', event => {
      if(event.source!==parent || event.origin!==location.origin) return;
      const data=event.data;
      if(data.type==='community-launch') send({status:'ready'});
      if(data.type==='community-workspace') send({status:'workspace-ready',requestId:data.requestId,kind:data.kind});
      if(data.type==='community-background' && data.action==='list') send({status:'background-tasks',tasks:[task]});
      if(data.type==='community-background' && data.action==='open') send({status:'background-opened',requestId:data.requestId});
      if(data.type==='community-background' && data.action==='result') {
        const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),char=>char.charCodeAt(0));
        send({status:'background-result',requestId:data.requestId,files:[new Blob([bytes],{type:'image/png'})]});
      }
    });
    send({status:'hello'});
  </script></body></html>` }))
  await page.goto('/create/image')
  await expect(page.locator('.studio-stage')).toHaveAttribute('data-state', 'ready')
  await expect(page.locator('iframe.studio-frame')).toHaveCount(1)
  await expect(page.locator('main iframe')).toHaveCount(0)
  await expect(page.locator('.background-dock')).toContainText('后台任务回归')
  const handle = await page.locator('iframe.studio-frame').elementHandle()
  const frame = await handle!.contentFrame()
  await page.locator('nav.desktop-nav a[href="/discover"]').click()
  await expect(page.getByRole('button', { name: '展开搜索作品', exact: true })).toBeVisible()
  await expect(page.locator('iframe.studio-frame')).toHaveCount(1)
  expect(await handle!.evaluate(element => element.isConnected)).toBe(true)
  await expect(page.locator('.studio-host')).toHaveAttribute('aria-hidden', 'true')
  await frame!.evaluate(() => (window as unknown as { completeFixtureTask: () => void }).completeFixtureTask())
  await expect(page.locator('.background-dock')).toContainText('生成完成')
  await page.getByRole('button', { name: '查看结果', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '生成结果预览', exact: true })
  await expect(dialog.locator('img')).toBeVisible()
  await expect(dialog.getByRole('link', { name: '下载文件', exact: true })).toHaveAttribute('download', /creation-1/)
  await dialog.getByRole('button', { name: '关闭结果预览', exact: true }).click()
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '创作台', exact: true }).click()
  await expect(page.locator('.studio-host')).toHaveAttribute('aria-hidden', 'false')
  expect(await handle!.evaluate(element => element.isConnected)).toBe(true)
  expect(starts).toBe(1)
  await page.getByRole('button', { name: '关闭工作台', exact: true }).click()
  await expect(page.locator('iframe.studio-frame')).toHaveCount(0)
  await expect.poll(() => contexts.filter(value => value.action === 'revoke').length).toBe(1)
  expect(unexpected).toEqual([])
})
