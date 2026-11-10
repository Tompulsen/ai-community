import { jest } from "@jest/globals";
import { Path } from "../app/constant";

const settingsLoaded = jest.fn<() => Promise<void>>();
const accountLoaded = jest.fn<() => Promise<void>>();
const galleryLoaded = jest.fn<() => Promise<void>>();
const videoLoaded = jest.fn<() => Promise<void>>();
const Settings = jest.fn(() => null);
const AccountPage = jest.fn(() => null);
const GalleryPage = jest.fn(() => null);
const VideoWorkspace = jest.fn(() => null);
const idleTasks: { run: () => void; cancel: ReturnType<typeof jest.fn> }[] = [];

jest.unstable_mockModule("@/app/components/settings", async () => {
  await settingsLoaded();
  return { Settings };
});
jest.unstable_mockModule("@/app/components/account", async () => {
  await accountLoaded();
  return { AccountPage };
});
jest.unstable_mockModule("@/app/components/gallery/gallery", async () => {
  await galleryLoaded();
  return { GalleryPage };
});
jest.unstable_mockModule(
  "@/app/components/video-workspace/video-workspace",
  async () => {
    await videoLoaded();
    return { VideoWorkspace };
  },
);
jest.unstable_mockModule("@/app/utils/schedule-idle-task", () => ({
  scheduleIdleTask: (run: () => void) => {
    const cancel = jest.fn();
    idleTasks.push({ run, cancel });
    return cancel;
  },
}));

const originalConnection = Object.getOwnPropertyDescriptor(
  navigator,
  "connection",
);

function setConnection(connection: {
  saveData?: boolean;
  effectiveType?: string;
}) {
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value: connection,
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => (resolve = finish));
  return { promise, resolve };
}

beforeEach(() => {
  jest.resetModules();
  for (const loaded of [
    settingsLoaded,
    accountLoaded,
    galleryLoaded,
    videoLoaded,
  ]) {
    loaded.mockReset().mockResolvedValue();
  }
  for (const Page of [Settings, AccountPage, GalleryPage, VideoWorkspace]) {
    Page.mockClear();
  }
  idleTasks.length = 0;
  setConnection({ effectiveType: "4g" });
});

afterEach(() => {
  jest.restoreAllMocks();
  if (originalConnection) {
    Object.defineProperty(navigator, "connection", originalConnection);
  } else {
    Reflect.deleteProperty(navigator, "connection");
  }
});

test("importing the helper starts no route imports", async () => {
  await import("../app/utils/preload-workspace-routes");
  expect(settingsLoaded).not.toHaveBeenCalled();
  expect(accountLoaded).not.toHaveBeenCalled();
  expect(galleryLoaded).not.toHaveBeenCalled();
  expect(videoLoaded).not.toHaveBeenCalled();
  expect(idleTasks).toHaveLength(0);
});

test("intent and activation share one module load without mounting the account", async () => {
  const { preloadWorkspaceRoute, getPreloadedWorkspaceRoute } = await import(
    "../app/utils/preload-workspace-routes"
  );
  expect(getPreloadedWorkspaceRoute(Path.Account)).toBeUndefined();
  const first = preloadWorkspaceRoute(Path.Account);
  expect(preloadWorkspaceRoute(Path.Account, "activation")).toBe(first);
  await first;
  await preloadWorkspaceRoute(Path.Account);
  expect(accountLoaded).toHaveBeenCalledTimes(1);
  expect(getPreloadedWorkspaceRoute(Path.Account)).toBe(AccountPage);
  expect(AccountPage).not.toHaveBeenCalled();
});

test("a failed speculative import settles silently and can be retried", async () => {
  settingsLoaded.mockRejectedValueOnce(new Error("Temporary chunk failure"));
  const { preloadWorkspaceRoute, getPreloadedWorkspaceRoute } = await import(
    "../app/utils/preload-workspace-routes"
  );
  await expect(preloadWorkspaceRoute(Path.Settings)).resolves.toBeUndefined();
  expect(getPreloadedWorkspaceRoute(Path.Settings)).toBeUndefined();
  await expect(
    preloadWorkspaceRoute(Path.Settings, "activation"),
  ).resolves.toBeUndefined();
  expect(settingsLoaded).toHaveBeenCalledTimes(2);
  expect(getPreloadedWorkspaceRoute(Path.Settings)).toBe(Settings);
});

