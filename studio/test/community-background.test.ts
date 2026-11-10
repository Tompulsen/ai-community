import { jest } from "@jest/globals";
let owner = "user-7", active = true, sequence = 0;
let modelGate: Promise<void> = Promise.resolve(), referenceGate: Promise<void> = Promise.resolve();
let localTasks: any[] = [], videos: any[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(fn => fn());
const generate = jest.fn<(...args: any[]) => Promise<void>>();
const videoGenerate = jest.fn<(...args: any[]) => Promise<void>>();
const store = {
  _hasHydrated: true, sessions: [] as any[], currentSessionIndex: 0,
  newSession(_mask: any, _project: any, select: boolean) {
    const session = { id: `session-${++sequence}`, topic: "", lastUpdate: Date.now(), messages: [], mask: { context: [], modelConfig: {} } };
    this.sessions.unshift(session); this.currentSessionIndex = select ? 0 : this.currentSessionIndex + 1;
    changed(); return session;
  },
  updateTargetSession(session: any, update: any) { update(this.sessions.find(item => item.id === session.id)); changed(); },
  saveGeneratedImage: jest.fn(), restoreSessionAssets: async () => true,
  selectSession: jest.fn<(index: number) => Promise<void>>().mockResolvedValue(undefined),
};
jest.unstable_mockModule("@/app/store/chat", () => ({ createMessage: (value: any) => ({ ...value, id: `message-${++sequence}` }), useChatStore: { getState: () => store, subscribe: (fn: any) => { listeners.add(fn); return () => listeners.delete(fn); } } }));
jest.unstable_mockModule("@/app/store/config", () => ({ useAppConfig: { getState: () => ({ models: ["image", "video"].map(kind => ({ name: `test-${kind}`, available: true, provider: { providerName: "OpenAI" } })) }) } }));
jest.unstable_mockModule("@/app/store/access", () => ({ useAccessStore: { getState: () => ({ fetch: () => modelGate }) } }));
jest.unstable_mockModule("@/app/store/video", () => ({ useVideoStore: { getState: () => ({ results: videos }), subscribe: () => () => {} } }));
jest.unstable_mockModule("@/app/client/api", () => ({ getClientApi: () => ({ llm: {} }) }));
jest.unstable_mockModule("@/app/client/controller", () => ({ ChatControllerPool: { addController: jest.fn(), remove: jest.fn() } }));
jest.unstable_mockModule("@/app/client/image-generation", () => ({ ImageGenerationService: class {
  callbacks: any; setCallbacks(value: any) { this.callbacks = value; } cancel() {}
  async generateImage(...args: any[]) { await generate(...args); this.callbacks.onComplete("https://media.test/result.png"); }
} }));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({ getLocalScope: () => owner, getLocalTokenId: () => 17, isLocalWorkspaceActive: () => active, localKey: (name: string) => `${owner}:${name}`, flushLocalWrites: async () => {} }));
jest.unstable_mockModule("@/app/utils/model-capabilities", () => ({ getModelCapabilities: (model: string) => ({ category: model.endsWith("video") ? "video" : "image", usesImageApi: true }) }));
jest.unstable_mockModule("@/app/utils/community-remix", () => ({ remixImages: async (_work: any, check: any) => { await referenceGate; check(); return []; } }));
jest.unstable_mockModule("@/app/utils/local-tasks", () => ({ pendingTasks: () => localTasks }));
jest.unstable_mockModule("@/app/utils/chat-video", () => ({ chatVideoDraft: (...args: any[]) => ({ prompt: args[0], sourceWorkId: args[4] }) }));
jest.unstable_mockModule("@/app/utils/video-generation", () => ({ generateVideoRequest: videoGenerate }));
jest.unstable_mockModule("@/app/utils/video-media", () => ({ fetchVideoMedia: jest.fn() }));
const { installCommunityBackground, backgroundSnapshot, validBackgroundWork } = await import("../app/utils/community-background");
const identity = { context: "context", attempt: "attempt", subject: "7", userId: "community-user" };
const work = { requestId: "12345678-1234-4234-8234-123456789abc", sourceWorkId: "original", kind: "image", model: "test-image", prompt: "original prompt", references: [] };
let dispose: () => void, posted: ReturnType<typeof jest.spyOn>;
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
function send(data: any, overrides = {}) { window.dispatchEvent(new MessageEvent("message", { source: window, origin: location.origin, data: { type: "community-background", ...identity, ...data, ...overrides } })); }
beforeEach(() => {
  owner = "user-7"; active = true; sequence = 0; modelGate = Promise.resolve(); referenceGate = Promise.resolve(); localTasks = []; videos = [];
  store.sessions = [{ id: "manual", topic: "manual draft", messages: [], mask: { context: [], modelConfig: { model: "manual-model" } } }]; store.currentSessionIndex = 0;
  localStorage.clear(); generate.mockReset().mockResolvedValue(undefined); videoGenerate.mockReset().mockResolvedValue(undefined); store.selectSession.mockClear();
  posted = jest.spyOn(window, "postMessage").mockImplementation(() => {});
  dispose = installCommunityBackground(location.origin, identity);
});
afterEach(() => { dispose(); posted.mockRestore(); });

