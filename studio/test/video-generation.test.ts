import { jest } from "@jest/globals";
import type { VideoDraft, VideoResult } from "../app/store/video";
import { createMemoryKeyvalStore } from "./mocks/memory-keyval-store";

let active = true;
let owner = "user-7";
let token: number | null = 10;
let custom = false;
let customKey = "private";
let customBase = "https://provider.test/v1/";
const records = new Map<string, unknown>();
const writes = new Set<Promise<unknown>>();
const atomicWrite =
  jest.fn<(entries: [IDBValidKey, unknown][]) => Promise<void>>();
const transactions = createMemoryKeyvalStore(records, { write: atomicWrite });
const request = jest.fn<(...args: any[]) => Promise<Response>>();
jest.unstable_mockModule("idb-keyval", () => ({
  get: async (key: string) => records.get(key),
  set: async (key: string, value: unknown) => records.set(key, value),
  createStore: () => transactions,
  del: async (key: string) => records.delete(key),
  delMany: async (keys: string[]) => keys.forEach((key) => records.delete(key)),
  clear: async () => records.clear(),
}));
jest.unstable_mockModule("@/app/utils", () => ({
  safeLocalStorage: () => localStorage,
}));
jest.unstable_mockModule("@/app/client/api", () => ({
  apiFetch: request,
  apiPath: (path: string, provider?: string) =>
    `${provider ? customBase : "/api/v1/"}${path}`,
}));
jest.unstable_mockModule("@/app/store/access", () => ({
  useAccessStore: {
    getState: () => ({ useCustomConfig: custom, openaiApiKey: customKey }),
  },
}));
jest.unstable_mockModule("@/app/utils/model", () => ({
  getModelProvider: (model: string) => [
    model.split("@")[0],
    custom ? "Custom" : undefined,
  ],
}));
jest.unstable_mockModule("@/app/utils/custom-provider", () => ({
  CUSTOM_MODEL_PROVIDER: "Custom",
  usesCustomProvider: () => custom,
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => owner,
  getLocalTokenId: () => token,
  isLocalWorkspaceActive: () => active,
  localKey: (key: string, scope = owner) => `octopus:${scope}:${key}`,
  persistLocalWrite: (action: () => Promise<void>) => {
    const promise = active ? action() : Promise.resolve();
    writes.add(promise);
    void promise.finally(() => writes.delete(promise)).catch(() => {});
    return promise;
  },
}));
const {
  useVideoStore,
  readVideoResults,
  writeVideoResults,
  removeVideoWorkspaceData,
} = await import("../app/store/video");
const {
  generateVideoRequest,
  stopVideoWaiting,
  resumeVideoRequest,
  reuseVideoRequest,
} = await import("../app/utils/video-generation");
const { pendingTasks } = await import("../app/utils/local-tasks");
const initialDraft = JSON.parse(
  JSON.stringify(useVideoStore.getState().draft),
) as VideoDraft;
const resultsKey = "octopus:user-7:video-workspace-results";
const draftKey = "octopus:user-7:video-workspace-draft";
const response = (value: unknown) =>
  ({
    ok: true,
    headers: { get: () => null },
    json: async () => value,
  }) as unknown as Response;
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function until(condition: () => boolean) {
  for (let turn = 0; turn < 250 && !condition(); turn++)
    await Promise.resolve();
  expect(condition()).toBe(true);
}
async function settleWrites() {
  while (writes.size) await Promise.allSettled([...writes]);
}
function draft(patch: Partial<VideoDraft> = {}): VideoDraft {
  return {
    ...initialDraft,
    model: "sora-2",
    resolution: "720p",
    size: "1280x720",
    prompt: "Ocean waves",
    draftAutoSave: false,
    ...patch,
  };
}
function result(patch: Partial<VideoResult> = {}): VideoResult {
  return {
    id: "restored",
    url: "",
    prompt: "Ocean waves",
    model: "sora-2",
    status: "pending",
    createdAt: 1,
    tokenId: 10,
    upstreamId: "remote",
    request: draft(),
    ...patch,
  };
}
beforeEach(async () => {
  await settleWrites();
  jest.useFakeTimers();
  records.clear();
  localStorage.clear();
  active = true;
  owner = "user-7";
  token = 10;
  custom = false;
  customKey = "private";
  customBase = "https://provider.test/v1/";
  atomicWrite.mockReset().mockResolvedValue(undefined);
  request.mockReset();
  useVideoStore.setState({
    draft: draft(),
    draftRevision: 0,
    hasHydrated: true,
    results: [],
    isGenerating: false,
    generateProgress: undefined,
    generateStatus: "",
    selectedResultId: null,
  });
});
afterEach(async () => {
  for (const item of useVideoStore.getState().results)
    if (item.status === "pending") stopVideoWaiting(item.id);
  await settleWrites();
  jest.useRealTimers();
});

