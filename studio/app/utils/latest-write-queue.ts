/** Keep one active snapshot and replace queued snapshots with the latest one. */
export function createLatestWriteQueue<T>(write: (value: T) => Promise<void>) {
  let pending: { value: T } | undefined;
  let running: Promise<void> | undefined;

  return (value: T): Promise<void> => {
    pending = { value };
    if (!running) {
      running = Promise.resolve().then(async () => {
        try {
          while (pending) {
            const next = pending;
            pending = undefined;
            try {
              await write(next.value);
            } catch (error) {
              // A newer snapshot can still succeed after an obsolete write fails.
              if (!pending) throw error;
            }
          }
        } finally {
          running = undefined;
        }
      });
    }
    return running;
  };
}

/** Coalesce live updates before the expensive snapshot encoding starts. */
export function createDeferredWriteQueue<T>(
  write: (value: T) => Promise<void>,
  delay: number,
) {
  let pending: { value: T } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let urgent = false;
  let completion: Promise<void> | undefined;
  let resolve: (() => void) | undefined;
  let reject: ((error: unknown) => void) | undefined;

  async function drain() {
    clearTimeout(timer);
    timer = undefined;
    if (running || !pending) return;
    running = true;
    urgent = false;
    const next = pending;
    pending = undefined;
    let error: unknown;
    try {
      await write(next.value);
    } catch (failure) {
      error = failure;
    }
    running = false;
    if (pending) {
      if (urgent) void drain();
      else timer = setTimeout(drain, delay);
      return;
    }
    const finish = error ? () => reject?.(error) : resolve;
    completion = undefined;
    finish?.();
    resolve = undefined;
    reject = undefined;
  }

  const save = (value: T, immediate = false) => {
    pending = { value };
    if (!completion)
      completion = new Promise<void>((done, fail) => {
        resolve = done;
        reject = fail;
      });
    const promise = completion;
    if (immediate) {
      urgent = true;
      void drain();
    } else if (!running && timer === undefined)
      timer = setTimeout(drain, delay);
    return promise;
  };
  save.flush = () => {
    urgent = true;
    void drain();
    return completion ?? Promise.resolve();
  };
  return save;
}
