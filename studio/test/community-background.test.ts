import { jest } from "@jest/globals";
let owner = "user-7", active = true, sequence = 0;
let modelGate: Promise<void> = Promise.resolve(), referenceGate: Promise<void> = Promise.resolve();
let localTasks: any[] = [], videos: any[] = [];
let tokenId = 9, group = "auto", groupMissing = false, groupFailure = false;
const access = { fetch: () => modelGate, newApiEnabled: true, switchingToken: false, modelListStatus: "ready", modelRefreshError: false, modelGroupType: undefined as string | undefined, modelGroupTokenId: null as number | null };
const readGroups = () => ({ selectedGroup: group, groups: groupMissing ? [] : ["auto", "生图", "视频"].map(id => ({ id, name: id })) });
const modelGroups = jest.fn<() => Promise<ReturnType<typeof readGroups>>>(async () => readGroups());
const selectGroup = jest.fn<(selected: string) => Promise<any>>(async selected => {
  if (groupFailure) throw new Error("分组不可用");
  group = selected; tokenId = selected === "生图" ? 17 : 18;
  return { group, selectedTokenId: tokenId };
});
const refresh = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
jest.unstable_mockModule("@/app/client/new-api", () => ({
  getExpectedNewApiUserId: () => Number(owner.slice(5)),
  newApiClient: {
    modelGroups,
    selectModelGroup: selectGroup,
  },
}));
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
jest.unstable_mockModule("@/app/store/config", () => ({ useAppConfig: { getState: () => ({ models: (group === "生图" ? ["test-image", "gemini-3-pro-image"] : group === "视频" ? ["test-video"] : ["chat"]).map(name => ({ name, available: true, provider: { providerName: "OpenAI" } })) }) } }));
jest.unstable_mockModule("@/app/store/access", () => ({ useAccessStore: { getState: () => access, setState: (patch: any) => Object.assign(access, patch) }, refreshSelectedNewApiModels: refresh, refreshNewApiModels: refresh, refetchModels: refresh }));
jest.unstable_mockModule("@/app/store/video", () => ({ useVideoStore: { getState: () => ({ results: videos }), subscribe: () => () => {} } }));
jest.unstable_mockModule("@/app/client/api", () => ({ getClientApi: () => ({ llm: {} }) }));
jest.unstable_mockModule("@/app/client/controller", () => ({ ChatControllerPool: { addController: jest.fn(), remove: jest.fn() } }));
jest.unstable_mockModule("@/app/client/image-generation", () => ({ ImageGenerationService: class {
  callbacks: any; setCallbacks(value: any) { this.callbacks = value; } cancel() {}
  async generateImage(...args: any[]) { await generate(...args); if (args[0].modelCapabilities.usesImageApi) this.callbacks.onComplete("https://media.test/result.png"); else args[0].onFinish("![Generated Image](https://media.test/result.png)"); }
} }));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({ getLocalScope: () => owner, getLocalTokenId: () => tokenId, isLocalWorkspaceActive: () => active, localKey: (name: string) => `${owner}:${name}`, flushLocalWrites: async () => {} }));
jest.unstable_mockModule("@/app/utils/model-capabilities", () => ({ getModelCapabilities: (model: string) => ({ category: model.endsWith("video") ? "video" : "image", usesImageApi: !model.startsWith("gemini") }) }));
jest.unstable_mockModule("@/app/utils/community-remix", () => ({ remixImages: async (work: any, check: any) => { await referenceGate; check(); return work.references.map((item: any) => item.url); } }));
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
  tokenId = 9; group = "auto"; groupMissing = groupFailure = false; selectGroup.mockClear(); refresh.mockReset().mockResolvedValue(undefined); modelGroups.mockReset().mockImplementation(async () => readGroups());
  Object.assign(access, { switchingToken: false, modelListStatus: "ready", modelRefreshError: false, modelGroupType: undefined, modelGroupTokenId: null });
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
  expect(selectGroup).toHaveBeenCalledWith("生图", 7);
  expect(refresh).toHaveBeenCalledWith({ userId: 7, tokenId: 17, group: "生图" });
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
  expect(backgroundSnapshot(session)).toMatchObject({ state: "error", message: expect.stringContaining("Resume query") });
});

test("concurrent image and video remixes retain the key confirmed for their own group", async () => {
  let release!: () => void; referenceGate = new Promise(resolve => { release = resolve; });
  send({ action: "submit", work });
  send({ action: "submit", work: { ...work, requestId: "22345678-1234-4234-8234-123456789abc", kind: "video", model: "test-video" } });
  await tick(); release(); await tick();
  expect(selectGroup.mock.calls.map(call => call[0])).toEqual(["生图", "视频"]);
  expect(generate.mock.calls[0][0].accountTokenId).toBe(17);
  expect(videoGenerate.mock.calls[0][2]).toBe(18);
});

test.each(["groups", "models"])("a token change during %s refresh cannot overwrite the new group's type or submit", async phase => {
  group = "生图"; tokenId = 17;
  Object.assign(access, { modelGroupType: "image", modelGroupTokenId: 17 });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  if (phase === "groups") modelGroups.mockImplementationOnce(async () => { const source = readGroups(); await gate; return source; });
  else refresh.mockImplementationOnce(() => gate);
  send({ action: "submit", work }); await tick();
  group = "视频"; tokenId = 18;
  Object.assign(access, { modelGroupType: "video", modelGroupTokenId: 18 });
  release(); await tick();
  expect(generate).not.toHaveBeenCalled();
  expect(access).toMatchObject({ modelGroupType: "video", modelGroupTokenId: 18 });
  expect(posted).toHaveBeenCalledWith(expect.objectContaining({ status: "background-error", message: expect.stringContaining("模型分组已变化") }), location.origin);
});

test.each(["model", "group", "upstream"])("%s unavailable shows the model recovery message without a fallback generation", async reason => {
  groupMissing = reason === "group";
  groupFailure = reason === "upstream";
  send({ action: "submit", work: { ...work, model: reason === "model" ? "missing-model" : work.model } });
  await tick();
  expect(generate).not.toHaveBeenCalled();
  expect(posted).toHaveBeenCalledWith(expect.objectContaining({ status: "background-error", message: expect.stringContaining("无法调用该模型生成，请前往工作台切换模型") }), location.origin);
  expect(store.sessions).toHaveLength(1);
});

test("Gemini native image requests receive references and complete through chat callbacks", async () => {
  send({ action: "submit", work: { ...work, model: "gemini-3-pro-image", references: [{ name: "ref.png", url: "https://media.test/ref.png" }] } });
  await tick();
  expect(generate.mock.calls[0][0]).toMatchObject({ accountTokenId: 17, modelCapabilities: { usesImageApi: false }, messages: [{ role: "user", content: [{ type: "text", text: work.prompt }, { type: "image_url", image_url: { url: "https://media.test/ref.png" } }] }] });
  expect(backgroundSnapshot(store.sessions[0]).state).toBe("complete");
});

test("upstream generation rejection remains actionable and is never retried automatically", async () => {
  generate.mockRejectedValueOnce(new Error("no available channel"));
  send({ action: "submit", work }); await tick();
  expect(backgroundSnapshot(store.sessions[0])).toMatchObject({ state: "error", message: expect.stringContaining("无法调用该模型生成，请前往工作台切换模型") });
  send({ action: "submit", work }); await tick();
  expect(generate).toHaveBeenCalledTimes(1);
});
