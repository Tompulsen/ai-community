export const textGenerationTimeouts = {
  response: 180_000,
  idle: 300_000,
  total: 30 * 60_000,
  save: 60_000,
}
export const creationStreamProtocol = 'append-v1'

export function creationRetryDelay(value: unknown, minimum: number) {
  if (typeof value !== 'string' || !value.trim()) return minimum
  const duration = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - Date.now()
  return Number.isFinite(duration) ? Math.max(minimum, duration) : minimum
}