test("background submission preserves the selected manual session and uses its own async task", async () => {
  send({ action: "submit", work }); await tick();
  expect(generate).toHaveBeenCalledTimes(1);
  expect(store.sessions[store.currentSessionIndex].id).toBe("manual");
  expect(store.sessions[store.currentSessionIndex].mask.modelConfig.model).toBe("manual-model");
  expect(generate.mock.calls[0][1].requestMode).toBe("async");
  expect(generate.mock.calls[0][0].accountTokenId).toBe(17);
  expect(backgroundSnapshot(store.sessions[0]).state).toBe("complete");
});
test("concurrent replay and replay after reconnect never repeat the paid POST", async () => {
  let release!: () => void; modelGate = new Promise(resolve => { release = resolve; });
  send({ action: "submit", work }); send({ action: "submit", work }); release(); await tick();
  expect(generate).toHaveBeenCalledTimes(1);
  dispose(); dispose = installCommunityBackground(location.origin, identity);
  send({ action: "submit", work }); await tick(); expect(generate).toHaveBeenCalledTimes(1);
});
test("a missing local session with an accepted request marker is not resubmitted", async () => {
  localStorage.setItem(`user-7:background-remix:${work.requestId}`, "lost-session");
  send({ action: "submit", work }); await tick(); expect(generate).not.toHaveBeenCalled();
  expect(posted).toHaveBeenCalledWith(expect.objectContaining({ status: "background-error" }), location.origin);
});
test("foreign identity and wrong origin cannot generate", async () => {
  send({ action: "submit", work }, { subject: "8" });
  window.dispatchEvent(new MessageEvent("message", { source: window, origin: "https://attacker.test", data: { type: "community-background", ...identity, action: "submit", work } }));
  await tick(); expect(generate).not.toHaveBeenCalled();
});
test("account changes during reference preparation prevent submission", async () => {
  let release!: () => void; referenceGate = new Promise(resolve => { release = resolve; });
  send({ action: "submit", work }); await tick(); owner = "user-8"; release(); await tick();
  expect(generate).not.toHaveBeenCalled();
});
test("interrupted image with a retained upstream task stays pending; video waits for result status", () => {
  const session = { id: "s", backgroundRemixRequestId: work.requestId, creationKind: "image", topic: "cat", mask: { modelConfig: { model: "test-image" } }, messages: [{ id: "m", role: "assistant", content: "", interrupted: true }] } as any;
  localTasks = [{ id: "m", messageId: "m" }]; expect(backgroundSnapshot(session).state).toBe("running");
  session.creationKind = "video"; session.messages[0].videoResultId = "v"; videos = [{ id: "v", status: "pending" }]; expect(backgroundSnapshot(session).state).toBe("running");
  videos[0].status = "success"; expect(backgroundSnapshot(session).state).toBe("complete");
});
test("video uses a dedicated result and protected protocol; invalid input is rejected", async () => {
  send({ action: "submit", work: { ...work, kind: "video", model: "test-video" } }); await tick();
  expect(videoGenerate).toHaveBeenCalledTimes(1); expect(generate).not.toHaveBeenCalled();
  expect(store.sessions[store.currentSessionIndex].id).toBe("manual");
  expect(validBackgroundWork({ ...work, references: [{ url: "javascript:alert(1)", name: "bad" }] })).toBe(false);
});

test("restored image metadata is complete before deferred media is loaded", () => {
  const session = { id: "s", backgroundRemixRequestId: work.requestId, backgroundRemixCompleted: true, creationKind: "image", topic: "cat", mask: { modelConfig: { model: "test-image" } }, messages: [{ id: "m", role: "assistant", content: { assetId: "deferred-image" } }] } as any;
  expect(backgroundSnapshot(session).state).toBe("complete");
  session.backgroundRemixCompleted = false;
  session.messages[0].gallerySave = "saved";
  expect(backgroundSnapshot(session).state).toBe("complete");
});

test("failed or paused recovery is actionable instead of displaying endless progress", () => {
  const session = { id: "s", backgroundRemixRequestId: work.requestId, creationKind: "image", topic: "cat", mask: { modelConfig: { model: "test-image" } }, messages: [{ id: "m", role: "assistant", content: "", streaming: true }] } as any;
  localTasks = [{ id: "m", messageId: "m", needsAttention: true }];
  expect(backgroundSnapshot(session).state).toBe("error");
  session.creationKind = "video"; session.messages[0].videoResultId = "v";
  videos = [{ id: "v", status: "pending", phase: "paused", error: "Resume query" }];
  expect(backgroundSnapshot(session)).toMatchObject({ state: "error", message: "Resume query" });
});
