import type { NewApiSession } from "../client/new-api";

export type WorkspaceBootstrap = {
  config: DangerConfig;
  session: NewApiSession;
};

type EarlyRequest = {
  startedAt: number;
  response: Promise<Response | null>;
  invalidated?: boolean;
  cancel?: () => void;
  finish?: () => void;
};

declare global {
  interface Window {
    __octopusWorkspaceBootstrap?: EarlyRequest;
    __octopusWorkspaceEpoch?: number;
    __octopusWorkspaceWatching?: boolean;
    __octopusWorkspaceStarted?: boolean;
  }
}

let initialConfig: DangerConfig | undefined;
let initialSession: NewApiSession | undefined;
let sessionRevision = 0;
let initialSessionRevision = -1;
const responseRevisions = new WeakMap<WorkspaceBootstrap, number>();

export function getWorkspaceBootstrapRevision() {
  return (
    sessionRevision +
    (typeof window === "undefined" ? 0 : window.__octopusWorkspaceEpoch ?? 0)
  );
}

export function discardWorkspaceSession() {
  sessionRevision++;
  initialSession = undefined;
  if (typeof window !== "undefined") {
    if (window.__octopusWorkspaceBootstrap) {
      window.__octopusWorkspaceBootstrap.invalidated = true;
      window.__octopusWorkspaceBootstrap.cancel?.();
    }
  }
}

export function isWorkspaceBootstrapCurrent(data: WorkspaceBootstrap) {
  return responseRevisions.get(data) === getWorkspaceBootstrapRevision();
}

export function rememberWorkspaceBootstrap(
  data: WorkspaceBootstrap,
  revision: number,
) {
  initialConfig = data.config;
  if (revision === getWorkspaceBootstrapRevision()) {
    initialSession = data.session;
    initialSessionRevision = revision;
  }
}

export function consumeWorkspaceConfig() {
  const config = initialConfig;
  initialConfig = undefined;
  return config;
}

export function peekWorkspaceSession() {
  return initialSessionRevision === getWorkspaceBootstrapRevision()
    ? initialSession
    : undefined;
}

export function consumeWorkspaceSession() {
  const session = peekWorkspaceSession();
  initialSession = undefined;
  return session;
}

export async function loadWorkspaceBootstrap(): Promise<WorkspaceBootstrap> {
  window.__octopusWorkspaceStarted = true;
  // The async head script may arrive after the main bundle on a warm cache.
  if (!window.__octopusWorkspaceWatching) {
    window.__octopusWorkspaceWatching = true;
    const invalidate = () => {
      window.__octopusWorkspaceEpoch =
        (window.__octopusWorkspaceEpoch ?? 0) + 1;
      const pending = window.__octopusWorkspaceBootstrap;
      if (pending) {
        pending.invalidated = true;
        pending.cancel?.();
      }
    };
    window.addEventListener("storage", (event) => {
      if (event.key === "octopus-new-api-session") invalidate();
    });
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel("octopus-new-api-session");
      channel.addEventListener("message", (event) => {
        if (event.data?.type === "session-changed") invalidate();
      });
    }
  }
  // Account changes can arrive before React subscribes, or while JSON is read.
  for (let attempt = 0; attempt < 3; attempt++) {
    const revision = getWorkspaceBootstrapRevision();
    let early = window.__octopusWorkspaceBootstrap;
    if (!early || early.invalidated || Date.now() - early.startedAt >= 15000) {
      early?.cancel?.();
      early?.finish?.();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      early = {
        startedAt: Date.now(),
        cancel: () => controller.abort(),
        finish: () => clearTimeout(timeout),
        response: fetch("/studio/api/new-api/bootstrap", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        }).catch(() => {
          clearTimeout(timeout);
          return null;
        }),
      };
      window.__octopusWorkspaceBootstrap = early;
    }
    let result;
    try {
      const response = await early.response;
      if (early.invalidated || revision !== getWorkspaceBootstrapRevision())
        continue;
      if (!response?.ok) throw new Error("无法确认登录身份，请重试");
      result = await response.json();
    } catch (error) {
      if (early.invalidated || revision !== getWorkspaceBootstrapRevision())
        continue;
      throw error;
    } finally {
      // Keep the request deadline active until the body has finished reading.
      early.finish?.();
      if (window.__octopusWorkspaceBootstrap === early)
        delete window.__octopusWorkspaceBootstrap;
    }
    if (early.invalidated || revision !== getWorkspaceBootstrapRevision())
      continue;
    const data = result?.data;
    if (
      result?.success !== true ||
      typeof data?.config?.newApiEnabled !== "boolean" ||
      typeof data?.session?.authenticated !== "boolean" ||
      (data.session.authenticated
        ? !Number.isSafeInteger(data.session.user?.id) ||
          data.session.user.id <= 0
        : data.session.user != null || data.session.selectedTokenId != null) ||
      (data.session.selectedTokenId != null &&
        (!Number.isSafeInteger(data.session.selectedTokenId) ||
          data.session.selectedTokenId <= 0))
    ) {
      throw new Error("无法确认账号状态，请重试");
    }
    responseRevisions.set(data, revision);
    return data;
  }
  throw new Error("账号状态正在变化，请重试");
}
