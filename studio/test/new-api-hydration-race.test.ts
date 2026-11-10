/** @jest-environment node */

import { jest } from "@jest/globals";
import type { NewApiSession } from "../app/client/new-api";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ready, fail) => {
    resolve = ready;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type StorageRead = ReturnType<typeof deferred<string | null>>;
let storageReads = new Map<string, StorageRead>();
let expectedUserId: number | null = null;
const sessionRequest = jest.fn<() => Promise<NewApiSession>>();

jest.unstable_mockModule("@/app/utils/indexedDB-storage", () => ({
  indexedDBStorage: {
    getItem: (name: string) =>
      storageReads.get(name)?.promise || Promise.resolve(null),
    setItem: async () => {},
    removeItem: async () => {},
  },
}));
jest.unstable_mockModule("@/app/client/api", () => ({
  getHeaders: () => ({ "X-New-Api-User": String(expectedUserId ?? 0) }),
}));
jest.unstable_mockModule("@/app/config/client", () => ({
  getClientConfig: () => ({ buildMode: "standalone" }),
}));
jest.unstable_mockModule("@/app/client/new-api", () => ({
  newApiClient: {
    session: sessionRequest,
    modelGroups: jest.fn(async () => ({ groups: [], selectedGroup: "" })),
  },
  getExpectedNewApiUserId: () => expectedUserId,
  invalidateNewApiModelSource: () => {},
  setNewApiExpectedUser: (id: number | null) => {
    expectedUserId = id;
  },
}));

type AccessModule = typeof import("../app/store/access");
type ConfigModule = typeof import("../app/store/config");
let access: AccessModule;
let config: ConfigModule;

function hydrated(store: {
  persist: {
    hasHydrated: () => boolean;
    onFinishHydration: (callback: () => void) => () => void;
  };
}) {
  if (store.persist.hasHydrated()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const unsubscribe = store.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}

function persistedState(name: string) {
  if (name === "access-control") {
    return JSON.stringify({
      version: 2,
      state: {
        newApiEnabled: false,
        hasModelApiKey: true,
        _hasHydrated: true,
      },
    });
  }
  return JSON.stringify({
    version: 4.3,
    state: {
      ...config.DEFAULT_CONFIG,
      _hasHydrated: true,
      models: [
        {
          name: "previous-account-private-model",
          displayName: "Previous account model",
          available: true,
          sorted: 0,
          type: "text",
          provider: {
            id: "previous-account",
            providerName: "openai",
            providerType: "openai",
            sorted: 0,
          },
        },
      ],
    },
  });
}

beforeEach(async () => {
  jest.resetModules();
  storageReads = new Map([
    ["access-control", deferred<string | null>()],
    ["app-config", deferred<string | null>()],
  ]);
  expectedUserId = null;
  sessionRequest.mockReset().mockResolvedValue({
    authenticated: true,
    selectedTokenId: 2900,
    user: {
      id: 29,
      username: "current-account",
      display_name: "Current Account",
      quota: 100,
      used_quota: 0,
      request_count: 0,
      group: "default",
    },
  });
  global.fetch = jest
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      url === "/studio/api/config"
        ? Response.json({ newApiEnabled: true })
        : Response.json({ data: [{ id: "current-account-model" }] }),
    );
  jest.spyOn(console, "log").mockImplementation(() => {});
  config = await import("../app/store/config");
  access = await import("../app/store/access");
});

afterEach(async () => {
  for (const pending of storageReads.values()) pending.resolve(null);
  await Promise.resolve();
  jest.restoreAllMocks();
});

describe("New API startup with asynchronous persisted state", () => {
  test.each(["access-control", "app-config"])(
    "does not let late %s hydration overwrite the current account's settings or models",
    async (delayedStore) => {
      const earlyStore =
        delayedStore === "access-control" ? "app-config" : "access-control";
      storageReads.get(earlyStore)!.resolve(persistedState(earlyStore));
      await hydrated(
        earlyStore === "app-config"
          ? config.useAppConfig
          : access.useAccessStore,
      );

      const loading = access.useAccessStore.getState().fetch();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(fetch).not.toHaveBeenCalled();
      storageReads.get(delayedStore)!.resolve(persistedState(delayedStore));
      await hydrated(
        delayedStore === "app-config"
          ? config.useAppConfig
          : access.useAccessStore,
      );
      await loading;

      expect({
        accountMode: access.useAccessStore.getState().newApiEnabled,
        expectedUserId,
        models: config.useAppConfig
          .getState()
          .models.filter((model) => model.available)
          .map((model) => model.name),
      }).toEqual({
        accountMode: true,
        expectedUserId: 29,
        models: ["current-account-model"],
      });
    },
  );

  test.each([
    ["access-control", "read-error"],
    ["app-config", "invalid-json"],
  ])(
    "continues startup when %s hydration ends with %s",
    async (failedStore, failure) => {
      const loading = access.useAccessStore.getState().fetch();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(fetch).not.toHaveBeenCalled();
      const otherStore =
        failedStore === "access-control" ? "app-config" : "access-control";
      storageReads.get(otherStore)!.resolve(null);
      if (failure === "read-error") {
        storageReads
          .get(failedStore)!
          .reject(new Error("Simulated unavailable persistent storage"));
      } else {
        storageReads.get(failedStore)!.resolve("{invalid-json");
      }
      await loading;

      const failed =
        failedStore === "app-config"
          ? config.useAppConfig
          : access.useAccessStore;
      expect(failed.getState()._hasHydrated).toBe(true);
      expect(failed.persist.hasHydrated()).toBe(false);
      expect(access.useAccessStore.getState().newApiEnabled).toBe(true);
      expect(expectedUserId).toBe(29);
      expect(
        config.useAppConfig
          .getState()
          .models.filter((model) => model.available)
          .map((model) => model.name),
      ).toEqual(["current-account-model"]);
    },
  );
});
