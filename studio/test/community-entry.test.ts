import { jest } from "@jest/globals";
import type { ChatSession } from "../app/store/chat";
import type { LLMModel } from "../app/client/api";

let sessions: ChatSession[];
let current = 0;
let count = 0;
let owner = "user-1";
let active = true;
let restore: (() => Promise<void>) | undefined;
const make = (id: string, fields: Partial<ChatSession> = {}) =>
  ({
    id,
    topic: "旧聊天",
    messages: [],
    mask: {
      context: [],
      modelConfig: {
        model: "previous-model",
        providerName: "Old",
        template: "previous style",
      },
    },
    ...fields,
  }) as ChatSession;
const store = {
  get sessions() {
    return sessions;
  },
  newSession() {
    count++;
    sessions.unshift(make(`chat-${count}`));
    current = 0;
  },
  currentSession: () => sessions[current],
  async selectSession(index: number) {
    if (restore) await restore();
    else current = index;
  },
  updateTargetSession: (
    target: ChatSession,
    update: (value: ChatSession) => void,
  ) => update(sessions.find((item) => item.id === target.id)!),
};
jest.unstable_mockModule("@/app/store/chat", () => ({
  useChatStore: { getState: () => store },
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => owner,
  isLocalWorkspaceActive: () => active,
  localKey: (name: string) => `${owner}:${name}`,
}));
jest.unstable_mockModule("@/app/utils/model-capabilities", () => ({
  getModelCapabilities: (model: string) => ({
    category: model.startsWith("gpt-image")
      ? "image"
      : model.startsWith("veo-")
      ? "video"
      : model.startsWith("gpt-")
      ? "chat"
      : null,
  }),
}));
const {
  startCommunityChat,
  findCommunityWorkspace,
  resolveCommunityRemixModel,
} = await import("../app/utils/community-entry");
const models = [
  {
    name: "gpt-image-2.6",
    available: true,
    provider: { providerName: "OpenAI" },
  },
] as LLMModel[];
const imageEntry = {
  id: "entry",
  kind: "image" as const,
  model: "gpt-image-2.6",
};
beforeEach(() => {
  sessions = [
    make("existing", { messages: [{ content: "Keep original" }] as any }),
  ];
  current = 0;
  count = 0;
  owner = "user-1";
  active = true;
  restore = undefined;
});

test("remixing a manual upload keeps a usable model from its matching workspace", async () => {
  const target = await startCommunityChat(imageEntry, models);
  const alternatives = [
    ...models,
    { ...models[0], name: "gpt-image-other", isDefault: true },
  ];
  expect(
    resolveCommunityRemixModel({ kind: "image", model: "" }, alternatives)
      .model,
  ).toBe(target.mask.modelConfig.model);
  expect(
    resolveCommunityRemixModel(
      { kind: "image", model: "explicit-unavailable" },
      alternatives,
    ).model,
  ).toBe("explicit-unavailable");
});

test("missing remix models use only available models of the requested category", () => {
  const available = [
    ...models,
    { ...models[0], name: "gpt-image-default", isDefault: true },
    { ...models[0], name: "gpt-text" },
    { ...models[0], name: "veo-video" },
    { ...models[0], name: "gpt-image-disabled", available: false },
  ];
  expect(
    resolveCommunityRemixModel({ kind: "image", model: "" }, available).model,
  ).toBe("gpt-image-default");
  expect(
    resolveCommunityRemixModel({ kind: "text", model: "" }, available).model,
  ).toBe("gpt-text");
  expect(
    resolveCommunityRemixModel({ kind: "video", model: "" }, available).model,
  ).toBe("veo-video");
  expect(
    resolveCommunityRemixModel({ kind: "video", model: "" }, models).model,
  ).toBe("");
  expect(
    resolveCommunityRemixModel({ kind: "image", model: "" }, [
      { ...models[0], available: false },
    ]).model,
  ).toBe("");
});

