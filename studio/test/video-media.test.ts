import { jest } from "@jest/globals";
import type { VideoResult } from "../app/store/video";

let active = true;
let owner = "user-7";
let token: number | null = 10;
let key = "private";
let customBase = "https://provider.test/v1/";
const blob = new Blob(["video"], { type: "video/mp4" });
const request = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("@/app/client/api", () => ({
  apiFetch: request,
  apiPath: (path: string, provider?: string) =>
    `${provider ? customBase : "/api/v1/"}${path}`,
}));
jest.unstable_mockModule("@/app/store/access", () => ({
  useAccessStore: { getState: () => ({ openaiApiKey: key }) },
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => owner,
  getLocalTokenId: () => token,
  isLocalWorkspaceActive: () => active,
  localKey: (name: string) => name,
}));
const { fetchVideoMedia } = await import("../app/utils/video-media");
const result: VideoResult = {
  id: "job",
  url: "https://chat.test/api/v1/videos/job/content",
  mediaPath: "videos/job/content",
  tokenId: 10,
  model: "sora-2",
  prompt: "Ocean",
  status: "success",
  createdAt: 1,
};
beforeEach(() => {
  window.dispatchEvent(new Event("local-data-maintenance"));
  active = true;
  owner = "user-7";
  token = 10;
  key = "private";
  customBase = "https://provider.test/v1/";
  request.mockReset().mockResolvedValue({ blob: async () => blob });
});

test("video files use the original selected token and a video Accept header", async () => {
  const controller = new AbortController();
  expect(await fetchVideoMedia(result, controller.signal)).toBe(blob);
  expect(request).toHaveBeenCalledWith(
    "videos/job/content",
    {
      signal: expect.any(AbortSignal),
      headers: {
        Accept: "video/*",
        "X-New-Api-Token": "10",
        Range: "bytes=0-4194303",
      },
    },
    undefined,
  );
});

test("changing models keeps media bound to the original token", async () => {
  const signal = new AbortController().signal;
  token = 20;
  await expect(fetchVideoMedia(result, signal)).resolves.toBe(blob);
  expect(request.mock.calls[0][1].headers["X-New-Api-Token"]).toBe("10");
});

test("an invalid relative path prevents all network access", async () => {
  const signal = new AbortController().signal;
  await expect(
    fetchVideoMedia({ ...result, mediaPath: "https://evil.test" }, signal),
  ).rejects.toThrow("路径");
  expect(request).not.toHaveBeenCalled();
});

test("switching account or maintenance during a download discards the bytes", async () => {
  for (const mutate of [
    () => {
      owner = "user-8";
    },
    () => {
      active = false;
    },
  ]) {
    active = true;
    owner = "user-7";
    token = 10;
    request.mockResolvedValueOnce({
      blob: async () => {
        mutate();
        return blob;
      },
    });
    await expect(
      fetchVideoMedia(result, new AbortController().signal),
    ).rejects.toThrow();
  }
});

test("switching model tokens during a download keeps the original video", async () => {
  request.mockResolvedValueOnce({
    blob: async () => {
      token = 20;
      return blob;
    },
  });
  await expect(
    fetchVideoMedia(result, new AbortController().signal),
  ).resolves.toBe(blob);
});

test("custom media never uses a new provider or a key changed mid-download", async () => {
  const custom = { ...result, tokenId: null, customApiBase: customBase };
  customBase = "https://other.test/v1/";
  await expect(
    fetchVideoMedia(custom, new AbortController().signal),
  ).rejects.toThrow("自定义接口");
  expect(request).not.toHaveBeenCalled();
  customBase = custom.customApiBase;
  request.mockResolvedValueOnce({
    blob: async () => {
      key = "changed";
      return blob;
    },
  });
  await expect(
    fetchVideoMedia(custom, new AbortController().signal),
  ).rejects.toThrow("自定义接口");
});

test("JSON disguised as a successful download never becomes a playable video", async () => {
  request.mockResolvedValueOnce({
    blob: async () => new Blob(["{}"], { type: "application/json" }),
  });
  await expect(
    fetchVideoMedia(result, new AbortController().signal),
  ).rejects.toThrow("视频文件");
});

test("returning to a video and opening the gallery reuse the same downloaded blob", async () => {
  await fetchVideoMedia(result, new AbortController().signal);
  await fetchVideoMedia({ ...result }, new AbortController().signal);
  expect(request).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("new-api-session-changed"));
  await fetchVideoMedia(result, new AbortController().signal);
  expect(request).toHaveBeenCalledTimes(2);
});

