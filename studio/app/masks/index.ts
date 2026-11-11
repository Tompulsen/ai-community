import { useEffect, useSyncExternalStore } from "react";
import type { Mask } from "../store/mask";

import { type BuiltinMask } from "./typing";
export { type BuiltinMask } from "./typing";

export const BUILTIN_MASK_ID = 100000;
const listeners = new Set<() => void>();
let loaded = false;
let loading: Promise<void> | undefined;

export const BUILTIN_MASK_STORE = {
  buildinId: BUILTIN_MASK_ID,
  masks: {} as Record<string, BuiltinMask>,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => loaded,
  getServerSnapshot: () => false,
  get(id?: string) {
    if (!id) return undefined;
    return this.masks[id] as Mask | undefined;
  },
  add(m: BuiltinMask) {
    const mask = { ...m, id: this.buildinId++, builtin: true };
    this.masks[mask.id] = mask;
    return mask;
  },
};

export const BUILTIN_MASKS: BuiltinMask[] = [];

export function useBuiltinMasksLoaded() {
  useEffect(() => {
    void loadBuiltinMasks();
  }, []);

  return useSyncExternalStore(
    BUILTIN_MASK_STORE.subscribe,
    BUILTIN_MASK_STORE.getSnapshot,
    BUILTIN_MASK_STORE.getServerSnapshot,
  );
}

export function loadBuiltinMasks(): Promise<void> {
  if (typeof window === "undefined" || loaded) return Promise.resolve();
  if (!loading) {
    loading = fetch("/masks.json")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load builtin masks");
        return response.json();
      })
      .then(({ cn = [], en = [] }) => {
        if (!Array.isArray(cn) || !Array.isArray(en)) {
          throw new Error("Invalid builtin mask library");
        }
        const masks = [...cn, ...en];
        if (
          masks.some(
            (mask) => !mask || typeof mask !== "object" || Array.isArray(mask),
          )
        ) {
          throw new Error("Invalid builtin mask library");
        }
        masks.forEach((mask) => {
          BUILTIN_MASKS.push(BUILTIN_MASK_STORE.add(mask));
        });
        loaded = true;
        listeners.forEach((listener) => listener());
      })
      .catch((error) => console.error("[Fetch] failed to fetch masks", error))
      .finally(() => {
        loading = undefined;
      });
  }
  return loading;
}
