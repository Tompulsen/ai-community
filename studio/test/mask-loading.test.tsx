import React from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { jest } from "@jest/globals";
import { create } from "zustand";

const config = {
  hideBuiltinMasks: false,
  modelConfig: { model: "default-model", temperature: 0.8 },
};

jest.unstable_mockModule("react", () => React);
jest.unstable_mockModule("@/app/utils/store", () => ({
  createPersistStore: (state: any, methods: any) =>
    create((set, get) => ({
      ...state,
      ...methods(set, get),
      markUpdate: () => {},
    })),
}));
jest.unstable_mockModule("@/app/store/config", () => ({
  useAppConfig: { getState: () => config },
}));
jest.unstable_mockModule("@/app/store/chat", () => ({
  DEFAULT_TOPIC: "New chat",
}));
jest.unstable_mockModule("@/app/locales", () => ({
  getLang: () => "cn",
}));
jest.unstable_mockModule("@/app/utils/chat-params", () => ({
  migrateChatParams: () => {},
}));

function builtin(name: string, lang = "cn") {
  return {
    name,
    lang,
    avatar: "1f916",
    context: [],
    modelConfig: { temperature: 0.5 },
    builtin: true,
    createdAt: 1,
  };
}

function response(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

beforeEach(() => {
  jest.resetModules();
  jest
    .mocked(fetch)
    .mockReset()
    .mockResolvedValue(response({ cn: [], en: [] }));
  config.hideBuiltinMasks = false;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test("importing the registry and mask store starts no request", async () => {
  const registry = await import("../app/masks");
  const { useMaskStore } = await import("../app/store/mask");
  const saved = useMaskStore.getState().create({ name: "Saved preset" });

  expect(fetch).not.toHaveBeenCalled();
  expect(registry.BUILTIN_MASK_STORE.getSnapshot()).toBe(false);
  expect(registry.BUILTIN_MASK_STORE.getServerSnapshot()).toBe(false);
  expect(useMaskStore.getState().getAll()).toEqual([saved]);
});

test("concurrent page mounts share a pending request and publish builtins once", async () => {
  const registry = await import("../app/masks");
  const { useMaskStore } = await import("../app/store/mask");
  let resolve!: (result: Response) => void;
  jest
    .mocked(fetch)
    .mockImplementationOnce(
      () => new Promise<Response>((finish) => (resolve = finish)),
    );
  const listener = jest.fn();
  const unsubscribe = registry.BUILTIN_MASK_STORE.subscribe(listener);
  const first = registry.loadBuiltinMasks();
  const page = renderHook(() => registry.useBuiltinMasksLoaded());
  const otherPage = renderHook(() => registry.useBuiltinMasksLoaded());
  const saved = useMaskStore.getState().create({ name: "Saved while loading" });

  expect(registry.loadBuiltinMasks()).toBe(first);
  expect(page.result.current).toBe(false);
  expect(otherPage.result.current).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith("/masks.json");

  await act(async () => {
    resolve(
      response({ cn: [builtin("Chinese")], en: [builtin("English", "en")] }),
    );
    await first;
  });

  expect(page.result.current).toBe(true);
  expect(otherPage.result.current).toBe(true);
  expect(registry.BUILTIN_MASK_STORE.getServerSnapshot()).toBe(false);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(Object.keys(registry.BUILTIN_MASK_STORE.masks)).toEqual([
    String(registry.BUILTIN_MASK_ID),
    String(registry.BUILTIN_MASK_ID + 1),
  ]);
  expect(useMaskStore.getState().get(saved.id)).toEqual(saved);
  expect(
    useMaskStore
      .getState()
      .getAll("all")
      .map((mask) => mask.name),
  ).toEqual([saved.name, "Chinese", "English"]);
  expect(useMaskStore.getState().getAll()[1].modelConfig).toEqual({
    model: "default-model",
    temperature: 0.5,
  });
  config.hideBuiltinMasks = true;
  expect(useMaskStore.getState().getAll("all")).toEqual([saved]);
  await registry.loadBuiltinMasks();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(registry.BUILTIN_MASKS).toHaveLength(2);
  unsubscribe();
});

test("opening a page loads immediately without an idle callback", async () => {
  const registry = await import("../app/masks");
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(response({ cn: [builtin("Ready")] }));
  const page = renderHook(() => registry.useBuiltinMasksLoaded());

  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    await registry.loadBuiltinMasks();
  });
  expect(page.result.current).toBe(true);

  page.unmount();
  renderHook(() => registry.useBuiltinMasksLoaded());
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each(["network", "http", "invalid library", "invalid mask"])(
  "a failed %s load preserves local masks and the next page can retry",
  async (failure) => {
    const registry = await import("../app/masks");
    const { useMaskStore } = await import("../app/store/mask");
    const saved = useMaskStore.getState().create({ name: "Local preset" });
    const listener = jest.fn();
    registry.BUILTIN_MASK_STORE.subscribe(listener);
    jest.spyOn(console, "error").mockImplementation(() => {});
    if (failure === "network") {
      jest.mocked(fetch).mockRejectedValueOnce(new Error("Offline"));
    } else if (failure === "http") {
      jest.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    } else if (failure === "invalid library") {
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(
          response({ cn: [builtin("Must not be partially added")], en: null }),
        );
    } else {
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(
          response({ cn: [builtin("Must not be partially added"), null] }),
        );
    }

    await registry.loadBuiltinMasks();

    expect(registry.BUILTIN_MASK_STORE.getSnapshot()).toBe(false);
    expect(registry.BUILTIN_MASKS).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    expect(useMaskStore.getState().getAll()).toEqual([saved]);
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(response({ cn: [builtin("Retried")] }));
    const page = renderHook(() => registry.useBuiltinMasksLoaded());
    await act(async () => {
      await registry.loadBuiltinMasks();
    });

    expect(page.result.current).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      registry.BUILTIN_MASK_STORE.get(String(registry.BUILTIN_MASK_ID))?.id,
    ).toBe(registry.BUILTIN_MASK_ID);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useMaskStore.getState().get(saved.id)).toEqual(saved);
  },
);

test("an empty library is a successful load and does not refetch on mount", async () => {
  const registry = await import("../app/masks");
  jest.mocked(fetch).mockResolvedValueOnce(response({ cn: [], en: [] }));
  await registry.loadBuiltinMasks();
  const page = renderHook(() => registry.useBuiltinMasksLoaded());

  expect(page.result.current).toBe(true);
  expect(registry.BUILTIN_MASKS).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(1);
});
