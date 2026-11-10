/** Keep upstream cancellation alive until the response body finishes. */
export function createProxyLifecycle(
  clientSignal: AbortSignal,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let abortBody: (() => void) | undefined;
  const abort = () => {
    controller.abort();
    abortBody?.();
  };
  const headerTimer = setTimeout(abort, timeoutMs);
  clientSignal.addEventListener("abort", abort, { once: true });
  if (clientSignal.aborted) abort();
  const dispose = () => {
    clearTimeout(headerTimer);
    clientSignal.removeEventListener("abort", abort);
  };

  return {
    signal: controller.signal,
    dispose,
    stream(body: ReadableStream<Uint8Array> | null) {
      clearTimeout(headerTimer);
      if (!body) {
        dispose();
        return null;
      }
      const reader = body.getReader();
      let finished = false;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        finished = true;
        clearTimeout(idleTimer);
        abortBody = undefined;
        dispose();
      };
      const release = () => {
        try {
          reader.releaseLock();
        } catch {
          // An in-flight read releases the lock in its finally block.
        }
      };
      return new ReadableStream<Uint8Array>(
        {
          start(output) {
            abortBody = () => {
              if (finished) return;
              const reason = controller.signal.reason;
              finish();
              output.error(reason);
              void reader
                .cancel(reason)
                .catch(() => {})
                .finally(release);
            };
            if (controller.signal.aborted) abortBody();
          },
          async pull(output) {
            if (finished) return;
            // Only an upstream read is timed; downstream backpressure is allowed.
            idleTimer = setTimeout(() => {
              controller.abort(
                new DOMException("上游响应流超时", "TimeoutError"),
              );
              abortBody?.();
            }, timeoutMs);
            try {
              const { done, value } = await reader.read();
              clearTimeout(idleTimer);
              if (finished) return;
              if (done) {
                finish();
                output.close();
              } else {
                output.enqueue(value);
              }
            } catch (error) {
              if (!finished) {
                finish();
                output.error(error);
              }
            } finally {
              if (finished) release();
            }
          },
          async cancel(reason) {
            if (finished) return;
            finish();
            controller.abort();
            try {
              await reader.cancel(reason);
            } finally {
              release();
            }
          },
        },
        { highWaterMark: 0 },
      );
    },
  };
}