test("durably saves one immutable request before clearing the composer or issuing one paid POST", async () => {
  const gate = deferred();
  await useVideoStore
    .getState()
    .addResult(result({ id: "older", status: "failed" }));
  atomicWrite.mockImplementationOnce(() => gate.promise);
  request.mockImplementation(async (_path, options) => {
    const rows = await readVideoResults();
    expect(rows.at(-1)?.request?.prompt).toBe("Ocean waves");
    expect(useVideoStore.getState().draft.prompt).toBe("");
    return response(
      options?.method === "POST" ? { id: "remote" } : { status: "completed" },
    );
  });
  const first = generateVideoRequest();
  expect(generateVideoRequest()).toBe(first);
  await until(() => useVideoStore.getState().results.length === 2);
  expect(request).not.toHaveBeenCalled();
  expect(useVideoStore.getState().draft.prompt).toBe("Ocean waves");
  const submitted = useVideoStore.getState().results[1];
  expect(Object.isFrozen(submitted.request)).toBe(true);
  gate.resolve();
  await first;
  expect(
    request.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(1);
  expect(useVideoStore.getState().results.map((item) => item.id)).toEqual([
    "older",
    submitted.id,
  ]);
  expect(useVideoStore.getState().results[1]).toMatchObject({
    status: "success",
    upstreamId: "remote",
  });
  expect(pendingTasks()).toEqual([]);
});

test("a failed durable snapshot never sends or clears the request", async () => {
  atomicWrite.mockRejectedValueOnce(new Error("QuotaExceededError"));
  await generateVideoRequest();
  expect(request).not.toHaveBeenCalled();
  expect(useVideoStore.getState().draft.prompt).toBe("Ocean waves");
  expect(useVideoStore.getState().results[0]).toMatchObject({
    status: "failed",
    error: "QuotaExceededError",
    request: { prompt: "Ocean waves" },
  });
});

test.each([false, true])(
  "a definite POST failure restores only an unchanged composer (new edit %s)",
  async (edited) => {
    request.mockImplementation(async () => {
      if (edited)
        useVideoStore.getState().updateDraft({ prompt: "New prompt" });
      throw Object.assign(new Error("Unsupported request"), { status: 400 });
    });
    await generateVideoRequest();
    expect(useVideoStore.getState().draft.prompt).toBe(
      edited ? "New prompt" : "Ocean waves",
    );
    expect(useVideoStore.getState().results[0]).toMatchObject({
      status: "failed",
      request: { prompt: "Ocean waves" },
    });
    expect(pendingTasks()).toEqual([]);
  },
);

test("a lost POST response retains uncertainty and cannot be resumed by another POST", async () => {
  request.mockRejectedValueOnce(new TypeError("Network lost"));
  await generateVideoRequest();
  const row = useVideoStore.getState().results[0];
  expect(row).toMatchObject({ status: "pending", phase: "paused" });
  expect(row.error).toContain("勿重复提交");
  expect(pendingTasks()[0]).toMatchObject({
    id: row.id,
    upstreamId: "",
    paused: true,
  });
  await resumeVideoRequest(row.id);
  expect(request).toHaveBeenCalledTimes(1);
  expect(useVideoStore.getState().draft.prompt).toBe("");
});

test("an explicit failed submission response preserves its error and original composer", async () => {
  request.mockResolvedValueOnce(
    response({ status: "failed", error: { message: "Generation rejected" } }),
  );
  await generateVideoRequest();
  expect(useVideoStore.getState().results[0]).toMatchObject({
    status: "failed",
    error: "Generation rejected",
  });
  expect(useVideoStore.getState().draft.prompt).toBe("Ocean waves");
  expect(pendingTasks()).toEqual([]);
});

test("stopping an in-flight submission retains uncertainty rather than allowing a blind retry", async () => {
  request.mockImplementationOnce(
    (_path, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        );
      }),
  );
  const generating = generateVideoRequest();
  await until(() => request.mock.calls.length === 1);
  const id = useVideoStore.getState().results[0].id;
  stopVideoWaiting(id);
  await generating;
  expect(useVideoStore.getState().results[0]).toMatchObject({
    status: "pending",
    phase: "paused",
  });
  expect(useVideoStore.getState().results[0].error).toContain("勿重复提交");
  await resumeVideoRequest(id);
  expect(request).toHaveBeenCalledTimes(1);
});

