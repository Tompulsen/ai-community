import {
  discardWorkspaceSession,
  getWorkspaceBootstrapRevision,
  isWorkspaceBootstrapCurrent,
  loadWorkspaceBootstrap,
  rememberWorkspaceBootstrap,
} from "./workspace-bootstrap";

export type LocalScope = "legacy" | "guest" | `user-${number}`;

let scope: LocalScope | undefined;
let initialization: Promise<LocalScope> | undefined;
let switching = false;
let selectedTokenId: number | null = null;
let confirmedIdentity: number | null | undefined;
let tokenRevision = 0;
let maintenance = false;
let drainingMaintenanceWrites = false;
const writes = new Set<Promise<unknown>>();
let revision = "";
let releaseLock: (() => void) | undefined;
let leaseId: string | undefined;
let renewal: ReturnType<typeof setInterval> | undefined;

function leaseKey(owner = getLocalScope()) {
  return localKey("data-maintenance", owner);
}
function revisionKey(owner = getLocalScope()) {
  return localKey("data-revision", owner);
}
function hasLease(owner: LocalScope) {
  try {
    return (
      Number(
        JSON.parse(localStorage.getItem(leaseKey(owner)) || "null")?.expires,
      ) > Date.now()
    );
  } catch {
    return false;
  }
}

async function bindScope(owner: LocalScope) {
  while (hasLease(owner))
    await new Promise((resolve) => setTimeout(resolve, 250));
  if (
    owner !== "legacy" &&
    confirmedIdentity !== undefined &&
    owner !==
      (confirmedIdentity === null ? "guest" : `user-${confirmedIdentity}`)
  ) {
    throw new Error("登录身份已变化，请刷新页面重新确认");
  }
  scope = owner;
  revision = localStorage.getItem(revisionKey()) || "";
  let observedLease = false;
  let expiryCheck: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    if (hasLease(owner)) {
      observedLease = true;
      window.dispatchEvent(new Event("local-data-maintenance"));
      clearTimeout(expiryCheck);
      expiryCheck = setTimeout(check, 1000);
    } else if (
      observedLease ||
      (localStorage.getItem(revisionKey()) || "") !== revision
    ) {
      switching = true;
      window.dispatchEvent(new Event("local-workspace-switch"));
      window.location.reload();
    }
  };
  window.addEventListener("storage", (event) => {
    if (event.key !== leaseKey() && event.key !== revisionKey()) return;
    check();
  });
  return owner;
}

export function getLocalTokenId() {
  return selectedTokenId;
}
export function confirmLocalToken(id: number | null) {
  discardWorkspaceSession();
  selectedTokenId = id;
  tokenRevision++;
}

export function localKey(name: string, owner = getLocalScope()) {
  return owner === "legacy" ? name : `octopus:${owner}:${name}`;
}

export function getLocalScope(): LocalScope {
  if (!scope) throw new Error("本地数据空间尚未准备完成");
  return scope;
}

export function isLocalWorkspaceActive() {
  return (
    !switching &&
    !maintenance &&
    (!scope ||
      (!hasLease(scope) &&
        revision === (localStorage.getItem(revisionKey()) || "")))
  );
}

export function trackLocalWrite<T>(write: Promise<T>): Promise<T> {
  writes.add(write);
  void write.finally(() => writes.delete(write)).catch(() => {});
  return write;
}

export async function flushLocalWrites() {
  await Promise.all([...writes]);
}

export function persistLocalWrite(
  action: () => Promise<void>,
  enqueue?: (write: () => Promise<void>) => Promise<void>,
) {
  if (!scope || !isLocalWorkspaceActive()) return Promise.resolve();
  const owner = scope;
  const acceptedRevision = revision;
  const run = async () => {
    if (
      !switching &&
      (!maintenance || drainingMaintenanceWrites) &&
      scope === owner &&
      revision === acceptedRevision &&
      !hasLease(owner) &&
      acceptedRevision === (localStorage.getItem(revisionKey(owner)) || "")
    )
      await action();
  };
  const write = () =>
    navigator.locks
      ? navigator.locks.request(localKey("data-write-lock", owner), run)
      : run();
  return trackLocalWrite(enqueue ? enqueue(write) : write());
}

