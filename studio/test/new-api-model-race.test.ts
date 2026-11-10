/** @jest-environment node */

import { jest } from "@jest/globals";
import { createStore } from "zustand/vanilla";
import type { LLMModel } from "../app/client/api";
import type { NewApiSession } from "../app/client/new-api";
import { confirmLocalToken } from "../app/utils/local-workspace";

let expectedUserId: number | null = null;
const sessionRequest = jest.fn<() => Promise<NewApiSession>>();
const modelState = {
  models: [] as LLMModel[],
  clearModels() {
    modelState.models = [];
  },
  mergeModels(models: LLMModel[]) {
    modelState.models = models;
  },
};
const defaultConfig = { modelConfig: { model: "", providerName: "" } };

jest.unstable_mockModule("@/app/client/api", () => ({
  getHeaders: () => ({ "X-New-Api-User": String(expectedUserId ?? 0) }),
}));
jest.unstable_mockModule("@/app/config/client", () => ({
  getClientConfig: () => ({ buildMode: "standalone" }),
}));
jest.unstable_mockModule("@/app/utils/store", () => ({
  createPersistStore: (
    initial: object,
    methods: (set: unknown, get: unknown) => object,
  ) => createStore((set, get) => ({ ...initial, ...methods(set, get) })),
}));
jest.unstable_mockModule("@/app/store/config", () => ({
  DEFAULT_CONFIG: defaultConfig,
  useAppConfig: { getState: () => modelState },
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
let access: AccessModule;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}

function userSession(id: number): NewApiSession {
  return {
    authenticated: true,
    user: {
      id,
      username: `account-${id}`,
      display_name: `Account ${id}`,
      quota: 100,
      used_quota: 0,
      request_count: 0,
      group: "default",
    },
    selectedTokenId: id * 100,
  };
}

function config(defaultModel = "") {
  return Response.json({ newApiEnabled: true, defaultModel });
}

beforeAll(async () => {
  access = await import("../app/store/access");
});

beforeEach(() => {
  global.fetch = jest.fn<typeof fetch>();
  sessionRequest.mockReset();
  expectedUserId = null;
  confirmLocalToken(null);
  modelState.models = [];
  defaultConfig.modelConfig.model = "";
  defaultConfig.modelConfig.providerName = "";
  access.resetFetchState();
  access.useAccessStore.setState({
    newApiEnabled: true,
    useCustomConfig: false,
    modelRefreshError: false,
  });
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("New API account-bound model discovery races", () => {
  test("focus reuses a fresh list and expired refresh keeps it visible until replacement", async () => {
    sessionRequest.mockResolvedValue(userSession(17));
    jest
      .mocked(fetch)
      .mockImplementation(async (url) =>
        url === "/studio/api/config"
          ? config()
          : Response.json({ data: [{ id: "cached" }] }),
      );
    await access.refetchModels();
    const requests = jest.mocked(fetch).mock.calls.length;
    await access.refreshNewApiModels();
    expect(jest.mocked(fetch).mock.calls).toHaveLength(requests);
    const later = Date.now() + 60_001;
    jest.spyOn(Date, "now").mockReturnValue(later);
    const pending = deferred<Response>();
    jest.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const refresh = access.refreshNewApiModels();
    expect(access.useAccessStore.getState().modelListStatus).toBe("ready");
    expect(modelState.models[0].name).toBe("cached");
    pending.resolve(Response.json({ data: [{ id: "updated" }] }));
    await refresh;
    expect(modelState.models[0].name).toBe("updated");
  });

  test("revisiting a confirmed key displays its cache while one shared request revalidates it", async () => {
    sessionRequest.mockResolvedValue(userSession(17));
    jest
      .mocked(fetch)
      .mockImplementation(async (url) =>
        url === "/studio/api/config"
          ? config()
          : Response.json({ data: [{ id: "first-key" }] }),
      );
    await access.refetchModels();
    confirmLocalToken(2700);
    const pending = deferred<Response>();
    jest.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const switching = access.refreshSelectedNewApiModels({
      userId: 17,
      tokenId: 2700,
    });
    expect(modelState.models).toEqual([]);
    expect(access.useAccessStore.getState().modelListStatus).toBe("loading");
    pending.resolve(Response.json({ data: [{ id: "second-key" }] }));
    await switching;
    confirmLocalToken(1700);
    const requests = jest.mocked(fetch).mock.calls.length;
    await access.refreshSelectedNewApiModels({ userId: 17, tokenId: 1700 });
    expect(modelState.models[0].name).toBe("first-key");
    expect(jest.mocked(fetch).mock.calls).toHaveLength(requests);
    confirmLocalToken(2700);
    await access.refreshSelectedNewApiModels({ userId: 17, tokenId: 2700 });
    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001);
    confirmLocalToken(1700);
    const updated = deferred<Response>();
    jest.mocked(fetch).mockImplementationOnce(() => updated.promise);
    const revisit = access.refreshSelectedNewApiModels({
      userId: 17,
      tokenId: 1700,
    });
    expect(modelState.models[0].name).toBe("first-key");
    expect(access.useAccessStore.getState().modelListStatus).toBe("ready");
    expect(
      access.refreshSelectedNewApiModels({ userId: 17, tokenId: 1700 }),
    ).toBe(revisit);
    expect(jest.mocked(fetch).mock.calls).toHaveLength(requests + 1);
    updated.resolve(Response.json({ data: [{ id: "updated-first-key" }] }));
    await revisit;
    expect(modelState.models[0].name).toBe("updated-first-key");
    expect(sessionRequest).toHaveBeenCalledTimes(1);
  });

  test.each([401, 403, 409])(
    "permission failure %s discards the cached list",
    async (status) => {
      sessionRequest.mockResolvedValue(userSession(17));
      jest
        .mocked(fetch)
        .mockImplementation(async (url) =>
          url === "/studio/api/config"
            ? config()
            : Response.json({ data: [{ id: "private" }] }),
        );
      await access.refetchModels();
      jest
        .mocked(fetch)
        .mockImplementation(async (url) =>
          url === "/studio/api/config" ? config() : Response.json({}, { status }),
        );
      jest.spyOn(console, "error").mockImplementation(() => {});
      await access.refreshNewApiModels(true);
      expect(modelState.models).toEqual([]);
      expect(access.useAccessStore.getState().modelListStatus).toBe("error");
    },
  );

  test("keeps failed discovery stable until explicit retry, then recovers", async () => {
    sessionRequest.mockResolvedValue(userSession(17));
    jest
      .mocked(fetch)
      .mockImplementation(async (url) =>
        url === "/studio/api/config" ? config() : Response.json({}, { status: 503 }),
      );
    jest.spyOn(console, "error").mockImplementation(() => {});
    await access.refetchModels();
    expect(access.useAccessStore.getState().modelListStatus).toBe("error");
    const requests = jest.mocked(fetch).mock.calls.length;
    access.useAccessStore.getState().isAuthorized();
    await access.useAccessStore.getState().fetch();
    expect(jest.mocked(fetch).mock.calls).toHaveLength(requests);
    jest
      .mocked(fetch)
      .mockImplementation(async (url) =>
        url === "/studio/api/config"
          ? config()
          : Response.json({ data: [{ id: "recovered-model" }] }),
      );
    await access.refetchModels();
    expect(access.useAccessStore.getState().modelListStatus).toBe("ready");
    expect(modelState.models.map((model) => model.name)).toEqual([
      "recovered-model",
    ]);
  });

  test("a temporary background failure preserves the current scoped list for retry", async () => {
    sessionRequest.mockResolvedValue(userSession(17));
    jest
      .mocked(fetch)
      .mockImplementation(async (url) =>
        url === "/studio/api/config"
          ? config()
          : Response.json({ data: [{ id: "old" }] }),
      );
    await access.refetchModels();
    jest.mocked(fetch).mockResolvedValue(Response.json({}, { status: 503 }));
    await access.refreshNewApiModels(true);
    expect(access.useAccessStore.getState().modelListStatus).toBe("ready");
    expect(access.useAccessStore.getState().modelRefreshError).toBe(true);
    expect(modelState.models.map((model) => model.name)).toEqual(["old"]);
    const requests = jest.mocked(fetch).mock.calls.length;
    await access.useAccessStore.getState().fetch();
    expect(jest.mocked(fetch).mock.calls).toHaveLength(requests);
  });

  test("custom model discovery still confirms account identity and never sends provider auth to config", async () => {
    access.useAccessStore.setState({
      useCustomConfig: true,
      openaiUrl: "https://provider.test/v1",
      openaiApiKey: "sk-fixture",
    });
    sessionRequest.mockResolvedValue(userSession(17));
    jest
      .mocked(fetch)
      .mockImplementation(async (url) =>
        url === "/studio/api/config"
          ? config()
          : Response.json({ data: [{ id: "custom" }] }),
      );
    await access.useAccessStore.getState().fetch();
    expect(sessionRequest).toHaveBeenCalledTimes(1);
    expect(expectedUserId).toBe(17);
    const [, options] = jest
      .mocked(fetch)
      .mock.calls.find(([url]) => url === "/studio/api/config")!;
    expect(options?.headers).toBeUndefined();
    await access.refreshNewApiModels(true);
    expect(sessionRequest).toHaveBeenCalledTimes(1);
    expect(
      jest
        .mocked(fetch)
        .mock.calls.some(([url]) => url === "/studio/api/remote-models"),
    ).toBe(true);
    expect(
      jest
        .mocked(fetch)
        .mock.calls.every(
          ([url]) => !String(url).startsWith("https://provider.test"),
        ),
    ).toBe(true);
  });

  test("replaces models when the same key's group changes outside the chat app", async () => {
    sessionRequest.mockResolvedValue(userSession(17));
    jest
      .mocked(fetch)
      .mockImplementation(async (url) =>
        url === "/studio/api/config"
          ? config()
          : Response.json({ data: [{ id: "old-group-model" }] }),
      );
    await access.useAccessStore.getState().fetch();
    jest
      .mocked(fetch)
      .mockResolvedValue(Response.json({ data: [{ id: "new-group-model" }] }));
    await access.refreshNewApiModels(true);
    expect(modelState.models.map((model) => model.name)).toEqual([
      "new-group-model",
    ]);
    expect(sessionRequest).toHaveBeenCalledTimes(1);
    expect(expectedUserId).toBe(17);
  });

  test("coalesces background refreshes and discards results after selecting another key", async () => {
    sessionRequest.mockResolvedValue(userSession(17));
    jest
      .mocked(fetch)
      .mockImplementation(async (url) =>
        url === "/studio/api/config"
          ? config()
          : Response.json({ data: [{ id: "first-key-model" }] }),
      );
    await access.useAccessStore.getState().fetch();
    const stale = deferred<Response>();
    jest.mocked(fetch).mockImplementationOnce(() => stale.promise);
    const first = access.refreshNewApiModels(true);
    const second = access.refreshNewApiModels(true);
    expect(second).toBe(first);
    jest
      .mocked(fetch)
      .mockImplementation(async (url) =>
        url === "/studio/api/config"
          ? config()
          : Response.json({ data: [{ id: "second-key-model" }] }),
      );
    await access.refetchModels();
    stale.resolve(Response.json({ data: [{ id: "old-group-model" }] }));
    await first;
    expect(access.useAccessStore.getState().modelListStatus).toBe("ready");
    expect(modelState.models.map((model) => model.name)).toEqual([
      "second-key-model",
    ]);
  });

  test("clears models when the selected group has none", async () => {
    sessionRequest.mockResolvedValue(userSession(17));
    jest
      .mocked(fetch)
      .mockImplementation(async (url) =>
        url === "/studio/api/config"
          ? config()
          : Response.json({ data: [{ id: "old-model" }] }),
      );
    await access.useAccessStore.getState().fetch();
    jest.mocked(fetch).mockResolvedValue(Response.json({ data: [] }));
    await access.refreshNewApiModels(true);
    expect(modelState.models).toEqual([]);
  });

  test("rebinds the session when another tab has changed the selected key", async () => {
    sessionRequest.mockResolvedValue(userSession(17));
    jest
      .mocked(fetch)
      .mockImplementation(async (url) =>
        url === "/studio/api/config"
          ? config()
          : Response.json({ data: [{ id: "old-model" }] }),
      );
    await access.useAccessStore.getState().fetch();
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(Response.json({}, { status: 409 }))
      .mockImplementation(async (url) =>
        url === "/studio/api/config"
          ? config()
          : Response.json({ data: [{ id: "current-model" }] }),
      );
    await access.refreshNewApiModels(true);
    expect(sessionRequest).toHaveBeenCalledTimes(2);
    expect(modelState.models.map((model) => model.name)).toEqual([
      "current-model",
    ]);
  });

  test("ignores a previous account's delayed config after a new fetch completes", async () => {
    const previousConfig = deferred<Response>();
    const previousConfigStarted = deferred<void>();
    let configRequests = 0;
    sessionRequest.mockResolvedValue(userSession(29));
    jest.mocked(fetch).mockImplementation(async (url) => {
      if (url === "/studio/api/config") {
        configRequests++;
        if (configRequests === 1) {
          previousConfigStarted.resolve();
          return previousConfig.promise;
        }
        return config("current-model");
      }
      return Response.json({ data: [{ id: "account-29-model" }] });
    });
    const previous = access.useAccessStore.getState().fetch();
    await previousConfigStarted.promise;
    await access.refetchModels();
    previousConfig.resolve(config("outdated-model"));
    await previous;

    expect(expectedUserId).toBe(29);
    expect(modelState.models.map((model) => model.name)).toEqual([
      "account-29-model",
    ]);
    expect(defaultConfig.modelConfig.model).toBe("current-model");
    expect(sessionRequest).toHaveBeenCalledTimes(1);
  });

  test("ignores a previous account's delayed session after a new login", async () => {
    const previousSession = deferred<NewApiSession>();
    const sessionStarted = deferred<void>();
    sessionRequest
      .mockImplementationOnce(() => {
        sessionStarted.resolve();
        return previousSession.promise;
      })
      .mockResolvedValueOnce(userSession(29));
    jest
      .mocked(fetch)
      .mockImplementation(async (url) =>
        url === "/studio/api/config"
          ? config()
          : Response.json({ data: [{ id: "account-29-model" }] }),
      );
    const previous = access.useAccessStore.getState().fetch();
    await sessionStarted.promise;
    await access.refetchModels();
    previousSession.resolve(userSession(17));
    await previous;

    expect(expectedUserId).toBe(29);
    expect(modelState.models.map((model) => model.name)).toEqual([
      "account-29-model",
    ]);
    expect(
      jest
        .mocked(fetch)
        .mock.calls.filter(([url]) => url === "/studio/api/remote-models"),
    ).toHaveLength(1);
  });

  test("ignores a previous account's delayed model list after switching accounts", async () => {
    const previousModels = deferred<Response>();
    const modelRequestStarted = deferred<void>();
    let modelRequests = 0;
    sessionRequest
      .mockResolvedValueOnce(userSession(17))
      .mockResolvedValueOnce(userSession(29));
    jest.mocked(fetch).mockImplementation(async (url) => {
      if (url === "/studio/api/config") return config();
      modelRequests++;
      if (modelRequests === 1) {
        modelRequestStarted.resolve();
        return previousModels.promise;
      }
      return Response.json({ data: [{ id: "account-29-model" }] });
    });
    const previous = access.useAccessStore.getState().fetch();
    await modelRequestStarted.promise;
    await access.refetchModels();
    previousModels.resolve(
      Response.json({ data: [{ id: "account-17-private-model" }] }),
    );
    await previous;

    expect(expectedUserId).toBe(29);
    expect(modelState.models.map((model) => model.name)).toEqual([
      "account-29-model",
    ]);
    const [, currentRequest] = jest
      .mocked(fetch)
      .mock.calls.filter(([url]) => url === "/studio/api/remote-models")[1];
    expect(new Headers(currentRequest?.headers).get("x-new-api-user")).toBe(
      "29",
    );
  });
});