test.each([
  { saveData: true },
  { effectiveType: "slow-2g" },
  { effectiveType: "2g" },
  { effectiveType: "3g", saveData: true },
])(
  "limited networks skip idle, hover and focus but allow activation: %j",
  async (connection) => {
    setConnection(connection);
    const {
      preloadWorkspaceRoute,
      workspaceRoutePreloadHandlers,
      preloadCommonWorkspaceRoutes,
    } = await import("../app/utils/preload-workspace-routes");
    preloadCommonWorkspaceRoutes();
    expect(idleTasks).toHaveLength(0);
    const handlers = workspaceRoutePreloadHandlers(Path.Settings);
    handlers.onPointerEnter();
    handlers.onFocus();
    await preloadWorkspaceRoute(Path.Settings);
    expect(settingsLoaded).not.toHaveBeenCalled();

    handlers.onPointerDown();
    await preloadWorkspaceRoute(Path.Settings, "activation");
    expect(settingsLoaded).toHaveBeenCalledTimes(1);
  },
);

test.each(["onPointerEnter", "onFocus"] as const)(
  "3g skips idle but allows %s to load only the intended route",
  async (handler) => {
    setConnection({ effectiveType: "3g" });
    const account = deferred();
    const started = deferred();
    accountLoaded.mockImplementationOnce(() => {
      started.resolve();
      return account.promise;
    });
    const {
      preloadWorkspaceRoute,
      workspaceRoutePreloadHandlers,
      preloadCommonWorkspaceRoutes,
    } = await import("../app/utils/preload-workspace-routes");

    preloadCommonWorkspaceRoutes();
    expect(idleTasks).toHaveLength(0);
    await preloadWorkspaceRoute(Path.Account, "idle");
    expect(accountLoaded).not.toHaveBeenCalled();

    workspaceRoutePreloadHandlers(Path.Account)[handler]();
    await started.promise;
    const loading = preloadWorkspaceRoute(Path.Account);
    expect(preloadWorkspaceRoute(Path.Account, "activation")).toBe(loading);
    account.resolve();
    await loading;
    expect(accountLoaded).toHaveBeenCalledTimes(1);
    expect(settingsLoaded).not.toHaveBeenCalled();
    expect(galleryLoaded).not.toHaveBeenCalled();
    expect(AccountPage).not.toHaveBeenCalled();
  },
);

test("offline skips idle and intent but allows activation", async () => {
  jest.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const {
    preloadWorkspaceRoute,
    workspaceRoutePreloadHandlers,
    preloadCommonWorkspaceRoutes,
  } = await import("../app/utils/preload-workspace-routes");

  preloadCommonWorkspaceRoutes();
  expect(idleTasks).toHaveLength(0);
  const handlers = workspaceRoutePreloadHandlers(Path.Settings);
  handlers.onPointerEnter();
  handlers.onFocus();
  await preloadWorkspaceRoute(Path.Settings);
  expect(settingsLoaded).not.toHaveBeenCalled();

  handlers.onPointerDown();
  await preloadWorkspaceRoute(Path.Settings, "activation");
  expect(settingsLoaded).toHaveBeenCalledTimes(1);
});

test("idle prewarming loads settings, then account in a separate idle task", async () => {
  const settings = deferred();
  const started = deferred();
  settingsLoaded.mockImplementationOnce(() => {
    started.resolve();
    return settings.promise;
  });
  const { preloadCommonWorkspaceRoutes, preloadWorkspaceRoute } = await import(
    "../app/utils/preload-workspace-routes"
  );
  const cancel = preloadCommonWorkspaceRoutes();
  expect(idleTasks).toHaveLength(1);
  expect(settingsLoaded).not.toHaveBeenCalled();
  idleTasks[0].run();
  await started.promise;
  expect(accountLoaded).not.toHaveBeenCalled();
  expect(idleTasks).toHaveLength(1);

  settings.resolve();
  await preloadWorkspaceRoute(Path.Settings);
  expect(idleTasks).toHaveLength(2);
  expect(accountLoaded).not.toHaveBeenCalled();
  idleTasks[1].run();
  await preloadWorkspaceRoute(Path.Account);
  expect(accountLoaded).toHaveBeenCalledTimes(1);
  expect(galleryLoaded).not.toHaveBeenCalled();
  expect(videoLoaded).not.toHaveBeenCalled();
  cancel();
});