test("deleting an in-flight submission never recreates its row or recovery task", async () => {
  request.mockImplementationOnce(
    (_path, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        );
      }),
  );
  const generating = generateVideoRequest();
  await until(() => request.mock.calls.length === 1);
  const id = useVideoStore.getState().results[0].id;
  await useVideoStore.getState().removeResult(id);
  await generating;
  expect(useVideoStore.getState().results).toEqual([]);
  expect(await readVideoResults()).toEqual([]);
  expect(pendingTasks()).toEqual([]);
});

test("unknown progress stays absent; stopping and simultaneous resumes issue GETs only", async () => {
  request.mockResolvedValueOnce(response({ id: "remote" }));
  request.mockResolvedValueOnce(
    response({ status: "in_progress", progress: null }),
  );
  const generating = generateVideoRequest();
  await until(() => request.mock.calls.length === 2);
  const id = useVideoStore.getState().results[0].id;
  await until(() => useVideoStore.getState().results[0].phase === "generating");
  expect(useVideoStore.getState().results[0].progress).toBeUndefined();
  stopVideoWaiting(id);
  await generating;
  expect(pendingTasks()[0]).toMatchObject({ id, paused: true });
  const gate = deferred<Response>();
  request.mockImplementationOnce(() => gate.promise);
  const one = resumeVideoRequest(id);
  const two = resumeVideoRequest(id);
  await until(() => request.mock.calls.length === 3);
  gate.resolve(response({ status: "completed" }));
  await Promise.all([one, two]);
  expect(
    request.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(1);
  expect(request.mock.calls).toHaveLength(3);
  expect(useVideoStore.getState().results[0]).toMatchObject({
    id,
    status: "success",
  });
});

test("actual progress updates the same row and cannot replace a completed row", async () => {
  request.mockResolvedValueOnce(response({ id: "remote" }));
  request.mockResolvedValueOnce(
    response({ status: "in_progress", progress: 37 }),
  );
  request.mockResolvedValueOnce(response({ status: "completed" }));
  const generating = generateVideoRequest();
  await until(() => useVideoStore.getState().results[0]?.progress === 37);
  const id = useVideoStore.getState().results[0].id;
  await jest.advanceTimersByTimeAsync(2000);
  await generating;
  await settleWrites();
  expect(useVideoStore.getState().results).toHaveLength(1);
  expect((await readVideoResults())[0]).toMatchObject({
    id,
    status: "success",
  });
  expect((await readVideoResults())[0].progress).toBeUndefined();
});

test("an upstream terminal failure stays inline with its original request", async () => {
  request.mockResolvedValueOnce(response({ id: "remote" }));
  request.mockResolvedValueOnce(
    response({ status: "failed", error: "Rejected by provider" }),
  );
  await generateVideoRequest();
  expect(useVideoStore.getState().results[0]).toMatchObject({
    status: "failed",
    error: "Rejected by provider",
    request: { prompt: "Ocean waves" },
  });
  expect(pendingTasks()).toEqual([]);
});

test("a restored task uses its original token after changing groups", async () => {
  await useVideoStore.getState().addResult(result());
  token = 20;
  request.mockResolvedValueOnce(response({ status: "completed" }));
  await resumeVideoRequest("restored");
  expect(request.mock.calls[0][1].headers["X-New-Api-Token"]).toBe("10");
  expect(useVideoStore.getState().results[0]).toMatchObject({
    status: "success",
  });
  expect(pendingTasks()).toEqual([]);
});

test.each(["scope", "token", "custom key"] as const)(
  "a late response after changing %s never writes success",
  async (change) => {
    if (change === "custom key") custom = true;
    const gate = deferred<Response>();
    request.mockResolvedValueOnce(response({ id: "remote" }));
    request.mockImplementationOnce(() => gate.promise);
    const generating = generateVideoRequest();
    await until(() => request.mock.calls.length === 2);
    if (change === "scope") owner = "user-8";
    else if (change === "token") token = 20;
    else customKey = "changed";
    gate.resolve(response({ status: "completed" }));
    await generating;
    expect(useVideoStore.getState().results[0].status).toBe(
      change === "token" ? "success" : "pending",
    );
    expect(records.has("octopus:user-8:video-workspace-results")).toBe(false);
    owner = "user-7";
  },
);

test("large request materials survive reload and reuse without entering localStorage mirrors", async () => {
  const payload = `data:video/mp4;base64,${"A".repeat(1024 * 1024)}`;
  const saved = draft({
    materials: [
      { id: "material", type: "video", name: "source.mp4", url: payload },
    ],
    draftAutoSave: true,
  });
  useVideoStore.setState({ draft: saved });
  await useVideoStore.getState().saveDraft();
  await useVideoStore.getState().addResult(result({ request: saved }));
  expect(localStorage.getItem(resultsKey)).not.toContain(payload);
  expect(localStorage.getItem(draftKey)).not.toContain(payload);
  expect(String(records.get(resultsKey)).length).toBeLessThan(4000);
  useVideoStore.setState({ draft: draft(), results: [], hasHydrated: false });
  await useVideoStore.getState().loadDraft();
  expect(useVideoStore.getState().draft.materials[0].url).toBe(payload);
  expect(useVideoStore.getState().results[0].phase).toBe("paused");
  useVideoStore.getState().clearMaterials();
  expect(await reuseVideoRequest("restored")).toBe(true);
  expect(useVideoStore.getState().draft.materials[0].url).toBe(payload);
  expect(request).not.toHaveBeenCalled();
});

test("pre-hydration edits do not overwrite the stored draft or race the saved history", async () => {
  const saved = draft({ prompt: "Saved prompt", draftAutoSave: true });
  useVideoStore.setState({ draft: saved });
  await useVideoStore.getState().saveDraft();
  useVideoStore.setState({
    draft: draft({ draftAutoSave: true }),
    hasHydrated: false,
  });
  useVideoStore.getState().updateDraft({ model: "sora-2-pro" });
  await settleWrites();
  const stored = JSON.parse(String(records.get(draftKey)));
  expect(stored.state.draft.prompt).toBe("Saved prompt");
  await useVideoStore.getState().loadDraft();
  expect(useVideoStore.getState().draft.model).toBe("sora-2-pro");
  expect(useVideoStore.getState().draft.prompt).toBe("Saved prompt");
});

test("retrying a saved request or confirming an older draft leaves new composer edits untouched", async () => {
  const confirmed = useVideoStore.getState().draft;
  useVideoStore.getState().updateDraft({ prompt: "New composer text" });
  request.mockImplementation(async (_path, options) =>
    response(
      options?.method === "POST" ? { id: "remote" } : { status: "completed" },
    ),
  );
  await generateVideoRequest(confirmed);
  expect(useVideoStore.getState().draft.prompt).toBe("New composer text");
  expect(useVideoStore.getState().results[0].request?.prompt).toBe(
    "Ocean waves",
  );
  await generateVideoRequest(useVideoStore.getState().results[0].request);
  expect(useVideoStore.getState().draft.prompt).toBe("New composer text");
});

test("legacy results reuse known request fields and keep parameters that were never recorded", async () => {
  useVideoStore.setState({
    draft: draft({ negativePrompt: "Keep parameter", duration: 4 }),
  });
  await useVideoStore.getState().addResult(
    result({
      request: undefined,
      model: "grok-imagine-video",
      prompt: "Legacy prompt",
      duration: 6,
      aspectRatio: "9:16",
    }),
  );
  expect(await reuseVideoRequest("restored")).toBe(true);
  expect(useVideoStore.getState().draft).toMatchObject({
    prompt: "Legacy prompt",
    model: "grok-imagine-video",
    duration: 6,
    aspectRatio: "9:16",
    negativePrompt: "Keep parameter",
  });
  expect(request).not.toHaveBeenCalled();
});

test("scoped cleanup removes this account's snapshots and assets only", async () => {
  const payload = `data:image/png;base64,${"A".repeat(100000)}`;
  const saved = result({
    request: draft({
      materials: [
        { id: "image", type: "image", name: "image.png", url: payload },
      ],
    }),
  });
  await writeVideoResults([saved], "user-7");
  await writeVideoResults([saved], "user-8");
  await removeVideoWorkspaceData("user-7");
  expect([...records.keys()].some((key) => key.startsWith(resultsKey))).toBe(
    false,
  );
  expect(await readVideoResults("user-8")).toHaveLength(1);
  expect((await readVideoResults("user-8"))[0].request?.materials[0].url).toBe(
    payload,
  );
});

test("size selection applies model limits, recalculates dimensions and stores auto", async () => {
  const store = useVideoStore.getState();
  await store.loadDraft();
  store.updateDraft({
    model: "grok-imagine-video",
    resolution: "480p",
    aspectRatio: "16:9",
  });
  expect(useVideoStore.getState().draft.size).toBe("854x480");
  store.updateDraft({ size: "1000x600" });
  store.updateDraft({ model: "veo-3.1" });
  expect(useVideoStore.getState().draft.size).toBe("1280x720");
  store.updateDraft({ aspectRatio: "9:16" });
  expect(useVideoStore.getState().draft.size).toBe("720x1280");
  store.updateDraft({ aspectRatio: "auto" });
  expect(useVideoStore.getState().draft.size).toBe("auto");
  await store.saveDraft();
  expect(JSON.parse(localStorage.getItem(draftKey)!).size).toBe("auto");
  store.updateDraft({ aspectRatio: "16:9" });
  expect(useVideoStore.getState().draft.size).toBe("1280x720");
});

test("resolution changes during hydration calculate with the restored aspect ratio", async () => {
  useVideoStore.setState({
    draft: draft({
      model: "grok-imagine-video",
      aspectRatio: "9:16",
      resolution: "720p",
      size: "720x1280",
    }),
  });
  await useVideoStore.getState().saveDraft();
  useVideoStore.setState({ draft: draft(), hasHydrated: false });
  useVideoStore.getState().updateDraft({ resolution: "480p" });
  await useVideoStore.getState().loadDraft();
  expect(useVideoStore.getState().draft.aspectRatio).toBe("9:16");
  expect(useVideoStore.getState().draft.size).toBe("480x854");
});

test("chat video persists the message-linked result and clean references without resubmission", async () => {
  const { chatVideoDraft } = await import("../app/utils/chat-video");
  const input = chatVideoDraft(
    "original video prompt",
    "sora-2",
    "",
    [],
    "work1",
  );
  expect(input.customParams).toEqual({});
  expect(input.sourceWorkId).toBe("work1");
  expect(input.mode).toBe("text-to-video");
  request.mockResolvedValue(
    response({ status: "completed", url: "https://fixture/video.mp4" }),
  );
  await generateVideoRequest(input, "chat-message-id");
  const stored = useVideoStore
    .getState()
    .results.find((item) => item.id === "chat-message-id");
  expect(stored?.status).toBe("success");
  expect(stored?.request?.prompt).toBe("original video prompt");
  expect(request).toHaveBeenCalledTimes(1);
  expect(
    (await readVideoResults()).some((item) => item.id === "chat-message-id"),
  ).toBe(true);
});

test("two chat videos can run with different groups and duplicate triggers share one paid submission", async () => {
  const gate = deferred();
  request.mockImplementation(async () => {
    await gate.promise;
    return response({ status: "completed", url: "https://fixture/video.mp4" });
  });
  const first = generateVideoRequest(draft({ prompt: "First" }), "first", 10);
  expect(
    generateVideoRequest(draft({ prompt: "Duplicate" }), "first", 10),
  ).toBe(first);
  token = 20;
  const second = generateVideoRequest(
    draft({ prompt: "Second" }),
    "second",
    20,
  );
  await until(() => request.mock.calls.length === 2);
  expect(
    request.mock.calls.map((call) => call[1].headers["X-New-Api-Token"]).sort(),
  ).toEqual(["10", "20"]);
  gate.resolve();
  await Promise.all([first, second]);
  expect(request).toHaveBeenCalledTimes(2);
  expect(
    useVideoStore.getState().results.filter((row) => row.status === "success"),
  ).toHaveLength(2);
});

test("chat video parameters reach the existing model payload with an independent snapshot", async () => {
  const { chatVideoDraft } = await import("../app/utils/chat-video");
  const config: Partial<VideoDraft> = {
    resolution: "720p",
    aspectRatio: "9:16",
    duration: 12,
    protocolOptions: { openai: { generateAudio: true } },
  };
  const input = chatVideoDraft(
    "Follow the waves",
    "grok-imagine-video",
    "OpenAI",
    [],
    undefined,
    config,
  );
  expect(input).toMatchObject({
    model: "grok-imagine-video@OpenAI",
    prompt: "Follow the waves",
    size: "720x1280",
    resolution: "720p",
    aspectRatio: "9:16",
    duration: 12,
  });
  config.duration = 30;
  config.protocolOptions!.openai!.generateAudio = false;
  expect(input.duration).toBe(12);
  expect(input.protocolOptions?.openai?.generateAudio).toBe(true);
  expect(Object.isFrozen(input)).toBe(true);
  expect(Object.isFrozen(input.protocolOptions?.openai)).toBe(true);
  request.mockResolvedValue(
    response({ status: "completed", url: "https://fixture/video.mp4" }),
  );
  await generateVideoRequest(input, "configured-chat-message");
  expect(request).toHaveBeenCalledTimes(1);
  const payload = JSON.parse(request.mock.calls[0][1].body);
  expect(payload).toMatchObject({
    model: "grok-imagine-video",
    prompt: "Follow the waves",
    seconds: "12",
    aspect_ratio: "9:16",
    resolution: "720p",
    generate_audio: true,
  });
  expect(
    useVideoStore
      .getState()
      .results.find((item) => item.id === "configured-chat-message")?.request
      ?.duration,
  ).toBe(12);
});

test.each([
  [0, "text-to-video"],
  [1, "image-to-video"],
  [2, "reference-to-video"],
] as const)(
  "chat video automatically selects the mode for %i reference images",
  async (count, mode) => {
    const { chatVideoDraft } = await import("../app/utils/chat-video");
    const image = ["data:image/png;base64", btoa("reference")].join(",");
    const input = chatVideoDraft(
      "Animate",
      "sora-2",
      "",
      Array.from({ length: count }, () => image),
    );
    expect(input.mode).toBe(mode);
    expect(input.materials).toHaveLength(count);
    expect(request).not.toHaveBeenCalled();
  },
);

test.each([0, 1, 3])(
  "chat video rejects first/last-frame mode with %i images before submitting",
  async (count) => {
    const { chatVideoDraft } = await import("../app/utils/chat-video");
    const image = ["data:image/png;base64", btoa("reference")].join(",");
    expect(() =>
      chatVideoDraft(
        "Animate",
        "sora-2",
        "",
        Array.from({ length: count }, () => image),
        undefined,
        { mode: "first-last-frame" },
      ),
    ).toThrow("首尾帧模式需要恰好两张图片");
    expect(request).not.toHaveBeenCalled();
  },
);

test.each([
  ["text-to-video", 1, "文生视频模式不使用参考素材"],
  ["image-to-video", 0, "图生视频模式需要一张图片"],
  ["image-to-video", 2, "图生视频模式需要一张图片"],
  ["reference-to-video", 0, "参考图模式需要 1 至 10 张图片"],
  ["reference-to-video", 11, "参考图模式需要 1 至 10 张图片"],
  ["unknown-mode", 0, "当前接口或模型不支持此生成模式"],
] as const)(
  "chat video validates explicit %s with %i images without rewriting it",
  async (mode, count, error) => {
    const { chatVideoDraft } = await import("../app/utils/chat-video");
    const image = "data:" + "image/png;base64," + btoa("reference");
    expect(() =>
      chatVideoDraft(
        "Animate",
        "sora-2",
        "",
        Array.from({ length: count }, () => image),
        undefined,
        { mode } as Partial<VideoDraft>,
      ),
    ).toThrow(error);
    expect(request).not.toHaveBeenCalled();
  },
);

test.each(["image-to-video", "reference-to-video"] as const)(
  "chat video preserves explicitly selected %s for one image",
  async (mode) => {
    const { chatVideoDraft } = await import("../app/utils/chat-video");
    const image = "data:" + "image/png;base64," + btoa("reference");
    const input = chatVideoDraft("Animate", "sora-2", "", [image], undefined, {
      mode,
    });
    expect(input.mode).toBe(mode);
    expect(input.materials).toHaveLength(1);
  },
);

test("chat video config copies parameters and excludes private identity, references and JSON overrides", async () => {
  const { chatVideoConfig, chatVideoDraft } = await import(
    "../app/utils/chat-video"
  );
  const image = `data:image/png;base64,${btoa("hello")}`;
  const source = draft({
    model: "private-model",
    prompt: "private prompt",
    materials: [
      { id: "private", name: "private.png", type: "image", url: image },
    ],
    sourceWorkId: "private-work",
    openaiReferenceSource: "file_id",
    openaiFileId: "private-file",
    openaiImageUrl: "https://private.test/reference.png",
    customParams: {
      openai: '{"model":"override","prompt":"override","images":[]}',
    },
    protocolOptions: { openai: { generateAudio: true } },
    duration: 15,
  });
  const config = chatVideoConfig(source);
  for (const key of [
    "model",
    "prompt",
    "materials",
    "sourceWorkId",
    "openaiReferenceSource",
    "openaiFileId",
    "openaiImageUrl",
    "customParams",
    "apiFormat",
  ])
    expect(config).not.toHaveProperty(key);
  source.protocolOptions!.openai!.generateAudio = false;
  expect(config.protocolOptions?.openai?.generateAudio).toBe(true);
  const input = chatVideoDraft(
    "Current prompt",
    "sora-2",
    "",
    [],
    "current-work",
    source,
  );
  expect(input).toMatchObject({
    model: "sora-2",
    prompt: "Current prompt",
    sourceWorkId: "current-work",
    duration: 12,
    materials: [],
    openaiReferenceSource: "upload",
    customParams: {},
  });
});

test("another composer's global video draft never supplies chat parameters or references", async () => {
  const { chatVideoDraft } = await import("../app/utils/chat-video");
  useVideoStore.setState({
    draft: draft({
      prompt: "Other composer",
      duration: 29,
      customParams: { openai: '{"prompt":"private override"}' },
      materials: [
        {
          id: "private",
          name: "private.png",
          type: "image",
          url: `data:image/png;base64,${btoa("private")}`,
        },
      ],
    }),
  });
  const configured = chatVideoDraft("Session A", "sora-2", "", [], undefined, {
    duration: 12,
  });
  const separate = chatVideoDraft("Session B", "sora-2", "", []);
  expect(configured.duration).toBe(12);
  expect(separate).toMatchObject({
    prompt: "Session B",
    duration: 8,
    size: "auto",
    resolution: "auto",
    aspectRatio: "auto",
    customParams: {},
    materials: [],
  });
  expect(useVideoStore.getState().draft.prompt).toBe("Other composer");
});

test("chat image attachments retain their bytes and selected first/last-frame mode", async () => {
  const { chatVideoDraft } = await import("../app/utils/chat-video");
  const first = `data:image/png;base64,${btoa("first")}`;
  const last = `data:image/png;base64,${btoa("last")}`;
  const file = {
    name: "last.png",
    type: "image/png",
    size: 4,
    content: last,
    isText: false,
  };
  const input = chatVideoDraft(
    "Two keyframes",
    "sora-2",
    "",
    [first],
    undefined,
    { mode: "first-last-frame" },
    [file],
  );
  file.content = "changed-after-send";
  expect(input.mode).toBe("first-last-frame");
  expect(input.materials.map((item) => item.url)).toEqual([first, last]);
  expect(Object.isFrozen(input.materials[1])).toBe(true);
});

test.each(["video/mp4", "audio/wav"])(
  "unsupported %s references fail in the chat before submitting",
  async (type) => {
    const { chatVideoDraft } = await import("../app/utils/chat-video");
    expect(() =>
      chatVideoDraft(
        "Use this reference",
        "sora-2",
        "",
        [],
        undefined,
        undefined,
        [
          {
            name: "reference",
            type,
            content: `data:${type};base64,AAAA`,
            size: 3,
            isText: false,
          },
        ],
      ),
    ).toThrow("当前接口仅支持图片参考素材");
    expect(request).not.toHaveBeenCalled();
  },
);

test("mixed image attachments use the same reference-mode limits before generation", async () => {
  const { chatVideoDraft } = await import("../app/utils/chat-video");
  const image = `data:image/png;base64,${btoa("reference")}`;
  const input = chatVideoDraft(
    "References",
    "grok-imagine-video-1.5",
    "",
    [image],
    undefined,
    { resolution: "1080p", duration: 30 },
    [
      {
        name: "second.png",
        type: "image/png",
        size: 9,
        content: image,
        isText: false,
      },
    ],
  );
  expect(input).toMatchObject({
    mode: "reference-to-video",
    resolution: "720p",
    duration: 15,
  });
});

test("unconfigured and invalid custom parameters fail before any billable request", async () => {
  await expect(
    generateVideoRequest(draft({ model: "future-video-unconfigured" })),
  ).rejects.toThrow("尚未配置");
  await expect(
    generateVideoRequest(
      draft({ customParams: { openai: '{"seconds":"30"}' } }),
    ),
  ).rejects.toThrow("时长");
  expect(request).not.toHaveBeenCalled();
  expect(useVideoStore.getState().results).toHaveLength(0);
});

test("document references name the unsupported attachment without linking to a removed workspace", async () => {
  const { chatVideoDraft } = await import("../app/utils/chat-video");
  expect(() =>
    chatVideoDraft("Animate", "sora-2", "", [], undefined, undefined, [
      {
        name: "notes.pdf",
        type: "application/pdf",
        content: "data:application/pdf;base64,AAAA",
        size: 3,
        isText: false,
      },
    ]),
  ).toThrow("视频生成暂不支持文件“notes.pdf”，请移除此附件后重试。");
  expect(request).not.toHaveBeenCalled();
});