export async function beginLocalMaintenance() {
  if (!isLocalWorkspaceActive())
    throw new Error("本地数据正在处理中，请稍后重试");
  maintenance = true;
  // Drain only writes already accepted for this owner before taking the lock.
  drainingMaintenanceWrites = true;
  window.dispatchEvent(new Event("local-data-maintenance"));
  try {
    await Promise.allSettled([...writes]);
    drainingMaintenanceWrites = false;
    if (navigator.locks)
      await new Promise<void>((ready, reject) => {
        void navigator.locks
          .request(localKey("data-write-lock"), async () => {
            const held = new Promise<void>((resolve) => {
              releaseLock = resolve;
            });
            ready();
            await held;
          })
          .catch(reject);
      });
    if (scope && revision !== (localStorage.getItem(revisionKey()) || ""))
      throw new Error("其他页面已更新本地数据，请刷新后重试");
    leaseId = `${Date.now()}-${Math.random()}`;
    localStorage.setItem(
      leaseKey(),
      JSON.stringify({ id: leaseId, expires: Date.now() + 600000 }),
    );
    renewal = setInterval(() => {
      try {
        localStorage.setItem(
          leaseKey(),
          JSON.stringify({ id: leaseId, expires: Date.now() + 600000 }),
        );
      } catch {}
    }, 30000);
  } catch (error) {
    drainingMaintenanceWrites = false;
    maintenance = false;
    releaseLock?.();
    releaseLock = undefined;
    window.dispatchEvent(new Event("local-data-maintenance-end"));
    throw error;
  }
}

export function endLocalMaintenance(untilReload = false) {
  clearInterval(renewal);
  try {
    if (scope) {
      const nextRevision = `${Date.now()}-${Math.random()}`;
      localStorage.setItem(revisionKey(), nextRevision);
      revision = nextRevision;
    }
  } catch (error) {
    console.warn("[Local data] Could not notify other pages", error);
  } finally {
    try {
      if (
        scope &&
        JSON.parse(localStorage.getItem(leaseKey()) || "null")?.id === leaseId
      )
        localStorage.removeItem(leaseKey());
    } catch {}
    releaseLock?.();
    releaseLock = undefined;
    leaseId = undefined;
    maintenance = untilReload;
    if (!untilReload)
      window.dispatchEvent(new Event("local-data-maintenance-end"));
  }
}

/** Bind storage once per document, before any account-owned data is hydrated. */
export function initializeLocalWorkspace(): Promise<LocalScope> {
  if (typeof window === "undefined") return Promise.resolve("legacy");
  if (!initialization) {
    initialization = (async () => {
      const revision = tokenRevision;
      const data = await loadWorkspaceBootstrap();
      const bootstrapRevision = getWorkspaceBootstrapRevision();
      if (!data.config.newApiEnabled) {
        const owner = await bindScope("legacy");
        rememberWorkspaceBootstrap(data, bootstrapRevision);
        return owner;
      }
      const session = data.session;
      const id = session.user?.id;
      const identity = session.authenticated ? id : null;
      if (confirmedIdentity !== undefined && confirmedIdentity !== identity) {
        throw new Error("登录身份已变化，请刷新页面重新确认");
      }
      if (revision === tokenRevision)
        selectedTokenId = session.selectedTokenId ?? null;
      let owner: LocalScope = "guest";
      if (session.authenticated) {
        if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
          throw new Error("账号身份无效");
        }
        owner = `user-${id}`;
      }
      await bindScope(owner);
      if (!isWorkspaceBootstrapCurrent(data))
        throw new Error("登录身份已变化，请刷新页面重新确认");
      rememberWorkspaceBootstrap(data, bootstrapRevision);
      return owner;
    })();
  }
  return initialization;
}

export function confirmLocalIdentity(id: number | null) {
  discardWorkspaceSession();
  confirmedIdentity = id;
  if (!scope || scope === "legacy" || switching) return;
  const next: LocalScope = id === null ? "guest" : `user-${id}`;
  if (next === scope) return;
  // Never retarget an existing store: pending writes stay bound to its owner.
  switching = true;
  window.dispatchEvent(new Event("local-workspace-switch"));
  window.setTimeout(() => window.location.reload(), 100);
}

export function announceLocalDataChanged() {
  window.dispatchEvent(new Event("local-data-changed"));
}
