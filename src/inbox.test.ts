import { expect, it } from 'vitest'
import { isFollowRequestNotification, notificationDestination, type InboxNotification } from './inbox'

it('recognizes old and current follow request destinations without redirecting other interactions', () => {
  for (const url of ['/account?tab=following', '/account?other=1&tab=following', '/messages?tab=activity#follow-requests']) {
    const item: InboxNotification = { id: 'redis:1-0', type: 'activity', url }
    expect(isFollowRequestNotification(item)).toBe(true)
    expect(notificationDestination(item)).toBe('/messages?tab=activity#follow-requests')
  }
  for (const url of ['/account?tab=privacy', '/messages?tab=activity', '/work/work1', '//other.example/account?tab=following', 'https://other.example/account?tab=following']) {
    expect(isFollowRequestNotification({ id: 'redis:1-0', type: 'activity', url })).toBe(false)
  }
  expect(isFollowRequestNotification({ id: 'notice1', type: 'announcement', url: '/account?tab=following' })).toBe(false)
  expect(notificationDestination({ id: 'redis:1-0', type: 'activity', url: '/work/work1' })).toBe('/work/work1')
})
