import { describe, expect, it } from 'vitest'
import { newApiReturnPath } from '../server/account.ts'
import { loginReturnPath } from './login-navigation'

describe('login return destinations agree with the OAuth backend', () => {
  it('preserves current pages and only their supported query values', () => {
    const accepted = [
      '/discover', '/work/old123', '/create', '/create/text', '/create/image', '/create/video',
      '/library', '/activities', '/community', '/account', '/messages', '/messages/creator123',
      '/discover?kind=image&q=%E7%AB%A0%E9%B1%BC+AI&tag=Skill&sort=latest',
      '/discover?q=', '/create?from=old123', '/create/video?remix=old123',
      '/library?tab=saved&publish=1', '/community?creator=creator123&tab=creators',
      '/community?tab=announcements', '/account?tab=security', '/messages?peer=creator123',
      '/messages?tab=activity', '/messages?tab=announcement', '/messages?tab=messages',
      '/activities?invite=inviter123', '/discover?q=' + 'q'.repeat(500),
      '/discover?tag=' + 't'.repeat(100), '/work/' + 'a'.repeat(32),
    ]
    for (const value of accepted) {
      expect(loginReturnPath(value), value).toBe(value)
      expect(newApiReturnPath(value), value).toBe(value)
    }
  })

  it('rejects ambiguous paths, unsupported parameters and malformed values in both flows', () => {
    const rejected = [
      undefined, null, {}, '', 'https://other.test/discover', '//other.test/discover',
      '/\\other.test', '/discover/../account', '/%64iscover', '/work/%2e%2e', '/work/old_123',
      '/account/authorize', '/admin', '/community/lottery', '/discover#anchor',
      '/discover?redirect=https://other.test', '/discover?returnTo=%2Faccount',
      '/discover?kind=unknown', '/discover?sort=unknown', '/discover?kind=image&kind=video',
      '/discover?q=one&q=two', '/discover?invite=one&invite=two', '/discover?%71=one&q=two',
      '/discover?creator=creator123', '/work/old123?tag=Skill', '/library?tab=unknown',
      '/community?tab=security', '/account?tab=saved', '/account?reset=secret',
      '/account?newapi=complete', '/messages?peer=invalid_id', '/create?remix=old/123',
      '/messages?tab=unknown', '/messages?tab=activity&tab=announcement',
      '/activities?publish=0', '/discover?q=%', '/discover?q=%FF', '/discover?q=%5C',
      '/discover?q=%00', '/activities?invite=inviter123%0A', '/discover?constructor=value',
      '/discover?q=' + 'q'.repeat(501), '/discover?tag=' + 't'.repeat(101),
      '/discover?tag=', '/work/' + 'a'.repeat(33), '/discover?q=' + 'q'.repeat(2048),
    ]
    for (const value of rejected) {
      expect(loginReturnPath(value), String(value)).toBe('/discover')
      expect(newApiReturnPath(value), String(value)).toBe('/account')
    }
  })

  it('keeps a caller-provided fallback without changing accepted paths', () => {
    expect(loginReturnPath('/unknown', '/library')).toBe('/library')
    expect(loginReturnPath('/messages?peer=creator123', '/library')).toBe('/messages?peer=creator123')
  })
})