test("repeated and simultaneous entries reuse one named image workspace", async () => {
  await Promise.all([
    startCommunityChat(imageEntry, models),
    startCommunityChat(imageEntry, models),
  ]);
  const id = store.currentSession().id;
  await startCommunityChat({ ...imageEntry, id: "another-open" }, models);
  expect(count).toBe(1);
  expect(store.currentSession().id).toBe(id);
  expect(store.currentSession().topic).toBe("图片");
  expect(store.currentSession().mask.modelConfig.model).toBe(imageEntry.model);
  expect(store.currentSession().mask.modelConfig.template).not.toBe(
    "previous style",
  );
});
test("three categories keep distinct sessions, histories and chosen models", async () => {
  const image = await startCommunityChat(imageEntry, models);
  image.messages.push({ content: "image history" } as any);
  image.mask.modelConfig.model = "chosen-image";
  const video = await startCommunityChat(
    { id: "video", kind: "video", model: "" },
    models,
  );
  expect(video.topic).toBe("视频");
  expect(video.mask.modelConfig.model).toBe("");
  const text = await startCommunityChat(
    { id: "text", kind: "text", model: "gpt-6.1-sol" },
    models,
  );
  expect(text.topic).toBe("文本");
  expect(text.mask.modelConfig.model).toBe("gpt-6.1-sol");
  const reopened = await startCommunityChat(
    { ...imageEntry, id: "reopen" },
    models,
  );
  expect(count).toBe(3);
  expect(reopened.id).toBe(image.id);
  expect(reopened.messages).toEqual(image.messages);
  expect(reopened.mask.modelConfig.model).toBe("chosen-image");
});
test("adopts existing meaningful creation history before an empty legacy chat", async () => {
  sessions.push(
    make("empty", { creationKind: "image" }),
    make("history", {
      creationKind: "image",
      messages: [{ content: "keep" }] as any,
    }),
  );
  const selected = await startCommunityChat(imageEntry, models);
  expect(selected.id).toBe("history");
  expect(count).toBe(0);
  expect(sessions).toHaveLength(3);
  expect(selected.messages[0].content).toBe("keep");
  expect(selected.mask.modelConfig.model).toBe("previous-model");
});
test("persisted workspace marker wins after data reload even over newer ordinary chats", async () => {
  const selected = await startCommunityChat(imageEntry, models);
  sessions = JSON.parse(JSON.stringify(sessions));
  sessions.unshift(make("newer", { creationKind: "image" }));
  current = 0;
  expect((await startCommunityChat(imageEntry, models)).id).toBe(selected.id);
  expect(count).toBe(1);
});
test("account switch does not reuse another account's in-memory entry", async () => {
  await startCommunityChat(imageEntry, models);
  owner = "user-2";
  sessions = [make("other-account")];
  current = 0;
  const selected = await startCommunityChat(imageEntry, models);
  expect(selected.id).toBe("chat-2");
  expect(selected.id).not.toBe("chat-1");
});
test("waiting for deferred assets rejects an account switch", async () => {
  sessions.push(
    make("saved", { communityWorkspaceKind: "image", creationKind: "image" }),
  );
  let finish!: () => void;
  restore = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const task = startCommunityChat(imageEntry, models);
  owner = "user-2";
  finish();
  await expect(task).rejects.toThrow("账号已变化");
});
test("a superseded asset selection is not treated as successful", async () => {
  sessions.push(
    make("saved", { communityWorkspaceKind: "image", creationKind: "image" }),
  );
  restore = async () => {};
  await expect(startCommunityChat(imageEntry, models)).rejects.toThrow(
    "会话已切换",
  );
});
test("removed workspace is recreated once without changing unrelated history", async () => {
  const first = await startCommunityChat(imageEntry, models);
  sessions = sessions.filter((item) => item.id !== first.id);
  current = 0;
  const second = await startCommunityChat(imageEntry, models);
  expect(second.id).not.toBe(first.id);
  expect(count).toBe(2);
  expect(sessions.some((item) => item.id === "existing")).toBe(true);
});
test("inactive storage cannot create a workspace", async () => {
  active = false;
  await expect(startCommunityChat(imageEntry, models)).rejects.toThrow(
    "账号已变化",
  );
  expect(count).toBe(0);
});
test("unknown explicit defaults stay selected instead of silently falling back", async () => {
  const selected = await startCommunityChat(
    { id: "missing", kind: "text", model: "original-unavailable" },
    models,
  );
  expect(selected.mask.modelConfig.model).toBe("original-unavailable");
  expect(findCommunityWorkspace("image")).toBeUndefined();
});

test.each([
  ["image", "gpt-image-2.6"],
  ["video", "veo-3"],
  ["text", "gpt-6.1-sol"],
] as const)(
  "reuses an ordinary %s conversation and preserves its name, config and history",
  async (kind, model) => {
    const ordinary = make("ordinary", {
      topic: "用户命名",
      messages: [{ content: "keep history" }] as any,
    });
    ordinary.mask.modelConfig.model = model;
    sessions.push(ordinary);
    current = 1;
    const selected = await startCommunityChat(
      { id: "remix", kind, model },
      models,
    );
    expect(selected.id).toBe("ordinary");
    expect(count).toBe(0);
    expect(selected.topic).toBe("用户命名");
    expect(selected.messages[0].content).toBe("keep history");
    expect(selected.mask.modelConfig.template).toBe("previous style");
  },
);

test("prefers the current ordinary conversation and excludes custom providers", () => {
  const newer = make("newer"),
    currentImage = make("current"),
    custom = make("custom");
  for (const item of [newer, currentImage, custom])
    item.mask.modelConfig.model = "gpt-image-2.6";
  custom.mask.modelConfig.providerName = "octopus-custom";
  sessions = [custom, newer, currentImage];
  current = 2;
  expect(findCommunityWorkspace("image")?.id).toBe("current");
  current = 0;
  expect(findCommunityWorkspace("image")?.id).toBe("newer");
});

test("reopening a marked conversation preserves a renamed title", async () => {
  const selected = await startCommunityChat(imageEntry, models);
  selected.topic = "海报草稿";
  expect((await startCommunityChat(imageEntry, models)).topic).toBe("海报草稿");
});
