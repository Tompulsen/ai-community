import { jest } from "@jest/globals";
import { act, renderHook } from "@testing-library/react";
import { create } from "zustand";

const records = new Map<string, string>();
const writes = new Set<Promise<unknown>>();
let active = true;
let owner = "user-7";
let tokenId: number | null = 100;
let readBarrier: Promise<void> | undefined;
let readError: Error | undefined;
const access = create(() => ({
  newApiEnabled: true,
  modelGroupType: undefined as "image" | "video" | undefined,
  modelGroupTokenId: null as number | null,
  modelGroupModels: [] as string[],
  openaiUrl: "https://custom.example.test/v1",
}));
jest.unstable_mockModule("@/app/store/access", () => ({
  useAccessStore: access,
}));
jest.unstable_mockModule("@/app/utils/indexedDB-storage", () => ({
  indexedDBStorage: {
    getItem: async (key: string) => {
      await readBarrier;
      if (readError) throw readError;
      return records.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => records.set(key, value),
    removeItem: async (key: string) => records.delete(key),
  },
}));
jest.unstable_mockModule("@/app/utils/chat-persistence", () => ({
  readChatSnapshot: jest.fn(),
  writeChatSnapshot: jest.fn(),
  removeChatSnapshot: jest.fn(),
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  initializeLocalWorkspace: async () => owner,
  getLocalTokenId: () => tokenId,
  getLocalScope: () => owner,
  localKey: (key: string, scope = owner) => `octopus:${scope}:${key}`,
  isLocalWorkspaceActive: () => active,
  persistLocalWrite: (
    action: () => Promise<void>,
    enqueue?: (write: () => Promise<void>) => Promise<void>,
  ) => {
    const promise = enqueue ? enqueue(action) : action();
    writes.add(promise);
    void promise.finally(() => writes.delete(promise)).catch(() => {});
    return promise;
  },
}));
const { useModelPreferenceStore: preferences, waitForModelPreferences } =
  await import("../app/store/model-preferences");
const {
  getModelCapabilities,
  getModelPreferenceKey,
  useModelCapabilities,
  useModelCapabilitiesResolver,
} = await import("../app/utils/model-capabilities");
const { modelApiFormatsSchema, modelTypeOverridesSchema } = await import(
  "../app/utils/model-preferences"
);
const { CUSTOM_MODEL_PROVIDER } = await import("../app/utils/custom-provider");
const { StoreKey } = await import("../app/constant");
const storageKey = `octopus:user-7:${StoreKey.ModelPreferences}`;

beforeEach(async () => {
  await Promise.all([...writes]);
  records.clear();
  active = true;
  owner = "user-7";
  tokenId = 100;
  readBarrier = undefined;
  readError = undefined;
  access.setState({
    newApiEnabled: true,
    modelGroupType: undefined,
    modelGroupTokenId: null,
    modelGroupModels: [],
    openaiUrl: "https://custom.example.test/v1",
  });
  preferences.setState({ overrides: {}, apiFormats: {}, _hasHydrated: true });
  await Promise.all([...writes]);
});

test("group defaults classify unknown image and video aliases without creating manual preferences", () => {
  access.setState({ modelGroupType: "video", modelGroupTokenId: 100, modelGroupModels: ["sd2.0-mini-720p", "wan3.0", "future-alias", "gemini-3-pro-image"] });
  for (const name of ["sd2.0-mini-720p", "wan3.0", "future-alias"])
    expect(getModelCapabilities(name, "OpenAI")).toMatchObject({ category: "video", override: "auto", usesImageApi: false });
  access.setState({ modelGroupType: "image" });
  expect(getModelCapabilities("future-alias", "OpenAI")).toMatchObject({ category: "image", usesImageApi: true });
  expect(getModelCapabilities("gemini-3-pro-image", "OpenAI")).toMatchObject({ category: "image", usesImageApi: false });
  expect(preferences.getState().overrides).toEqual({});
  expect(getModelCapabilities("grok-imagine-video-1.5", "OpenAI").category).toBe("video");
  expect(getModelCapabilities("future-alias", CUSTOM_MODEL_PROVIDER).category).toBeNull();
  tokenId = 101;
  expect(getModelCapabilities("future-alias", "OpenAI").category).toBeNull();
});

test("both mounted capability hooks react to confirmed group changes", () => {
  const single = renderHook(() => useModelCapabilities("future-alias", "OpenAI"));
  const resolver = renderHook(() => useModelCapabilitiesResolver());
  act(() => access.setState({ modelGroupType: "video", modelGroupTokenId: 100, modelGroupModels: ["future-alias"] }));
  expect(single.result.current.category).toBe("video");
  expect(resolver.result.current("future-alias", "OpenAI").category).toBe("video");
  act(() => access.setState({ modelGroupType: "image" }));
  expect(single.result.current.category).toBe("image");
  expect(resolver.result.current("future-alias", "OpenAI").category).toBe("image");
});

test("model corrections persist in the current account workspace and survive rehydration", async () => {
  const key = getModelPreferenceKey("unusual-model", "OpenAI");
  preferences.getState().setModelType(key, "image");
  await Promise.all([...writes]);
  const persisted = records.get(storageKey)!;
  expect(JSON.parse(persisted).state.overrides[key]).toBe("image");
  expect(records.has(StoreKey.ModelPreferences)).toBe(false);
  preferences.setState({ overrides: {} });
  await Promise.all([...writes]);
  records.set(storageKey, persisted);
  await preferences.persist.rehydrate();
  expect(getModelCapabilities("unusual-model", "OpenAI")).toMatchObject({
    category: "image",
    usesImageApi: true,
    override: "image",
  });
});

test("same-name account, group, and custom models have independent settings", () => {
  const model = "shared-model";
  const accountKey = getModelPreferenceKey(model, "OpenAI");
  preferences.getState().setModelType(accountKey, "image");
  const customKey = getModelPreferenceKey(model, CUSTOM_MODEL_PROVIDER);
  preferences.getState().setModelType(customKey, "video");
  expect(customKey).not.toBe(accountKey);
  expect(getModelCapabilities(model, CUSTOM_MODEL_PROVIDER).category).toBe(
    "video",
  );
  expect(getModelCapabilities(model, "OpenAI").category).toBe("image");
  tokenId = 101;
  expect(getModelPreferenceKey(model, "OpenAI")).not.toBe(accountKey);
  expect(getModelCapabilities(model, "OpenAI").override).toBe("auto");
  tokenId = 100;
  expect(getModelCapabilities(model, "OpenAI").override).toBe("image");
});

test("protocol preferences persist beside type corrections and reset independently", async () => {
  const key = getModelPreferenceKey("unusual-model", "OpenAI");
  preferences.getState().setModelType(key, "chat");
  preferences.getState().setModelApiFormat(key, "gemini");
  await Promise.all([...writes]);
  const persisted = records.get(storageKey)!;
  expect(JSON.parse(persisted).state).toMatchObject({
    overrides: { [key]: "chat" },
    apiFormats: { [key]: "gemini" },
  });
  preferences.setState({ overrides: {}, apiFormats: {} });
  await Promise.all([...writes]);
  records.set(storageKey, persisted);
  await preferences.persist.rehydrate();
  expect(preferences.getState().apiFormats[key]).toBe("gemini");
  preferences.getState().setModelApiFormat(key, "auto");
  expect(preferences.getState().apiFormats[key]).toBeUndefined();
  expect(preferences.getState().overrides[key]).toBe("chat");
});

test("protocol preferences keep account groups and custom endpoints independent", async () => {
  const key = getModelPreferenceKey("same-model", "OpenAI");
  const customKey = getModelPreferenceKey("same-model", CUSTOM_MODEL_PROVIDER);
  preferences.getState().setModelApiFormat(key, "gemini");
  preferences.getState().setModelApiFormat(customKey, "responses");
  expect(getModelCapabilities("same-model", "OpenAI").apiFormat).toBe("gemini");
  expect(
    getModelCapabilities("same-model", CUSTOM_MODEL_PROVIDER).apiFormat,
  ).toBe("responses");
  tokenId = 101;
  expect(
    preferences.getState().apiFormats[
      getModelPreferenceKey("same-model", "OpenAI")
    ],
  ).toBeUndefined();
  expect(
    getModelCapabilities("same-model", "OpenAI").apiFormat,
  ).toBeUndefined();
  expect(preferences.getState().apiFormats[customKey]).toBe("responses");
  await Promise.all([...writes]);
  owner = "user-8";
  await preferences.persist.rehydrate();
  expect(preferences.getState().apiFormats).toEqual({});
  expect(JSON.parse(records.get(storageKey)!).state.apiFormats[key]).toBe(
    "gemini",
  );
});

test("mounted protocol consumers and resolvers update on edits, reset and source changes", () => {
  const model = "shared-model";
  const accountKey = getModelPreferenceKey(model, "OpenAI");
  const customKey = getModelPreferenceKey(model, CUSTOM_MODEL_PROVIDER);
  const { result } = renderHook(() => {
    const current = useModelCapabilities(model, "OpenAI");
    const resolve = useModelCapabilitiesResolver();
    return {
      current: current.apiFormat,
      account: resolve(model, "OpenAI").apiFormat,
      custom: resolve(model, CUSTOM_MODEL_PROVIDER).apiFormat,
    };
  });
  expect(result.current).toEqual({
    current: undefined,
    account: undefined,
    custom: undefined,
  });
  act(() => {
    preferences.getState().setModelApiFormat(accountKey, "gemini");
    preferences.getState().setModelApiFormat(customKey, "responses");
  });
  expect(result.current).toEqual({
    current: "gemini",
    account: "gemini",
    custom: "responses",
  });
  act(() => {
    tokenId = 101;
    access.setState({ ...access.getState() });
  });
  expect(result.current).toEqual({
    current: undefined,
    account: undefined,
    custom: "responses",
  });
  act(() => {
    tokenId = 100;
    access.setState({ ...access.getState() });
    preferences.getState().setModelApiFormat(accountKey, "auto");
  });
  expect(result.current).toEqual({
    current: undefined,
    account: undefined,
    custom: "responses",
  });
});

test("captured capabilities keep the accepted protocol when preferences change later", () => {
  const model = "gemini-alias";
  const key = getModelPreferenceKey(model, "OpenAI");
  preferences.getState().setModelApiFormat(key, "gemini");
  const accepted = getModelCapabilities(model, "OpenAI");
  preferences.getState().setModelApiFormat(key, "responses");
  expect(accepted.apiFormat).toBe("gemini");
  expect(getModelCapabilities(model, "OpenAI").apiFormat).toBe("responses");
});

test("legacy storage and invalid protocols retain valid type corrections", async () => {
  const key = getModelPreferenceKey("existing-model", "OpenAI");
  records.set(
    storageKey,
    JSON.stringify({ version: 1, state: { overrides: { [key]: "image" } } }),
  );
  await preferences.persist.rehydrate();
  expect(preferences.getState().apiFormats).toEqual({});
  expect(preferences.getState().overrides[key]).toBe("image");
  await Promise.all([...writes]);
  records.set(
    storageKey,
    JSON.stringify({
      version: 1,
      state: {
        overrides: { [key]: "image" },
        apiFormats: { [key]: "unsupported-format" },
      },
    }),
  );
  await preferences.persist.rehydrate();
  expect(preferences.getState().apiFormats).toEqual({});
  expect(preferences.getState().overrides[key]).toBe("image");
});

test("protocol edits reject invalid identities, unsupported formats and unavailable storage", () => {
  const key = getModelPreferenceKey("existing-model", "OpenAI");
  expect(() =>
    preferences.getState().setModelApiFormat("__proto__", "gemini"),
  ).toThrow("来源无效");
  expect(() =>
    preferences.getState().setModelApiFormat(key, "unsupported" as "gemini"),
  ).toThrow("接口格式");
  preferences.getState().setModelApiFormat(key, "gemini");
  active = false;
  expect(() =>
    preferences.getState().setModelApiFormat(key, "responses"),
  ).toThrow("尚未就绪");
  active = true;
  preferences.setState({ _hasHydrated: false });
  expect(() => preferences.getState().setModelApiFormat(key, "auto")).toThrow(
    "尚未就绪",
  );
  expect(preferences.getState().apiFormats[key]).toBe("gemini");
});

test("normalizes custom endpoint slashes while preserving different endpoint identities", () => {
  const key = getModelPreferenceKey("same-model", CUSTOM_MODEL_PROVIDER);
  access.setState({ openaiUrl: "https://custom.example.test/v1/" });
  expect(getModelPreferenceKey("same-model", CUSTOM_MODEL_PROVIDER)).toBe(key);
  access.setState({ openaiUrl: "https://other.example.test/v1" });
  expect(getModelPreferenceKey("same-model", CUSTOM_MODEL_PROVIDER)).not.toBe(
    key,
  );
});

test("reset to automatic restores Gemini chat routing and inherited vision support", () => {
  const model = "gemini-3-pro-image";
  const key = getModelPreferenceKey(model, "OpenAI");
  const automatic = getModelCapabilities(model, "OpenAI");
  preferences.getState().setModelType(key, "image");
  expect(getModelCapabilities(model, "OpenAI").usesImageApi).toBe(true);
  preferences.getState().setModelType(key, "chat");
  expect(getModelCapabilities(model, "OpenAI")).toMatchObject({
    category: "chat",
    usesImageApi: false,
    vision: automatic.vision,
  });
  preferences.getState().setModelType(key, "auto");
  expect(getModelCapabilities(model, "OpenAI")).toEqual(automatic);
  expect(preferences.getState().overrides[key]).toBeUndefined();
});

test("mounted capability consumers update immediately after a correction or group change", () => {
  const model = "unusual-model";
  const { result } = renderHook(() => useModelCapabilities(model, "OpenAI"));
  expect(result.current.override).toBe("auto");
  act(() =>
    preferences
      .getState()
      .setModelType(getModelPreferenceKey(model, "OpenAI"), "image"),
  );
  expect(result.current.category).toBe("image");
  act(() => {
    tokenId = 101;
    access.setState({ ...access.getState() });
  });
  expect(result.current.override).toBe("auto");
});

test("inactive workspace and unhydrated storage reject edits without losing prior settings", () => {
  const key = getModelPreferenceKey("existing", "OpenAI");
  preferences.getState().setModelType(key, "video");
  active = false;
  expect(() => preferences.getState().setModelType(key, "image")).toThrow(
    "尚未就绪",
  );
  active = true;
  preferences.setState({ _hasHydrated: false });
  expect(() => preferences.getState().setModelType(key, "auto")).toThrow(
    "尚未就绪",
  );
  expect(preferences.getState().overrides[key]).toBe("video");
});

test("account workspace rehydration does not expose another account's corrections", async () => {
  const key = getModelPreferenceKey("unusual-model", "OpenAI");
  preferences.getState().setModelType(key, "image");
  await Promise.all([...writes]);
  owner = "user-8";
  await preferences.persist.rehydrate();
  expect(preferences.getState().overrides).toEqual({});
  expect(JSON.parse(records.get(storageKey)!).state.overrides[key]).toBe(
    "image",
  );
});

test("request readiness waits for slow preferences instead of silently using automatic routing", async () => {
  const model = "gemini-alias";
  const key = getModelPreferenceKey(model, "OpenAI");
  records.set(
    storageKey,
    JSON.stringify({
      version: 1,
      state: {
        overrides: {},
        apiFormats: { [key]: "gemini" },
      },
    }),
  );
  let release!: () => void;
  readBarrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const rehydrating = preferences.persist.rehydrate();
  let ready = false;
  const waiting = waitForModelPreferences().then(() => {
    ready = true;
  });
  await Promise.resolve();
  expect(ready).toBe(false);
  expect(getModelCapabilities(model, "OpenAI").apiFormat).toBeUndefined();
  release();
  await rehydrating;
  await waiting;
  expect(ready).toBe(true);
  expect(getModelCapabilities(model, "OpenAI").apiFormat).toBe("gemini");
});

test("storage failure keeps model corrections unavailable and rejects request readiness", async () => {
  preferences.setState({ _hasHydrated: false });
  await Promise.all([...writes]);
  readError = new Error("storage unavailable");
  await preferences.persist.rehydrate();
  expect(preferences.getState()._hasHydrated).toBe(false);
  await expect(waitForModelPreferences()).rejects.toThrow("设置读取失败");
  readError = undefined;
  await preferences.persist.rehydrate();
  await expect(waitForModelPreferences()).resolves.toBeUndefined();
});

test.each([
  '["account",null,"model"]',
  '["account",-1,"model"]',
  '["account",100,""]',
  '["custom","https://user:password@example.test/v1","model"]',
  '["custom","https://example.test/v1?key=secret","model"]',
  '["custom","file:///models","model"]',
  "__proto__",
])("rejects invalid or credential-bearing preference identity %s", (key) => {
  expect(modelTypeOverridesSchema.safeParse({ [key]: "image" }).success).toBe(
    false,
  );
  expect(() => preferences.getState().setModelType(key, "image")).toThrow();
});

test("rejects excessive imported model settings and invalid types", () => {
  const keys = Object.fromEntries(
    Array.from({ length: 2001 }, (_, index) => [
      JSON.stringify(["account", 100, `model-${index}`]),
      "image",
    ]),
  );
  expect(modelTypeOverridesSchema.safeParse(keys).success).toBe(false);
  expect(
    modelTypeOverridesSchema.safeParse({
      [getModelPreferenceKey("model", "OpenAI")]: "auto",
    }).success,
  ).toBe(false);
});

test("protocol schema rejects unsupported values, credential-bearing keys and excessive entries", () => {
  const key = getModelPreferenceKey("same-model", "OpenAI");
  expect(modelApiFormatsSchema.safeParse({ [key]: "gemini" }).success).toBe(
    true,
  );
  expect(modelApiFormatsSchema.safeParse({ [key]: "auto" }).success).toBe(
    false,
  );
  expect(
    modelApiFormatsSchema.safeParse({
      '["custom","https://example.test/v1?key=private","model"]': "gemini",
    }).success,
  ).toBe(false);
  const formats = Object.fromEntries(
    Array.from({ length: 2001 }, (_, index) => [
      JSON.stringify(["account", 100, `model-${index}`]),
      "gemini",
    ]),
  );
  expect(modelApiFormatsSchema.safeParse(formats).success).toBe(false);
});