test("unmounting before idle cancels the queued task and prevents imports", async () => {
  const { preloadCommonWorkspaceRoutes } = await import(
    "../app/utils/preload-workspace-routes"
  );
  const cancel = preloadCommonWorkspaceRoutes();
  cancel();
  expect(idleTasks[0].cancel).toHaveBeenCalledTimes(1);
  idleTasks[0].run();
  expect(settingsLoaded).not.toHaveBeenCalled();
  expect(accountLoaded).not.toHaveBeenCalled();
});

test("unmounting during settings loading prevents the account idle task", async () => {
  const settings = deferred();
  const started = deferred();
  settingsLoaded.mockImplementationOnce(() => {
    started.resolve();
    return settings.promise;
  });
  const { preloadCommonWorkspaceRoutes, preloadWorkspaceRoute } = await import(
    "../app/utils/preload-workspace-routes"
  );
  const cancel = preloadCommonWorkspaceRoutes();
  idleTasks[0].run();
  await started.promise;
  cancel();
  settings.resolve();
  await preloadWorkspaceRoute(Path.Settings);
  expect(idleTasks).toHaveLength(1);
  expect(accountLoaded).not.toHaveBeenCalled();
});

test("unmounting after settings cancels the second idle task", async () => {
  const { preloadCommonWorkspaceRoutes, preloadWorkspaceRoute } = await import(
    "../app/utils/preload-workspace-routes"
  );
  const cancel = preloadCommonWorkspaceRoutes();
  idleTasks[0].run();
  await preloadWorkspaceRoute(Path.Settings);
  expect(idleTasks).toHaveLength(2);
  cancel();
  expect(idleTasks[1].cancel).toHaveBeenCalledTimes(1);
  idleTasks[1].run();
  expect(accountLoaded).not.toHaveBeenCalled();
});

test.each([{ saveData: true }, { effectiveType: "3g" }])(
  "a network change before idle prevents the queued import: %j",
  async (connection) => {
    const { preloadCommonWorkspaceRoutes, preloadWorkspaceRoute } =
      await import("../app/utils/preload-workspace-routes");
    preloadCommonWorkspaceRoutes();
    setConnection(connection);
    idleTasks[0].run();
    await preloadWorkspaceRoute(Path.Settings, "idle");
    expect(settingsLoaded).not.toHaveBeenCalled();
    expect(idleTasks).toHaveLength(1);
    await preloadWorkspaceRoute(Path.Account, "activation");
    expect(accountLoaded).toHaveBeenCalledTimes(1);
  },
);

test("gallery loads only when requested and retired video routes remain unloaded", async () => {
  const { preloadWorkspaceRoute, getPreloadedWorkspaceRoute } = await import(
    "../app/utils/preload-workspace-routes"
  );
  await preloadWorkspaceRoute(Path.McpMarket, "activation");
  await preloadWorkspaceRoute(Path.Masks, "activation");
  await preloadWorkspaceRoute(Path.Video);
  await preloadWorkspaceRoute(Path.Video, "activation");
  expect(settingsLoaded).not.toHaveBeenCalled();
  expect(accountLoaded).not.toHaveBeenCalled();
  expect(galleryLoaded).not.toHaveBeenCalled();
  expect(videoLoaded).not.toHaveBeenCalled();
  await preloadWorkspaceRoute(Path.Gallery);
  expect(galleryLoaded).toHaveBeenCalledTimes(1);
  expect(videoLoaded).not.toHaveBeenCalled();
  expect(getPreloadedWorkspaceRoute(Path.Gallery)).toBe(GalleryPage);
  expect(getPreloadedWorkspaceRoute(Path.Video)).toBeUndefined();
  expect(GalleryPage).not.toHaveBeenCalled();
  expect(VideoWorkspace).not.toHaveBeenCalled();
});