test("same-account group events preserve in-flight downloads and the shared cache", async () => {
  request.mockImplementationOnce(async () => {
    token = 20;
    window.dispatchEvent(
      new CustomEvent("new-api-session-changed", {
        detail: { userId: 7, tokenId: 20, group: "other" },
      }),
    );
    return { blob: async () => blob };
  });
  await expect(
    fetchVideoMedia(result, new AbortController().signal),
  ).resolves.toBe(blob);
  await fetchVideoMedia(result, new AbortController().signal);
  expect(request).toHaveBeenCalledTimes(1);
  window.dispatchEvent(
    new CustomEvent("new-api-session-changed", {
      detail: { userId: 8, tokenId: 30 },
    }),
  );
  await fetchVideoMedia(result, new AbortController().signal);
  expect(request).toHaveBeenCalledTimes(2);
});

test("concurrent viewers share a download and cancelling one does not cancel the other", async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  const first = new AbortController(),
    second = new AbortController();
  const one = fetchVideoMedia(result, first.signal);
  const rejected = expect(one).rejects.toMatchObject({ name: "AbortError" });
  const two = fetchVideoMedia(result, second.signal);
  first.abort();
  const sharedSignal = request.mock.calls[0][1].signal;
  expect(sharedSignal.aborted).toBe(false);
  finish({ blob: async () => blob });
  await rejected;
  expect(await two).toBe(blob);
  expect(request).toHaveBeenCalledTimes(1);
});

test("leaving the only viewer aborts work and a later viewer retries", async () => {
  request.mockImplementationOnce(
    (_path, options) =>
      new Promise((_done, reject) =>
        options.signal.addEventListener("abort", () =>
          reject(new DOMException("Cancelled", "AbortError")),
        ),
      ),
  );
  const controller = new AbortController();
  const pending = fetchVideoMedia(result, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  controller.abort();
  await rejected;
  expect(request.mock.calls[0][1].signal.aborted).toBe(true);
  expect(await fetchVideoMedia(result, new AbortController().signal)).toBe(
    blob,
  );
  expect(request).toHaveBeenCalledTimes(2);
});

test("the LRU holds at most ten videos and expires after thirty minutes", async () => {
  let now = 1000;
  const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
  try {
    for (let i = 0; i < 11; i++)
      await fetchVideoMedia(
        { ...result, mediaPath: `videos/job-${i}/content` },
        new AbortController().signal,
      );
    await fetchVideoMedia(
      { ...result, mediaPath: "videos/job-0/content" },
      new AbortController().signal,
    );
    expect(request).toHaveBeenCalledTimes(12);
    now += 30 * 60_000 - 1;
    await fetchVideoMedia(
      { ...result, mediaPath: "videos/job-0/content" },
      new AbortController().signal,
    );
    expect(request).toHaveBeenCalledTimes(12);
    now += 2;
    await fetchVideoMedia(
      { ...result, mediaPath: "videos/job-0/content" },
      new AbortController().signal,
    );
    expect(request).toHaveBeenCalledTimes(13);
  } finally {
    clock.mockRestore();
  }
});

test("account and custom credentials are part of cache identity", async () => {
  await fetchVideoMedia(result, new AbortController().signal);
  owner = "user-8";
  await fetchVideoMedia(result, new AbortController().signal);
  const custom = { ...result, tokenId: null, customApiBase: customBase };
  await fetchVideoMedia(custom, new AbortController().signal);
  key = "new-key";
  await fetchVideoMedia(custom, new AbortController().signal);
  expect(request).toHaveBeenCalledTimes(4);
});

test("the byte budget evicts older blobs and oversized videos are never retained", async () => {
  const large = new Blob(["large"], { type: "video/mp4" });
  Object.defineProperty(large, "size", { value: 160 * 1024 * 1024 });
  request.mockResolvedValue({ blob: async () => large });
  await fetchVideoMedia(result, new AbortController().signal);
  await fetchVideoMedia(
    { ...result, mediaPath: "videos/second/content" },
    new AbortController().signal,
  );
  await fetchVideoMedia(result, new AbortController().signal);
  expect(request).toHaveBeenCalledTimes(3);
  window.dispatchEvent(new Event("local-data-maintenance"));
  const huge = new Blob(["huge"], { type: "video/mp4" });
  Object.defineProperty(huge, "size", { value: 257 * 1024 * 1024 });
  request.mockResolvedValue({ blob: async () => huge });
  await fetchVideoMedia(result, new AbortController().signal);
  await fetchVideoMedia(result, new AbortController().signal);
  expect(request).toHaveBeenCalledTimes(5);
});

function partial(value: string, range: string, etag?: string) {
  return {
    status: 206,
    headers: new Headers({
      "content-range": range,
      ...(etag ? { etag } : {}),
    }),
    blob: async () => new Blob([value], { type: "video/mp4" }),
  };
}

test("versioned ranges download at most two tails concurrently and assemble in byte order", async () => {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let tailsStarted!: () => void;
  const tails = new Promise<void>((done) => {
    tailsStarted = done;
  });
  let started = 0;
  request.mockImplementation(async (_path, options) => {
    const range = options.headers.Range;
    if (range === "bytes=0-4194303")
      return partial("abc", "bytes 0-2/7", '"one"');
    expect(options.headers["If-Range"]).toBe('"one"');
    if (++started === 2) tailsStarted();
    await gate;
    return range === "bytes=3-4"
      ? partial("de", "bytes 3-4/7", '"one"')
      : partial("fg", "bytes 5-6/7", '"one"');
  });
  const loading = fetchVideoMedia(result, new AbortController().signal);
  await tails;
  expect(started).toBe(2);
  release();
  const loaded = await loading;
  const contents = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(loaded);
  });
  expect(contents).toBe("abcdefg");
  expect(loaded.type).toBe("video/mp4");
  await fetchVideoMedia(result, new AbortController().signal);
  expect(request).toHaveBeenCalledTimes(3);
});

