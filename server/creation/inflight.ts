const active = new WeakMap<object, Set<Promise<unknown>>>()
const closing = new WeakSet<object>()

export function trackCreation<T>(owner: object, work: Promise<T>): Promise<T> {
  let pending = active.get(owner)
  if (!pending) { pending = new Set(); active.set(owner, pending) }
  const tasks = pending
  tasks.add(work)
  void work.then(() => tasks.delete(work), () => tasks.delete(work))
  return work
}

export const creationsClosing = (owner: object) => closing.has(owner)
export function stopAcceptingCreations(owner: object) { closing.add(owner) }

export async function drainCreations(owner: object) {
  const tasks = active.get(owner)
  while (tasks?.size) await Promise.allSettled([...tasks])
}
