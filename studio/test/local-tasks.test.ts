import { jest } from "@jest/globals";
let active = true;
let token: number | null = 10;
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => "user-7",
  getLocalTokenId: () => token,
  isLocalWorkspaceActive: () => active,
  localKey: (key: string) => `octopus:user-7:${key}`,
}));
const { pollLocalTask, rememberTask, pendingTasks, createTaskQueryQueue } =
  await import("../app/utils/local-tasks");
const task = {
  id: "job",
  kind: "image" as const,
  upstreamId: "a/b?c",
  model: "gpt-image",
  prompt: "test",
  tokenId: 10,
  createdAt: Date.now(),
};
beforeEach(() => {
  localStorage.clear();
  active = true;
  token = 10;
});

test("recovery queries images while a video is still generating", async () => {
  jest.useFakeTimers();
  const controller = new AbortController();
  try {
    const query = createTaskQueryQueue(1);
    const video = pollLocalTask(
      { ...task, kind: "video", protocol: "async" },
      () =>
        query(
          async () =>
            ({
              ok: true,
              json: async () => ({ status: "generating" }),
            }) as Response,
        ),
      controller.signal,
    ).catch((error) => error);
    const image = await pollLocalTask({ ...task, protocol: "async" }, () =>
      query(
        async () =>
          ({
            ok: true,
            json: async () => ({
              status: "succeeded",
              data: [{ url: "https://example.test/image" }],
            }),
          }) as Response,
      ),
    );
    expect(image.status).toBe("succeeded");
    controller.abort();
    expect((await video).name).toBe("AbortError");
  } finally {
    controller.abort();
    jest.useRealTimers();
  }
});

test("recovery queue bounds active GETs and releases slots after failures", async () => {
  const query = createTaskQueryQueue();
  let active = 0;
  let peak = 0;
  const result = await Promise.allSettled(
    Array.from({ length: 8 }, (_, index) =>
      query(async () => {
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
        if (index === 0) throw new Error("query failed");
        return index;
      }),
    ),
  );
  expect(peak).toBe(6);
  expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(7);
});

test.each([
  ["image", null],
  ["video", null],
  ["image", "1"],
] as const)(
  "async %s polling waits at least five seconds (Retry-After %s)",
  async (kind, retryAfter) => {
    jest.useFakeTimers();
    try {
      const fetchTask = jest
        .fn<(...args: any[]) => Promise<Response>>()
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => retryAfter },
          json: async () => ({ status: "generating" }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: "succeeded",
            data: [{ url: "https://example.test/result" }],
          }),
        } as Response);
      const result = pollLocalTask(
        { ...task, kind, protocol: "async" },
        fetchTask,
      );
      await jest.advanceTimersByTimeAsync(4999);
      expect(fetchTask).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await result;
      expect(fetchTask).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  },
);

test("restores only a query using an encoded upstream task identifier", async () => {
  rememberTask(task);
  const fetchTask = jest.fn<(...args: any[]) => Promise<Response>>(
    async () =>
      ({
        ok: true,
        json: async () => ({
          data: [{ url: "https://example.test/image.png" }],
        }),
      }) as Response,
  );
  await pollLocalTask(pendingTasks()[0], fetchTask);
  expect(fetchTask).toHaveBeenCalledTimes(1);
  expect(fetchTask).toHaveBeenCalledWith(
    "images/generations?task_id=a%2Fb%3Fc",
  );
});

test("a changed group does not stop recovery of an existing task", async () => {
  token = 20;
  const fetchTask = jest
    .fn<(...args: any[]) => Promise<Response>>()
    .mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: "https://example.test/image.png" }] }),
    } as Response);
  await expect(pollLocalTask(task, fetchTask)).resolves.toMatchObject({
    data: [{ url: "https://example.test/image.png" }],
  });
  expect(fetchTask).toHaveBeenCalledTimes(1);
});

test("results arriving after maintenance begins cannot restore deleted data", async () => {
  const fetchTask = async () => {
    active = false;
    return {
      ok: true,
      json: async () => ({ data: [{ url: "https://example.test/image.png" }] }),
    } as Response;
  };
  await expect(pollLocalTask(task, fetchTask)).rejects.toMatchObject({
    name: "AbortError",
  });
});

