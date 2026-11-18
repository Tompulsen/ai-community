/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * Scheduling adapted from the reference community's utility/appearance and theme-schedule.
 */
(() => {
  const key = 'ai-community-next:appearance:v1'
  const defaults = { mode: 'dark', light: 'cloud', dark: 'sage', lightStart: '07:00', darkStart: '19:00' }
  // Keep palette IDs stable so existing browser preferences remain valid.
  const themes = [
    { id: 'cloud', name: '瓷白', mode: 'light', colors: ['#f7f8fa', '#ffffff', '#eceef2', '#dde1e7', '#20232b', '#646b78', '#4658d9', '#3848ba', '#e8ecff', '#ffffff'] },
    { id: 'paper', name: '薄雾', mode: 'light', colors: ['#f6f8f7', '#ffffff', '#eaf0ed', '#dae3dd', '#222b27', '#5f6e65', '#267052', '#1e5d43', '#e2f0e8', '#ffffff'] },
    { id: 'mist', name: '初雪', mode: 'light', colors: ['#faf7f8', '#ffffff', '#f2eaee', '#e6dce1', '#2d252a', '#75646e', '#a43865', '#8c2f56', '#f8e4ed', '#ffffff'] },
    { id: 'sage', name: '曜石', mode: 'dark', colors: ['#151619', '#202226', '#2b2e34', '#383d46', '#eceef3', '#a6adba', '#a8b4ff', '#c0c8ff', '#303951', '#151619'] },
    { id: 'midnight', name: '松影', mode: 'dark', colors: ['#151c19', '#202a25', '#2b3931', '#3a4a40', '#e8efea', '#a6b9ac', '#8bd4ad', '#ade6c5', '#2b4034', '#151c19'] },
    { id: 'jade', name: '绯夜', mode: 'dark', colors: ['#1d181c', '#2a2228', '#392d35', '#4c3b46', '#f2e9ee', '#bea8b5', '#f0a3c3', '#f7c0d7', '#49303f', '#1d181c'] },
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
      ? ['#276441', '#e0f0e5', '#855410', '#f7ecd3', '#b42337', '#fce9ed', '#ffffff', '#7b8490']
      : ['#a4cfb4', '#293a30', '#e3c38c', '#403728', '#f1a0a7', '#472d32', '#32191d', '#78818e']
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
