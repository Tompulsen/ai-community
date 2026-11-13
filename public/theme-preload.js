/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * Scheduling adapted from the reference community's utility/appearance and theme-schedule.
 */
(() => {
  const key = 'ai-community-next:appearance:v1'
  const defaults = { mode: 'dark', light: 'cloud', dark: 'sage', lightStart: '07:00', darkStart: '19:00' }
  const themes = [
    { id: 'cloud', name: '云白', mode: 'light', colors: ['#f5f6f3', '#ffffff', '#ecefe8', '#c6cec3', '#1c241f', '#566259', '#3c6450', '#315440', '#e0ebdf', '#ffffff'] },
    { id: 'paper', name: '暖纸', mode: 'light', colors: ['#f5f0e5', '#fffcf5', '#eee6d8', '#d2c7b4', '#342d22', '#716348', '#79592f', '#654823', '#efe3cc', '#ffffff'] },
    { id: 'mist', name: '晴空', mode: 'light', colors: ['#f2f6fa', '#ffffff', '#e6eef5', '#bdcddd', '#1c2c3d', '#52677b', '#28618a', '#204f70', '#dceaf5', '#ffffff'] },
    { id: 'sage', name: '炭灰鼠尾草', mode: 'dark', colors: ['#121212', '#262626', '#303030', '#3c3d3a', '#f1f1ef', '#aaaca6', '#8fa68e', '#aec2a8', '#2c362c', '#1c1c1c'] },
    { id: 'midnight', name: '午夜蓝', mode: 'dark', colors: ['#101723', '#1c2636', '#273349', '#3a4c62', '#e6edf7', '#adbace', '#9bbbf0', '#bed1f3', '#243752', '#142238'] },
    { id: 'jade', name: '深海青', mode: 'dark', colors: ['#111f20', '#1c3031', '#253e3e', '#3b5757', '#e2eeee', '#a3bdbb', '#6dd5bc', '#a0e6d4', '#254640', '#102a25'] },
  ]
  const tokens = ['--p-bg', '--p-surface', '--surface-soft', '--border', '--p-ink', '--muted', '--p-action', '--blue-hover', '--blue-soft', '--p-action-ink']
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  let prefs = { ...defaults }, storageError = '', timer
  function validTimes(light, dark) {
    const time = /^([01]\d|2[0-3]):[0-5]\d$/
    return typeof light === 'string' && typeof dark === 'string' && time.test(light) && time.test(dark) && light !== dark
  }
  function normalize(value) {
    if (!value || typeof value !== 'object') return { ...defaults }
    return {
      mode: ['light', 'dark', 'system', 'schedule'].includes(value.mode) ? value.mode : defaults.mode,
      light: themes.some(theme => theme.mode === 'light' && theme.id === value.light) ? value.light : defaults.light,
      dark: themes.some(theme => theme.mode === 'dark' && theme.id === value.dark) ? value.dark : defaults.dark,
      lightStart: validTimes(value.lightStart, value.darkStart) ? value.lightStart : defaults.lightStart,
      darkStart: validTimes(value.lightStart, value.darkStart) ? value.darkStart : defaults.darkStart,
    }
  }
  function read() {
    try { return normalize(JSON.parse(localStorage.getItem(key))) }
    catch { return { ...defaults } }
  }
  function effectiveMode() {
    if (prefs.mode === 'system') return media.matches ? 'dark' : 'light'
    if (prefs.mode !== 'schedule') return prefs.mode
    const now = new Date(), time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const dark = prefs.darkStart > prefs.lightStart
      ? time >= prefs.darkStart || time < prefs.lightStart
      : time >= prefs.darkStart && time < prefs.lightStart
    return dark ? 'dark' : 'light'
  }
  function reconcile() {
    clearTimeout(timer)
    const mode = effectiveMode(), theme = themes.find(item => item.id === prefs[mode]), root = document.documentElement
    root.dataset.theme = theme.id; root.dataset.colorScheme = mode
    tokens.forEach((token, index) => root.style.setProperty(token, theme.colors[index]))
    root.style.setProperty('--p-accent', theme.colors[6]); root.style.setProperty('--p-accent-ink', theme.colors[9]); root.style.setProperty('--p-muted', theme.colors[5])
    const semantic = mode === 'light'
      ? ['#276441', '#e0f0e5', '#855410', '#f7ecd3', '#b42337', '#fce9ed', '#ffffff', '#899684']
      : ['#a4cfb4', '#293a30', '#e3c38c', '#403728', '#f1a0a7', '#472d32', '#32191d', theme.colors[3]]
    ;['--green', '--green-soft', '--amber', '--amber-soft', '--danger', '--danger-soft', '--danger-ink', '--control-border'].forEach((token, index) => root.style.setProperty(token, semantic[index]))
    root.style.colorScheme = mode; root.style.backgroundColor = theme.colors[0]; root.style.color = theme.colors[4]
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors[0])
    window.dispatchEvent(new Event('community-appearance-change'))
    if (prefs.mode === 'schedule' && document.visibilityState !== 'hidden') timer = setTimeout(reconcile, 60000 - Date.now() % 60000)
  }
  window.communityAppearance = {
    themes,
    get settings() { return { ...prefs } },
    get mode() { return effectiveMode() },
    get error() { return storageError },
    validTimes,
    set(patch) {
      const next = { ...prefs, ...patch }
      if (!validTimes(next.lightStart, next.darkStart)) return false
      prefs = normalize(next); storageError = ''
      try { localStorage.setItem(key, JSON.stringify(prefs)) }
      catch { storageError = '当前浏览器无法保存偏好，本次选择已生效，关闭页面后可能恢复默认。' }
      reconcile()
      return true
    },
    reset() { this.set({ ...defaults }) },
  }
  prefs = read(); reconcile()
  media.addEventListener('change', reconcile)
  document.addEventListener('visibilitychange', reconcile)
  window.addEventListener('focus', reconcile)
  window.addEventListener('pageshow', reconcile)
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { prefs = read(); storageError = ''; reconcile() }
  })
})()