test.each(["image", "video"] as const)(
  "queries the dedicated async %s endpoint and accepts data URLs only on success",
  async (kind) => {
    const job = { ...task, kind, protocol: "async" as const };
    const fetchTask = jest.fn<(...args: any[]) => Promise<Response>>(
      async () =>
        ({
          ok: true,
          json: async () => ({
            status: "succeeded",
            data: [{ url: "https://example.test/media/id" }],
          }),
        }) as Response,
    );
    const data = await pollLocalTask(job, fetchTask);
    expect(fetchTask).toHaveBeenCalledWith(
      `async-${kind === "image" ? "images" : "videos"}/v1/tasks/a%2Fb%3Fc`,
    );
    expect(data.data[0].url).toBe("https://example.test/media/id");
  },
);

test.each(["save_failed", "indeterminate", "expired", "failed", "unknown"])(
  "async %s stops immediately without retrying generation or returning an unfinished URL",
  async (status) => {
    const job = { ...task, protocol: "async" as const };
    rememberTask(job);
    const fetchTask = jest.fn<(...args: any[]) => Promise<Response>>(
      async () =>
        ({
          ok: true,
          json: async () => ({
            status,
            error: { code: "test_reason" },
            data: [{ url: "https://example.test/unfinished" }],
          }),
        }) as Response,
    );
    await expect(pollLocalTask(job, fetchTask)).rejects.toThrow();
    expect(fetchTask).toHaveBeenCalledTimes(1);
    expect(pendingTasks()).toHaveLength(
      ["failed", "expired"].includes(status) ? 0 : 1,
    );
    if (!["failed", "expired"].includes(status))
      expect(pendingTasks()[0].needsAttention).toBe(true);
  },
);

test("retry clears attention without recreating a forgotten task", async () => {
  rememberTask({ ...task, needsAttention: true });
  await pollLocalTask(task, async () => {
    expect(pendingTasks()[0].needsAttention).toBe(false);
    localStorage.clear();
    return {
      ok: true,
      json: async () => ({ data: [{ url: "https://example.test/image" }] }),
    } as Response;
  });
  expect(pendingTasks()).toEqual([]);
});

test("async polling respects Retry-After and does not repeat the submit POST", async () => {
  jest.useFakeTimers();
  try {
    const fetchTask = jest
      .fn<(...args: any[]) => Promise<Response>>()
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "7" },
        json: async () => ({ status: "saving" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "succeeded",
          data: [{ url: "https://example.test/image" }],
        }),
      } as Response);
    const result = pollLocalTask({ ...task, protocol: "async" }, fetchTask);
    await jest.advanceTimersByTimeAsync(6999);
    expect(fetchTask).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await result;
    expect(fetchTask).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

test("thrown API errors retain rate-limit delays and stop immediately on a changed token", async () => {
  jest.useFakeTimers();
  try {
    const fetchTask = jest
      .fn<(...args: any[]) => Promise<Response>>()
      .mockRejectedValueOnce(
        Object.assign(new Error("rate limited"), {
          status: 429,
          retryAfter: "9",
        }),
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "succeeded",
          data: [{ url: "https://example.test/image" }],
        }),
      } as Response);
    const result = pollLocalTask({ ...task, protocol: "async" }, fetchTask);
    await jest.advanceTimersByTimeAsync(8999);
    expect(fetchTask).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await result;
    const changed = jest
      .fn<(...args: any[]) => Promise<Response>>()
      .mockRejectedValue(Object.assign(new Error("changed"), { status: 409 }));
    await expect(
      pollLocalTask({ ...task, protocol: "async" }, changed),
    ).rejects.toThrow("原密钥");
    expect(changed).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test.each(["response", "error"] as const)(
  "repeated 429 %s backs off without consuming the network-failure allowance",
  async (mode) => {
    jest.useFakeTimers();
    try {
      let calls = 0;
      const fetchTask = jest.fn(async () => {
        calls++;
        if (calls <= 4) {
          if (mode === "error")
            throw Object.assign(new Error("limited"), {
              status: 429,
              retryAfter: "10",
            });
          return {
            ok: false,
            status: 429,
            headers: { get: () => "10" },
          } as unknown as Response;
        }
        return {
          ok: true,
          json: async () => ({
            status: "succeeded",
            url: "https://example.test/result",
          }),
        } as Response;
      });
      const result = pollLocalTask({ ...task, protocol: "async" }, fetchTask);
      // The first two delays are 10s, then exponential backoff is 20s and 40s.
      await jest.advanceTimersByTimeAsync(79_999);
      expect(fetchTask).toHaveBeenCalledTimes(4);
      await jest.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toMatchObject({ status: "succeeded" });
      expect(fetchTask).toHaveBeenCalledTimes(5);
    } finally {
      jest.useRealTimers();
    }
  },
);

