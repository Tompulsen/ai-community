import { chatAssetKey as assetKey, chatAssetReference as referenceId, loadChatAssets as loadAssets, restoreChatAssets, knownChatAsset, rememberChatAssets, forgetChatAssets } from "./chat-assets.ts";
export { hasDeferredChatAssets, restoreChatAssets, loadChatSessionAssets } from "./chat-assets.ts";
import { nanoid } from "nanoid";
import { indexedDBStorage } from "./indexedDB-storage.ts";

const FORMAT = "octopus-chat-assets-v1";
const MIN_ASSET_LENGTH = 64 * 1024;
const META = "__octopusChatAssets";
const REFERENCE = "__octopusChatAsset";


type ChatSnapshot = {
  state: Record<string, any>;
  version?: number;
};
type AssetMetadata = { format: typeof FORMAT; ids: string[] };
type ReadOptions = {
  deferInactiveSessions?: boolean;
  deferAllSessionAssets?: boolean;
  retryOnChange?: boolean;
};

function metadata(value: any): AssetMetadata | undefined {
  const stored = value?.[META];
  if (
    stored?.format === FORMAT &&
    Array.isArray(stored.ids) &&
    stored.ids.every((id: unknown) => typeof id === "string")
  )
    return stored;
}

function referencedAssets(name: string, raw: string | undefined) {
  const assets = raw ? metadata(JSON.parse(raw)) : undefined;
  return (assets?.ids || []).map((id) => assetKey(name, id));
}

function isPayload(value: string, key: string, parent: any) {
  return (
    value.length >= MIN_ASSET_LENGTH &&
    (value.startsWith("data:") ||
      /^!\[(?:Generated Image|生成预览)\]\(data:/.test(value.slice(0, 80)) ||
      (key === "data" && typeof parent?.format === "string"))
  );
}

export async function readChatSnapshot(
  name: string,
  options: ReadOptions = {},
): Promise<ChatSnapshot | null> {

  const raw = await indexedDBStorage.getItem(name);
  if (!raw) return null;
  const stored = JSON.parse(raw);
  const assets = metadata(stored);
  if (stored && Object.prototype.hasOwnProperty.call(stored, META) && !assets)
    throw new Error("Unsupported local chat attachment format.");
  if (!assets) return stored;
  const allowed = new Set(assets.ids);
  const sessions = stored.state?.sessions;
  const defer =
    (options.deferInactiveSessions || options.deferAllSessionAssets) &&
    Array.isArray(sessions);
  const selected = typeof stored.state?.activeId === "string"
    ? sessions?.findIndex((session: { id?: string }) => session.id === stored.state.activeId) ?? -1
    : Number.isInteger(stored.state?.currentSessionIndex)
    ? Math.min(
        Math.max(0, stored.state.currentSessionIndex),
        sessions?.length - 1,
      )
    : 0;
  const requested = defer ? new Set<string>() : new Set(allowed);
  const collect = (value: any, needed = true) => {
    const id = referenceId(value);
    if (id !== undefined) {
      if (!allowed.has(id))
        throw new Error("Invalid local chat attachment reference.");
      if (needed) requested.add(id);
    } else if (value && typeof value === "object") {
      if (defer && value === sessions) {
        sessions.forEach((session: Record<string, unknown>, index: number) => {
          for (const [key, child] of Object.entries(session))
            collect(
              child,
              !options.deferAllSessionAssets && (index === selected ||
                (key !== "messages" && key !== "messageBranches")),
            );
        });
      } else {
        for (const child of Object.values(value)) collect(child, needed);
      }
    }
  };
  collect(stored);
  let loaded: Map<string, string>;
  try {
    loaded = await loadAssets(name, requested);
  } catch (error) {
    // Another tab may have replaced the snapshot and retired its old payloads.
    if (
      options.retryOnChange !== false &&
      (await indexedDBStorage.getItem(name)) !== raw
    )
      return readChatSnapshot(name, { ...options, retryOnChange: false });
    throw error;
  }
  const snapshot = restoreChatAssets(stored, loaded);
  delete snapshot[META];
  rememberChatAssets(name, loaded);
  return snapshot;
}

export async function writeChatSnapshot(name: string, snapshot: ChatSnapshot, undo?: unknown) {
  if (!snapshot.state?._hasHydrated) return;


  const current = new Map<string, string>();
  const retained = new Set<string>();
  const encode = (value: any, key = "", parent?: any): any => {
    const reference = referenceId(value);
    if (reference !== undefined) {
      retained.add(reference);
      return { [REFERENCE]: reference };
    }
    if (typeof value === "string" && isPayload(value, key, parent)) {
      let id = current.get(value);
      if (!id) {
        id = knownChatAsset(name, value);
        id ??= nanoid();
        current.set(value, id);
      }
      return { [REFERENCE]: id };
    }
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value))
      return value.map((child) => encode(child, key, value));
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        encode(child, key, value),
      ]),
    );
  };
  const encodedSnapshot = encode(snapshot);
  // A short-lived undo window must retain unread payloads without loading them.
  if (undo) encode(undo);
  const payloadIds = new Set(current.values());
  const encoded = {
    ...encodedSnapshot,
    [META]: {
      format: FORMAT,
      ids: [...new Set([...current.values(), ...retained])],
    },
  };
  await indexedDBStorage.setItemWithAssets(
    name,
    JSON.stringify(encoded),
    [...current].map(([value, id]) => [assetKey(name, id), value]),
    (raw) => referencedAssets(name, raw),
    [...retained]
      .filter((id) => !payloadIds.has(id))
      .map((id) => assetKey(name, id)),
  );
  rememberChatAssets(name, new Map([...current].map(([value, id]) => [id, value])));
}

export async function removeChatSnapshot(name: string) {
  await indexedDBStorage.removeItemWithAssets(name, (raw) =>
    referencedAssets(name, raw),
  );
  forgetChatAssets(name);
}
