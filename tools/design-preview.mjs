import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { defaultDailyLotteryPrizes, lotteryDay } from '../shared/lottery-daily.ts'

const portrait = '/assets/brand/octopus-community.jpg'
const timestamp = '2026-11-19T08:00:00Z'
const userId = 'previewCreator'
const maxBodyBytes = 20 * 1024 * 1024
const page = items => ({ items, nextCursor: null })
const success = data => ({ success: true, data })

function json(req, res, status, value) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(value))
}

// This middleware exists only in the UI preview process, never in the application server.
export function createPreviewMiddleware() {
  let authenticated = true, version = 1, uploadId = 0
  const user = { id: userId, accountId: '17', username: 'local-preview', name: '预览创作者',
    bio: '记录创作与日常灵感，分享图片、视频与提示词。',
    avatarId: 'previewAvatar', avatarUrl: portrait, bannerId: null, bannerUrl: '',
    isAdmin: false, isModerator: false }
  let privacy = { isLocked: false, autoAcceptFollowed: true, followApprovalLocalSeconds: null,
    followingVisibility: 'public', followersVisibility: 'public' }
  const uploads = new Map()
  const works = ['光影练习', '城市与日常', '创作提示词'].map((title, index) => ({
    id: `previewWork${index + 1}`, authorId: userId, title, author: user.name, avatar: '预', avatarUrl: portrait,
    version: 1, kind: index === 2 ? 'resource' : 'image', cover: portrait, coverAspectRatio: index === 1 ? 1.25 : 1,
    tags: ['灵感', '日常'], prompt: '柔和的自然光，简洁的构图', model: 'preview-image', body: '在光影中寻找创作灵感。',
    likes: 12 + index, viewsCount: 120, date: timestamp, owned: true, liked: false, saved: false,
    status: 'published', fileIds: [], files: [],
  }))
  const points = { enabled: true, currency: 'CNY', pointsPerCny: 5000, charityPoints: '12500',
    permanentPoints: '50000', legacyApiQuota: 0, paidApiQuota: 5000000, totalApiQuota: 6250000, charityExpiringAt: null }
  const wallet = { userId: 17, currencySymbol: '积分', quotaPerUnit: 500000, quotaPerPoint: 100,
    quotaDisplayType: 'CUSTOM', creditExchangeRate: 1,
    topup: { enabled: true, redemptionEnabled: true, redemptionUrl: '', minAmount: 1,
      amountOptions: [10, 50, 100, 200], discounts: {},
      paymentMethods: [{ type: 'alipay', name: '支付宝' }, { type: 'wxpay', name: '微信支付' }] },
    plans: [{ id: 1, title: '创作月包', subtitle: '图片与视频创作额度', priceAmount: 20, currency: 'CNY',
      durationUnit: 'month', durationValue: 1, customSeconds: 0, totalAmount: 5000000,
      resetPeriod: 'monthly', resetSeconds: 0, maxPurchases: 2, allowBalancePay: false }],
    subscriptions: [],
    history: [{ id: 1, tradeNo: 'PREVIEW001', amount: 10, money: 10, status: 'success',
      createdAt: 1795075200, completedAt: 1795075200, paymentMethod: 'alipay' }], historyTotal: 1 }
  const creator = () => ({ ...user, count: works.length, worksCount: works.length, followed: false,
    isSelf: true, followersCount: 28, followingCount: 12, receivedLikesCount: 68 })
  const limits = { imagesMb: 20, videosMb: 20, filesMb: 20, maxFileSizeMb: 20 }

  return async function previewMiddleware(req, res, next) {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Design-Preview', 'mock')
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; frame-src 'none'; object-src 'none'; form-action 'self'; base-uri 'self'")
    const reply = (body, status = 200) => json(req, res, status, body)
    const fail = (message, status = 404) => reply({ success: false, message, error: { code: 'UI_PREVIEW_ONLY', message } }, status)
    try {
      const raw = req.url || '/'
      if (!raw.startsWith('/') || raw.startsWith('//') || /[\0-\x20\\#]/.test(raw)) return fail('无效的预览地址。', 400)
      const url = new URL(raw, 'http://preview.invalid'), path = decodeURIComponent(url.pathname)
      if (path.includes('\\') || path.split('/').some(part => part === '.' || part === '..')) return fail('无效的预览地址。', 400)
      const method = req.method || 'GET', read = method === 'GET' || method === 'HEAD'
      if (path.startsWith('/files/')) {
        const upload = uploads.get(path.slice('/files/'.length))
        if (!upload || !read) return fail('预览文件不存在。')
        res.statusCode = 200
        res.setHeader('Content-Type', upload.type)
        res.end(method === 'HEAD' ? undefined : upload.bytes)
        return
      }
      if (!/^\/(?:api|studio|auth|legacy-files)(?:\/|$)/.test(path)) return next()
      if (!path.startsWith('/api/')) return fail('该服务未接入 UI 预览。')

      let body = {}, bytes
      if (!read) {
        const chunks = []
        let length = 0
        for await (const chunk of req) {
          length += chunk.length
          if (length > maxBodyBytes) return fail('预览文件不能超过 20 MB。', 413)
          chunks.push(chunk)
        }
        bytes = Buffer.concat(chunks)
        if (bytes.length && !String(req.headers['content-type'] || '').startsWith('multipart/form-data')) {
          body = JSON.parse(bytes.toString('utf8'))
          if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('无效的预览数据。', 400)
        }
      }
      if (path === '/api/session' && read) return reply({ user: authenticated ? user : null,
        csrfToken: 'local-ui-preview', authentication: 'zhangyu', accountUrl: '' })
      if (path === '/api/new-api/status' && read) return reply(success({
        enabled: true, configured: true, publicUrl: '', passwordLoginEnabled: true, turnstileSiteKey: '',
        registerEnabled: true, passwordRegisterEnabled: true, emailVerificationEnabled: true,
        userAgreementEnabled: false, privacyPolicyEnabled: false,
        currencySymbol: '积分', pointsPerUsd: 5000,
      }))
      if (path === '/api/new-api/registration-code' && method === 'POST') return reply(success({ sent: true }))
      if (path === '/api/new-api/register' && method === 'POST') return reply(success({ registered: true }))
      if (['/api/new-api/login', '/api/new-api/login-2fa', '/api/new-api/login-select'].includes(path) && method === 'POST') {
        authenticated = true
        return reply(success({ authenticated: true }))
      }
      if (['/api/session/logout', '/api/new-api/logout'].includes(path) && method === 'POST') {
        authenticated = false
        return reply(path === '/api/new-api/logout' ? success({}) : { user: null })
      }
      if (path === '/api/account/session' && method === 'POST') {
        return authenticated ? reply({ user, returnTo: '/discover' }) : fail('请使用模拟账号登录。', 401)
      }
      if (path === '/api/site' && read) return reply({ brand: '章鱼社区', logoUrl: portrait })
      if (path === '/api/uploads/limits' && read) return reply(limits)
      if (path === '/api/tags' && read) return reply(page([{ id: 'inspiration', name: '灵感' }, { id: 'daily', name: '日常' }]))
      if (path === '/api/creators' && read) return reply(page([creator()]))
      if (path === '/api/announcements' && read) return reply(page([{ id: 'previewNews', title: '创作交流', body: '分享你的创作灵感与作品。', createdAt: timestamp }]))
      if (path === '/api/community/ads' && read) return reply(page([]))
      if (path === '/api/lottery/status' && read) {
        const day = lotteryDay(new Date()), rule = { enabled: false, threshold: 10, tickets: 1 }
        const prizes = defaultDailyLotteryPrizes(5000).map(prize => ({ ...prize, dailyQuota: prize.stock }))
        const limit = prizes.reduce((sum, prize) => sum + prize.stock, 0)
        return reply({
          settings: { enabled: true, prizes, invites: rule, followers: rule,
            likes: rule, likesMode: 'total', wheel: { theme: 'teal', title: '每日抽奖', subtitle: '每日一次',
              buttonText: '开始抽奖', rulesText: '每日可参与一次。' } },
          balance: 1, counts: { invites: 0, followers: 28, likes: 68, bestWorkLikes: 14 },
          earned: { invites: 0, followers: 0, likes: 0 }, accountLinked: true, creditReady: true, inviteUrl: '',
          daily: { date: day.date, timezone: 'Asia/Shanghai', resetsAt: day.end.toISOString(),
            limit, used: 0, remaining: limit, participated: false },
        })
      }
      if (path === '/api/referrals/status' && read) return reply({
        config: { version: 1, enabled: false, inviterPoints: 5000, inviteePoints: 5000, updatedAt: 1795075200 },
        code: '', inviteUrl: '', invited: 0, credited: 0, pending: 0, earnedPoints: 0,
        asInvitee: null, items: [], nextCursor: 0,
      })
      if (path === '/api/lottery/records' && read) return reply(page([]))
      if (path === '/api/account' && read) return reply({ linked: true, subject: '17', balance: 62500,
        currencySymbol: '积分', studioReady: true, walletEnabled: true, points })
      if (path === '/api/account/privacy') {
        if (method === 'PATCH') {
          for (const key of Object.keys(privacy)) if (Object.hasOwn(body, key)) privacy[key] = body[key]
          version++
        } else if (!read) return fail('该操作未接入 UI 预览。', 405)
        return reply({ settings: privacy, version: String(version) })
      }
      if (path === '/api/profile' && method === 'PATCH') {
        for (const [field, max] of [['name', 50], ['bio', 1500]]) {
          if (typeof body[field] !== 'string' || body[field].length > max || (field === 'name' && !body[field].trim())) return fail('请检查昵称和简介。', 400)
        }
        for (const field of ['avatar', 'banner']) {
          const id = body[`${field}Id`]
          if (id !== null && id !== 'previewAvatar' && !uploads.has(id)) return fail('预览图片不存在。', 400)
        }
        user.name = body.name.trim(); user.bio = body.bio.trim()
        for (const field of ['avatar', 'banner']) {
          const id = body[`${field}Id`]
          user[`${field}Id`] = id
          user[`${field}Url`] = id === 'previewAvatar' ? portrait : id ? `/files/${id}` : ''
        }
        return reply({ user })
      }
      if (path === '/api/uploads' && method === 'POST') {
        const form = await new Request('http://preview.invalid/api/uploads', {
          method: 'POST', headers: { 'content-type': req.headers['content-type'] || '' }, body: bytes,
        }).formData()
        const file = form.get('file')
        if (!file || typeof file === 'string' || !file.type.startsWith('image/')) return fail('请选择图片。', 400)
        const id = `previewUpload${++uploadId}`
        uploads.set(id, { type: file.type, bytes: Buffer.from(await file.arrayBuffer()) })
        return reply({ file: { id, name: file.name, type: file.type, size: file.size, url: `/files/${id}` } })
      }
      if (path === `/api/users/${userId}` && read) return reply({ user: creator() })
      if (/^\/api\/users\/[^/]+\/(?:followers|following)$/.test(path) && read) return reply(page([]))
      if (path === '/api/works' || path === '/api/library' || path === '/api/community/works') {
        if (!read) return fail('该操作未接入 UI 预览。', 405)
        const kind = url.searchParams.get('kind'), query = url.searchParams.get('query') || ''
        const tab = url.searchParams.get('tab')
        return reply(page(works.filter(work => (!kind || kind === 'all' || work.kind === kind)
          && work.title.includes(query) && (!tab || tab === 'all' || tab === 'works'
            || tab === 'saved' && work.saved || tab === 'liked' && work.liked || tab === work.status))))
      }
      const work = works.find(item => path === `/api/works/${item.id}`)
      if (work && read) return reply({ work: { ...work, author: user.name } })
      if (/^\/api\/works\/[^/]+\/(?:comments|related)$/.test(path) && read) return reply(page([]))
      if (/^\/api\/works\/[^/]+\/view$/.test(path) && method === 'POST') return reply({})
      if (path === '/api/security/status' && read) return reply({ external: true })
      if (path === '/api/security/sessions' && read) return reply(page([{ id: 'a'.repeat(64), current: true,
        createdAt: timestamp, ip: '127.0.0.1', userAgent: '本地浏览器' }]))
      if (path === '/api/security/logins' && read) return reply(page([{ id: 'previewLogin', date: timestamp,
        success: true, ip: '127.0.0.1', userAgent: '本地浏览器' }]))
      if (path === '/api/new-api/login-identifiers' && read) return reply(success({
        username: user.username, email: 'preview@example.invalid', login_identifiers: [user.username],
      }))
      if (path === '/api/new-api/model-groups' && read) return reply(success({
        selectedGroup: 'auto', selectedTokenId: 1, groups: [{ id: 'auto', name: 'Auto', ratio: 1 }],
      }))
      if (path === '/api/new-api/session' && read) return reply(success({ authenticated, selectedTokenId: 1 }))
      if (path === '/api/new-api/groups' && read) return reply(success([{ id: 'auto', name: 'Auto' }]))
      if (path === '/api/new-api/model-pricing' && read) return reply(success({ userId: 17, currency: '积分',
        rows: [{ model: 'preview-image', group: 'auto', billing: '每次请求', price: '100 积分' }] }))
      if (/^\/api\/new-api\/wallet(?:\/(?:topup|plans|history))?$/.test(path) && read) return reply(success(wallet))
      if (path === '/api/new-api/wallet/quote' && method === 'POST') {
        const amount = Number(body.amount)
        if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) return fail('请输入有效金额。', 400)
        return reply(success({ userId: 17, amount, money: amount.toFixed(2) }))
      }
      if (path === '/api/creation/models' && read) return reply(page([
        { id: 'preview-image', name: '图片模型', kinds: ['image'] },
        { id: 'preview-video', name: '视频模型', kinds: ['video'] },
        { id: 'preview-text', name: '对话模型', kinds: ['text'] },
      ]))
      if (path === '/api/notifications' && read) return reply({ ...page([]), unreadCounts: { announcement: 0, activity: 0 } })
      if (['/api/messages/threads', '/api/follow-requests', '/api/creation/tasks', '/api/new-api/logs'].includes(path) && read) return reply(path.includes('new-api') ? success(page([])) : { ...page([]), total: 0, unreadCount: 0 })
      return fail('仅用于 UI 调试，该操作未连接真实服务。', read ? 404 : 409)
    } catch {
      if (!res.writableEnded) fail('无法解析预览数据。', 400)
    }
  }
}

async function selfCheck() {
  const middleware = createPreviewMiddleware()
  async function request(method, url, body) {
    const req = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), {
      method, url, headers: { 'content-type': 'application/json' },
    })
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value }, end(value) { this.body = value; this.writableEnded = true } }
    await middleware(req, res, () => { res.vite = true })
    return res
  }
  const session = await request('GET', '/api/session')
  assert.equal(JSON.parse(session.body).user.id, userId)
  assert.equal(session.headers['X-Design-Preview'], 'mock')
  const lottery = JSON.parse((await request('GET', '/api/lottery/status')).body)
  assert.equal(lottery.daily.limit, 200)
  assert.equal(lottery.settings.prizes.reduce((sum, prize) => sum + prize.dailyQuota, 0), lottery.daily.limit)
  assert.equal((await request('GET', '/account')).vite, true)
  for (const path of ['/api/unknown', '/api/new-api/wallet/pay', '/api/creation/generate', '/auth/newapi', '/studio/api/session']) {
    const response = await request(path.includes('unknown') ? 'GET' : 'POST', path, {})
    assert(response.statusCode >= 400, path)
    assert(!response.vite, path)
  }
  await request('PATCH', '/api/profile', { name: '本地昵称', bio: '', avatarId: 'previewAvatar', bannerId: null })
  assert.equal(JSON.parse((await request('GET', '/api/session')).body).user.name, '本地昵称')
  const status = JSON.parse((await request('GET', '/api/new-api/status')).body).data
  assert.equal(status.registerEnabled && status.passwordRegisterEnabled && status.emailVerificationEnabled, true)
  assert.equal(status.userAgreementEnabled || status.privacyPolicyEnabled, false)
  await request('POST', '/api/new-api/logout', {})
  assert.equal(JSON.parse((await request('GET', '/api/session')).body).user, null)
  assert.equal(JSON.parse((await request('POST', '/api/new-api/registration-code', { email: 'preview@example.invalid' })).body).data.sent, true)
  assert.equal(JSON.parse((await request('POST', '/api/new-api/register', {
    username: 'preview-signup', password: 'preview-password', email: 'preview@example.invalid', verification_code: '123456',
  })).body).data.registered, true)
  assert.equal(JSON.parse((await request('GET', '/api/session')).body).user, null)
  assert.equal((await request('POST', '/api/account/session', {})).statusCode, 401)
  await request('POST', '/api/new-api/login', { username: 'preview-signup', password: 'preview-password' })
  assert.equal(JSON.parse((await request('POST', '/api/account/session', {})).body).user.id, userId)
  assert.equal((await request('POST', '/api/new-api/wallet/quote', { amount: -1 })).statusCode, 400)
  assert.equal((await request('GET', '//external.invalid/api/session')).statusCode, 400)
  console.log('Self-check passed: local session, profile drafts, registration without login, API isolation and payment/generation blocking. No network requests.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-check')) await selfCheck()
  else {
    const port = Number(process.env.DESIGN_PREVIEW_PORT || 18775)
    assert(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Invalid DESIGN_PREVIEW_PORT')
    const built = process.argv.includes('--built')
    const { createServer, preview } = await import('vite')
    const middleware = createPreviewMiddleware()
    const options = { root: fileURLToPath(new URL('../', import.meta.url)), plugins: [{
      name: 'local-ui-preview',
      configureServer(vite) { vite.middlewares.use(middleware) },
      configurePreviewServer(vite) { vite.middlewares.use(middleware) },
    }] }
    const listen = { host: '127.0.0.1', port, strictPort: true }
    const server = built ? await preview({ ...options, preview: listen }) : await createServer({ ...options, server: listen })
    if (!built) await server.listen()
    server.printUrls()
    console.log('UI preview: local mock account and data only; no upstream APIs. Restart to reset drafts.')
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void (built ? server.httpServer.close() : server.close()) })
  }
}