test("a small video is complete after one ranged response", async () => {
  request.mockResolvedValueOnce(partial("video", "bytes 0-4/5"));
  expect(
    (await fetchVideoMedia(result, new AbortController().signal)).size,
  ).toBe(5);
  expect(request).toHaveBeenCalledTimes(1);
});

test("a provider without version validators falls back to one full download", async () => {
  request.mockResolvedValueOnce(partial("abc", "bytes 0-2/7"));
  await fetchVideoMedia(result, new AbortController().signal);
  expect(request.mock.calls[1][1].headers.Range).toBeUndefined();
  expect(request).toHaveBeenCalledTimes(2);
});

test("a full-download fallback never caches a partial response", async () => {
  request.mockResolvedValueOnce(partial("abc", "bytes 0-2/7"));
  request.mockResolvedValueOnce(partial("abc", "bytes 0-2/7"));
  await expect(
    fetchVideoMedia(result, new AbortController().signal),
  ).rejects.toThrow("完整的视频");
  expect(await fetchVideoMedia(result, new AbortController().signal)).toBe(
    blob,
  );
  expect(request).toHaveBeenCalledTimes(3);
});

test.each(["missing-etag", "changed-last-modified"])(
  "tail ranges reject inconsistent validators: %s",
  async (scenario) => {
    const modified = "Mon, 09 Nov 2026 00:00:00 GMT";
    const first = partial(
      "abc",
      "bytes 0-2/7",
      scenario === "missing-etag" ? '"one"' : undefined,
    );
    if (scenario === "changed-last-modified")
      first.headers.set("last-modified", modified);
    request.mockResolvedValueOnce(first);
    request.mockImplementationOnce(async () => {
      const tail = partial("de", "bytes 3-4/7");
      tail.headers.set("last-modified", "Mon, 09 Nov 2026 01:00:00 GMT");
      return tail;
    });
    request.mockResolvedValueOnce(partial("fg", "bytes 5-6/7", '"one"'));
    await expect(
      fetchVideoMedia(result, new AbortController().signal),
    ).rejects.toThrow("资源已变化");
  },
);

test("an explicit range rejection falls back but authentication failures are never retried", async () => {
  request.mockRejectedValueOnce(
    Object.assign(new Error("range rejected"), { status: 416 }),
  );
  await fetchVideoMedia(result, new AbortController().signal);
  expect(request.mock.calls[1][1].headers.Range).toBeUndefined();
  window.dispatchEvent(new Event("local-data-maintenance"));
  request.mockRejectedValueOnce(
    Object.assign(new Error("unauthorized"), { status: 401 }),
  );
  await expect(
    fetchVideoMedia(result, new AbortController().signal),
  ).rejects.toThrow("unauthorized");
  expect(request).toHaveBeenCalledTimes(3);
});

test("invalid or changed ranged responses cannot enter the shared cache", async () => {
  request.mockResolvedValueOnce(partial("abc", "bytes 0-2/7", '"one"'));
  request.mockResolvedValueOnce(partial("de", "bytes 3-4/7", '"changed"'));
  request.mockResolvedValueOnce(partial("fg", "bytes 5-6/7", '"one"'));
  await expect(
    fetchVideoMedia(result, new AbortController().signal),
  ).rejects.toThrow("资源已变化");
  expect(request.mock.calls[1][1].signal.aborted).toBe(true);
  expect(await fetchVideoMedia(result, new AbortController().signal)).toBe(
    blob,
  );
});