test.each(["seconds", "http-date"] as const)(
  "429 honors Retry-After longer than a minute (%s)",
  async (format) => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-31T00:00:00Z"));
    try {
      const retryAfter =
        format === "seconds"
          ? "90"
          : new Date(Date.now() + 90_000).toUTCString();
      const fetchTask = jest
        .fn<(...args: any[]) => Promise<Response>>()
        .mockRejectedValueOnce(
          Object.assign(new Error("limited"), {
            status: 429,
            retryAfter,
          }),
        )
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: "succeeded",
            url: "https://example.test/result",
          }),
        } as Response);
      const result = pollLocalTask({ ...task, protocol: "async" }, fetchTask);
      await jest.advanceTimersByTimeAsync(89_999);
      expect(fetchTask).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await result;
    } finally {
      jest.useRealTimers();
    }
  },
);

test("new and recovered pollers share six active queries including body reads", async () => {
  let activeQueries = 0;
  let peak = 0;
  const releases: (() => void)[] = [];
  const fetchTask = jest.fn(async () => {
    activeQueries++;
    peak = Math.max(peak, activeQueries);
    return {
      ok: true,
      json: () =>
        new Promise((resolve) => {
          releases.push(() => {
            activeQueries--;
            resolve({
              status: "succeeded",
              url: "https://example.test/result",
            });
          });
        }),
    } as unknown as Response;
  });
  const results = Array.from({ length: 8 }, (_, index) =>
    pollLocalTask(
      { ...task, id: `parallel-${index}`, protocol: "async" },
      fetchTask,
    ),
  );
  await Promise.resolve();
  expect(fetchTask).toHaveBeenCalledTimes(6);
  while (releases.length || activeQueries) {
    releases.splice(0).forEach((release) => release());
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await Promise.all(results);
  expect(peak).toBe(6);
  expect(fetchTask).toHaveBeenCalledTimes(8);
});

test("a queued query can be cancelled without blocking later jobs", async () => {
  const query = createTaskQueryQueue(1);
  let release!: () => void;
  const first = query(
    () => new Promise<void>((resolve) => (release = resolve)),
  );
  const controller = new AbortController();
  const skipped = jest.fn(async () => "skipped");
  const cancelled = query(skipped, controller.signal);
  const rejected = expect(cancelled).rejects.toMatchObject({
    name: "AbortError",
  });
  const next = query(async () => "next");
  controller.abort();
  await rejected;
  release();
  await first;
  await expect(next).resolves.toBe("next");
  expect(skipped).not.toHaveBeenCalled();
});

test("ordinary query network errors still stop after three attempts", async () => {
  jest.useFakeTimers();
  try {
    const fetchTask = jest.fn(async () => {
      throw new Error("offline");
    });
    const result = pollLocalTask({ ...task, protocol: "async" }, fetchTask);
    const rejected = expect(result).rejects.toThrow("offline");
    await jest.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(fetchTask).toHaveBeenCalledTimes(3);
  } finally {
    jest.useRealTimers();
  }
});

test.each([
  [
    "openai",
    "video_1",
    "videos/video_1",
    { status: "completed" },
    "videos/video_1/content",
  ],
  [
    "gemini",
    "models/veo/operations/op_1",
    "v1beta/models/veo/operations/op_1",
    {
      done: true,
      response: {
        generateVideoResponse: {
          generatedSamples: [
            {
              video: {
                uri: "https://generativelanguage.googleapis.com/v1beta/files/file_1:download",
              },
            },
          ],
        },
      },
    },
    "v1beta/files/file_1:download?alt=media",
  ],
] as const)(
  "restores %s tasks with their saved protocol and authenticated output",
  async (apiFormat, upstreamId, path, value, mediaPath) => {
    const job = {
      ...task,
      kind: "video" as const,
      upstreamId,
      video: {
        apiFormat,
        mode: "text-to-video",
        aspectRatio: "16:9",
        resolution: "720p",
        duration: 8,
      },
    };
    rememberTask(job);
    const fetchTask = jest.fn(
      async () =>
        ({
          ok: true,
          json: async () => value,
        }) as Response,
    );
    expect(await pollLocalTask(pendingTasks()[0], fetchTask)).toMatchObject({
      mediaPath,
    });
    expect(fetchTask).toHaveBeenCalledTimes(1);
    expect(fetchTask).toHaveBeenCalledWith(path);
  },
);

test("a running xAI response URL is not treated as completed", async () => {
  jest.useFakeTimers();
  try {
    const fetchTask = jest
      .fn<(...args: any[]) => Promise<Response>>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "pending",
          video_url: "https://cdn.test/unfinished",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "done",
          video: { url: "https://cdn.test/finished" },
        }),
      } as Response);
    const promise = pollLocalTask(
      {
        ...task,
        kind: "video",
        upstreamId: "req_1",
        video: {
          apiFormat: "xai",
          mode: "text-to-video",
          aspectRatio: "16:9",
          resolution: "720p",
          duration: 8,
        },
      },
      fetchTask,
    );
    await jest.advanceTimersByTimeAsync(2000);
    expect(await promise).toMatchObject({
      video_url: "https://cdn.test/finished",
    });
    expect(fetchTask).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

