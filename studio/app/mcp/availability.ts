import { isMcpEnabled } from "./actions";

const STATUS_TTL_MS = 5000;
let cached: { enabled: boolean; expiresAt: number } | undefined;
let pending: Promise<boolean> | undefined;
let revision = 0;

function invalidate() {
  revision++;
  cached = undefined;
  pending = undefined;
}

if (typeof window !== "undefined") {
  window.addEventListener("new-api-session-changed", invalidate);
  window.addEventListener("local-workspace-switch", invalidate);
}

export async function isMcpAvailable() {
  // Permission checks on the server must remain bound to their own request.
  if (typeof window === "undefined") {
    try {
      return await isMcpEnabled();
    } catch {
      return false;
    }
  }
  if (cached && cached.expiresAt > Date.now()) return cached.enabled;
  if (pending) return pending;
  const startedAtRevision = revision;
  const request: Promise<boolean> = Promise.resolve()
    .then(() => isMcpEnabled())
    .then((enabled) => {
      if (startedAtRevision !== revision) return false;
      cached = { enabled, expiresAt: Date.now() + STATUS_TTL_MS };
      return enabled;
    })
    .catch(() => false)
    .finally(() => {
      if (pending === request) pending = undefined;
    });
  pending = request;
  return request;
}
