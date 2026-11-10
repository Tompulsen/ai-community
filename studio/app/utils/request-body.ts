export class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function modelBodyLimit(path: string) {
  // Base64 expands a 20 MiB video to about 27 MiB; preserve that upload workflow.
  return /(?:^|\/)(?:async-)?images(?:\/|$)/.test(path)
    ? 64 * 1024 * 1024
    : 40 * 1024 * 1024;
}

export async function readRequestBody(
  req: Request,
  maxBytes: number,
  timeoutMs = 30_000,
): Promise<Buffer | undefined> {
  const tooLarge = () =>
    new RequestBodyError(
      `请求内容超过 ${Math.floor(
        maxBytes / 1024 / 1024,
      )}MB，请减少附件或上下文`,
      413,
    );
  if (Number(req.headers.get("content-length")) > maxBytes) {
    void req.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!req.body) return undefined;
  const reader = req.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    const fail = (error: RequestBodyError) => {
      reject(error);
      // Do not let an uncooperative stream's cancel() delay the error response.
      void reader.cancel().catch(() => {});
    };
    abort = () => fail(new RequestBodyError("请求已取消", 400));
    timer = setTimeout(
      () => fail(new RequestBodyError("上传内容读取超时，请重试", 408)),
      timeoutMs,
    );
    req.signal.addEventListener("abort", abort, { once: true });
    if (req.signal.aborted) abort();
  });
  const read = async () => {
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw tooLarge();
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  };
  try {
    return await Promise.race([read(), interrupted]);
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError("无法读取上传内容，请重试", 400);
  } finally {
    clearTimeout(timer);
    req.signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