test("a filtered Gemini operation stops immediately and keeps its recovery record", async () => {
  const job = {
    ...task,
    kind: "video" as const,
    upstreamId: "models/veo/operations/op_1",
    video: {
      apiFormat: "gemini" as const,
      mode: "text-to-video",
      aspectRatio: "16:9",
      resolution: "720p",
      duration: 8,
    },
  };
  rememberTask(job);
  const fetchTask = jest.fn(
    async () =>
      ({
        ok: true,
        json: async () => ({ done: true, response: {} }),
      }) as Response,
  );
  await expect(pollLocalTask(job, fetchTask)).rejects.toThrow("已结束");
  expect(fetchTask).toHaveBeenCalledTimes(1);
  expect(pendingTasks()[0].needsAttention).toBe(true);
});

test("Seedance resumes the saved native task path and reads its successful video output", async () => {
  jest.useFakeTimers();
  try {
    const job = {
      ...task,
      kind: "video" as const,
      upstreamId: "cgt_1",
      video: {
        apiFormat: "seedance" as const,
        mode: "text-to-video",
        aspectRatio: "16:9",
        resolution: "720p",
        duration: 8,
      },
    };
    rememberTask(job);
    const fetchTask = jest
      .fn<(...args: any[]) => Promise<Response>>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "running" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "succeeded",
          content: { video_url: "https://cdn.test/seedance.mp4" },
        }),
      } as Response);
    const result = pollLocalTask(pendingTasks()[0], fetchTask);
    await jest.advanceTimersByTimeAsync(2000);
    expect(await result).toMatchObject({
      video_url: "https://cdn.test/seedance.mp4",
    });
    expect(fetchTask.mock.calls).toEqual([
      ["api/v3/contents/generations/tasks/cgt_1"],
      ["api/v3/contents/generations/tasks/cgt_1"],
    ]);
  } finally {
    jest.useRealTimers();
  }
});

test.each(["legacy", "openai"] as const)(
  "%s video terminal failure retains the upstream balance message",
  async (apiFormat) => {
    const job = {
      ...task,
      kind: "video" as const,
      video: { apiFormat, mode: "text-to-video" },
    };
    rememberTask(job);
    const fetchTask = jest
      .fn<(...args: any[]) => Promise<Response>>()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "failed",
          error: {
            code: "upstream_error",
            message: "Insufficient user quota, remaining quota: 0",
          },
        }),
      } as Response);
    await expect(pollLocalTask(job, fetchTask)).rejects.toThrow(
      "Insufficient user quota, remaining quota: 0",
    );
    expect(fetchTask).toHaveBeenCalledTimes(1);
    expect(pendingTasks()).toHaveLength(0);
  },
);
