// Adapted from octopus_chat/app/components/chat-list.tsx (MIT).
export function formatChatTime(timestamp: number, now = Date.now()) {
  const date = new Date(timestamp), today = new Date(now)
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return { label: '', full: '', iso: '' }
  const label = date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
  return { label, full: date.toLocaleString(), iso: date.toISOString() }
}
