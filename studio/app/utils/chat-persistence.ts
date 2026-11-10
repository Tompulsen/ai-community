import { get } from "./studio-keyval";
import { nanoid } from "nanoid";
import { indexedDBStorage } from "./indexedDB-storage";

const FORMAT = "octopus-chat-assets-v1";
const MIN_ASSET_LENGTH = 64 * 1024;
const META = "__octopusChatAssets";
const REFERENCE = "__octopusChatAsset";
let knownAssets: { name: string; values: Map<string, string> } | undefined;

type ChatSnapshot = {
  state: Record<string, any>;
  version?: number;
};
type AssetMetadata = { format: typeof FORMAT; ids: string[] };
type ReadOptions = {
  deferInactiveSessions?: boolean;
  retryOnChange?: boolean;
};

function assetKey(name: string, id: string) {
  return `${name}:asset:${id}`;
}

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

function referenceId(value: any): string | undefined {
  return value &&
    typeof value === "object" &&
    Object.keys(value).length === 1 &&
    typeof value[REFERENCE] === "string"
    ? value[REFERENCE]
    : undefined;
}

function visitReferences(value: any, visit: (id: string) => void) {
  const id = referenceId(value);
  if (id !== undefined) {
    visit(id);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) visitReferences(child, visit);
  }
}

export function hasDeferredChatAssets(value: unknown): boolean {
  if (referenceId(value) !== undefined) return true;
  return (
    !!value &&
    typeof value === "object" &&
    Object.values(value).some(hasDeferredChatAssets)
  );
}

export function restoreChatAssets<T>(value: T, loaded: Map<string, string>): T {
  const id = referenceId(value);
  if (id !== undefined) return (loaded.get(id) ?? value) as T;
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const restored = value.map((child) => restoreChatAssets(child, loaded));
    return restored.every((child, index) => child === value[index])
      ? value
      : (restored as T);
  }
  const entries = Object.entries(value);
  const restored = entries.map(([key, child]) => [
    key,
    restoreChatAssets(child, loaded),
  ]);
  return restored.every(([, child], index) => child === entries[index][1])
    ? value
    : (Object.fromEntries(restored) as T);
}

async function loadAssets(name: string, ids: Iterable<string>) {
  const loaded = new Map<string, string>();
  await Promise.all(
    [...ids].map(async (id) => {
      const value = await get<unknown>(assetKey(name, id));
      if (typeof value !== "string")
        throw new Error(
          "Local chat attachment is missing; existing data was preserved.",
        );
      loaded.set(id, value);
    }),
  );
  return loaded;
}

export async function loadChatSessionAssets(name: string, session: unknown) {
  const ids = new Set<string>();
  visitReferences(session, (id) => ids.add(id));
  const loaded = await loadAssets(name, ids);
  if (knownAssets?.name !== name) knownAssets = { name, values: new Map() };
  for (const [id, value] of loaded) knownAssets.values.set(value, id);
  return loaded;
}

export async function readChatSnapshot(
  name: string,
  options: ReadOptions = {},
): Promise<ChatSnapshot | null> {
  if (knownAssets?.name !== name) knownAssets = undefined;
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
    options.deferInactiveSessions &&
    stored.version >= 3.5 &&
    Array.isArray(sessions);
  const selected = Number.isInteger(stored.state?.currentSessionIndex)
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
              index === selected ||
                (key !== "messages" && key !== "messageBranches"),
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
  knownAssets = {
    name,
    values: new Map([...loaded].map(([id, value]) => [value, id])),
  };
  return snapshot;
}

export async function writeChatSnapshot(name: string, snapshot: ChatSnapshot) {
  if (!snapshot.state?._hasHydrated) return;
  if (knownAssets?.name !== name) knownAssets = undefined;
  const known = knownAssets?.name === name ? knownAssets.values : undefined;
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
        id = known?.get(value);
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
  knownAssets = { name, values: current };
}

export async function removeChatSnapshot(name: string) {
  await indexedDBStorage.removeItemWithAssets(name, (raw) =>
    referencedAssets(name, raw),
  );
  if (knownAssets?.name === name) knownAssets = undefined;
}
