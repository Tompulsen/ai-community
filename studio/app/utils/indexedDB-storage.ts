import { StateStorage } from "zustand/middleware";
import { get, set, del, clear } from "./studio-keyval";
import { studioStore } from "./studio-keyval";
import { safeLocalStorage } from "@/app/utils";
import { createLatestWriteQueue } from "./latest-write-queue";

const localStorage = safeLocalStorage();
const fallbackKey = (name: string) => `${name}:local-storage-fallback`;
type AssetReferences = (raw: string | undefined) => IDBValidKey[];

function saveFallback(name: string, value: string) {
  localStorage.setItem(name, value);
  localStorage.setItem(fallbackKey(name), `${Date.now()}-${Math.random()}`);
}

class IndexedDBStorage implements StateStorage {
  private writes = new Map<
    string,
    ReturnType<
      typeof createLatestWriteQueue<{
        value: string;
        assets?: [IDBValidKey, unknown][];
        references?: AssetReferences;
        retainedAssets?: IDBValidKey[];
      }>
    >
  >();

  public async getItem(name: string): Promise<string | null> {
    let fallback: string | null = null;
    try {
      fallback = localStorage.getItem(name);
      // Unmarked legacy copies can predate a later successful IndexedDB write.
      if (fallback !== null && localStorage.getItem(fallbackKey(name)))
        return fallback;
    } catch {}
    try {
      return (await get<string>(name)) ?? fallback;
    } catch {
      return localStorage.getItem(name);
    }
  }

  public async setItem(name: string, value: string): Promise<void> {
    return this.saveItem(name, value);
  }

  public async setItemWithAssets(
    name: string,
    value: string,
    assets: [IDBValidKey, unknown][],
    references: AssetReferences,
    retainedAssets: IDBValidKey[] = [],
  ): Promise<void> {
    return this.saveItem(name, value, assets, references, retainedAssets);
  }

  private async saveItem(
    name: string,
    value: string,
    assets?: [IDBValidKey, unknown][],
    references?: AssetReferences,
    retainedAssets?: IDBValidKey[],
  ): Promise<void> {
    try {
      const _value = JSON.parse(value);
      if (!_value?.state?._hasHydrated) {
        console.warn("skip setItem", name);
        return;
      }
    } catch {
      saveFallback(name, value);
      return;
    }
    let save = this.writes.get(name);
    if (!save) {
      // Keep fallback cleanup in the same order as writes for this store.
      save = createLatestWriteQueue(async (snapshot) => {
        try {
          const previousFallback = localStorage.getItem(name);
          const previousMarker = localStorage.getItem(fallbackKey(name));
          if (snapshot.assets) {
            await this.mutateItemWithAssets(
              name,
              snapshot.value,
              snapshot.assets,
              snapshot.references!,
              snapshot.retainedAssets,
            );
          } else {
            await set(name, snapshot.value);
          }
          if (
            localStorage.getItem(name) === previousFallback &&
            localStorage.getItem(fallbackKey(name)) === previousMarker
          ) {
            localStorage.removeItem(name);
            localStorage.removeItem(fallbackKey(name));
          }
        } catch (error) {
          if (snapshot.assets) throw error;
          saveFallback(name, snapshot.value);
        }
      });
      this.writes.set(name, save);
    }
    return save({ value, assets, references, retainedAssets });
  }

  public async removeItem(name: string): Promise<void> {
    localStorage.removeItem(name);
    localStorage.removeItem(fallbackKey(name));
    try {
      await del(name);
    } catch {
      localStorage.removeItem(name);
    }
  }

  public async removeItemWithAssets(
    name: string,
    references: AssetReferences,
  ): Promise<void> {
    await this.mutateItemWithAssets(name, undefined, [], references);
    localStorage.removeItem(name);
    localStorage.removeItem(fallbackKey(name));
  }

  private async mutateItemWithAssets(
    name: string,
    value: string | undefined,
    assets: [IDBValidKey, unknown][],
    references: AssetReferences,
    retainedAssets: IDBValidKey[] = [],
  ): Promise<void> {
    // Chat records and attachments must share the same isolated transaction.
    return studioStore(
      "readwrite",
      (store) =>
        new Promise<void>((resolve, reject) => {
          const transaction = store.transaction;
          transaction.oncomplete = () => resolve();
          transaction.onerror = transaction.onabort = () =>
            reject(transaction.error || new Error("Chat transaction aborted."));
          const previous = store.get(name);
          previous.onsuccess = () => {
            try {
              const retained = new Set([
                ...assets.map(([key]) => key),
                ...retainedAssets,
              ]);
              for (const key of references(previous.result))
                if (!retained.has(key)) store.delete(key);
              for (const [key, payload] of assets) {
                const existing = store.getKey(key);
                existing.onsuccess = () => {
                  try {
                    if (existing.result === undefined) store.put(payload, key);
                  } catch (error) {
                    transaction.abort();
                    reject(error);
                  }
                };
              }
              // Deferred payloads must already exist; never replace them with undefined.
              for (const key of retainedAssets) {
                const existing = store.getKey(key);
                existing.onsuccess = () => {
                  if (existing.result === undefined) {
                    transaction.abort();
                    reject(
                      new Error(
                        "Local chat attachment is missing; existing data was preserved.",
                      ),
                    );
                  }
                };
              }
              if (value === undefined) store.delete(name);
              else store.put(value, name);
            } catch (error) {
              transaction.abort();
              reject(error);
            }
          };
        }),
    );
  }

  public async clear(): Promise<void> {
    try {
      await clear();
    } catch {
      localStorage.clear();
    }
  }
}

export const indexedDBStorage = new IndexedDBStorage();
