export const accountFlowId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const accountCompleteMessage = 'octopus:account-complete'
export const accountCompleteAck = 'octopus:account-ack'

export function loginReturnPath(value: unknown, fallback = '/discover'): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\#]/.test(value)) return fallback
  const path = value.split('?')[0]!
  if (!/^\/(?:discover|work\/[a-zA-Z0-9]{1,32}|create(?:\/(?:text|image|video))?|library|activities|community|account|messages(?:\/[a-zA-Z0-9]{1,32})?)$/.test(path)) return fallback
  const query = value.slice(path.length + 1)
  try { decodeURIComponent(query) } catch { return fallback }
  const id = /^[a-zA-Z0-9]{1,32}$/
  const allowed: Record<string, RegExp> = { publish: /^1$/, invite: id }
  switch (path.split('/')[1]) {
    case 'discover':
      Object.assign(allowed, { kind: /^(all|image|video|resource)$/, q: /^[^\u0000-\u001f\u007f\\]{0,500}$/,
        tag: /^[^\u0000-\u001f\u007f\\]{1,100}$/, sort: /^(featured|latest|following)$/ })
      break
    case 'create': Object.assign(allowed, { from: id, remix: id }); break
    case 'library': allowed.tab = /^(all|draft|pending|published|rejected|saved)$/; break
    case 'community': Object.assign(allowed, { creator: id, tab: /^(creators|announcements)$/ }); break
    case 'account': allowed.tab = /^(profile|balance|security|privacy|following|theme)$/; break
    case 'messages': Object.assign(allowed, { peer: id, tab: /^(messages|announcement|activity)$/ }); break
  }
  const seen = new Set<string>()
  for (const [key, item] of new URLSearchParams(query)) {
    if (seen.has(key) || /[\u0000-\u001f\u007f\\]/.test(item) || !Object.hasOwn(allowed, key) || !allowed[key]!.test(item)) return fallback
    seen.add(key)
  }
  return value
}
