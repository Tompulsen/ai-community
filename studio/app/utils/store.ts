import { create } from "zustand";
import { combine, persist, createJSONStorage } from "zustand/middleware";
import { Updater } from "../typing";
import { deepClone } from "./clone";
import { indexedDBStorage } from "@/app/utils/indexedDB-storage";
import {
  initializeLocalWorkspace,
  localKey,
  isLocalWorkspaceActive,
  persistLocalWrite,
} from "./local-workspace";
import { StoreKey } from "../constant";
import {
  createDeferredWriteQueue,
  createLatestWriteQueue,
} from "./latest-write-queue";
import {
  readChatSnapshot,
  removeChatSnapshot,
  writeChatSnapshot,
} from "./chat-persistence";
import { restoreInterruptedToolCalls } from "./tool-result";

type SecondParam<T> = T extends (
  _f: infer _F,
  _s: infer S,
  ...args: infer _U
) => any
  ? S
  : never;

type MakeUpdater<T> = {
  lastUpdateTime: number;
  _hasHydrated: boolean;

  markUpdate: () => void;
  update: Updater<T>;
  setHasHydrated: (state: boolean) => void;
};

type SetStoreState<T> = (
  partial: T | Partial<T> | ((state: T) => T | Partial<T>),
  replace?: boolean | undefined,
) => void;

export function createPersistStore<T extends object, M>(
  state: T,
  methods: (
    set: SetStoreState<T & MakeUpdater<T>>,
    get: () => T & MakeUpdater<T>,
  ) => M,
  persistOptions: SecondParam<typeof persist<T & M & MakeUpdater<T>>>,
) {
  const scoped =
    persistOptions.name === StoreKey.Chat ||
    persistOptions.name === StoreKey.Skills ||
    persistOptions.name === StoreKey.ModelPreferences;
  const chat = persistOptions.name === StoreKey.Chat;
  let chatErrorReported = false;
  const reportChatError = (error: unknown) => {
    console.error("[ChatStorage] Existing local data was preserved:", error);
    if (chatErrorReported) return;
    chatErrorReported = true;
    void import("../components/ui-lib")
      .then(({ showToast }) =>
        showToast(
          "本地聊天读写失败，原数据已保留。请重试并检查浏览器存储空间。",
        ),
      )
      .catch(() => {});
  };
  const saveChatObject = createDeferredWriteQueue(
    (write: () => Promise<void>) => write(),
    250,
  );
  if (chat && typeof window !== "undefined") {
    const flush = () => {
      void saveChatObject.flush().catch(reportChatError);
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) flush();
    });
  }
  let latestChatWrite = 0;
  const saveChat = createLatestWriteQueue((write: () => Promise<void>) =>
    write(),
  );
  persistOptions.storage = chat
    ? {
        async getItem(name) {
          const owner = await initializeLocalWorkspace();
          const stored = await readChatSnapshot(localKey(name, owner), {
            deferInactiveSessions: true,
          });
          if (
            !isLocalWorkspaceActive() ||
            (await initializeLocalWorkspace()) !== owner
          )
            throw new Error("Local account changed while loading chats.");
          for (const session of stored?.state?.sessions || []) {
            const messages = [
              ...(session.messages || []),
              ...(session.messageBranches || []),
            ];
            restoreInterruptedToolCalls(messages);
            for (const message of messages) {
              if (message.streaming) {
                message.streaming = false;
                message.interrupted = true;
              }
            }
          }
          return stored as any;
        },
        setItem(name, value) {
          if (!isLocalWorkspaceActive() || !value.state._hasHydrated) return;
          const owner = initializeLocalWorkspace();
          const hasStream = (value.state as Record<string, any>).sessions?.some(
            (session: any) =>
              session.messages?.some((message: any) => message.streaming),
          );
          const operation = persistLocalWrite(
            async () => {
              const acceptedOwner = await owner;
              if ((await initializeLocalWorkspace()) !== acceptedOwner) return;
              await writeChatSnapshot(localKey(name, acceptedOwner), value);
              chatErrorReported = false;
            },
            (write) =>
              saveChatObject(
                write,
                !hasStream ||
                  (typeof document !== "undefined" && document.hidden),
              ),
          );
          void operation.catch(reportChatError);
          return operation;
        },
        async removeItem(name) {
          const owner = await initializeLocalWorkspace();
          await saveChatObject.flush();
          await removeChatSnapshot(localKey(name, owner));
        },
      }
    : createJSONStorage(() =>
        scoped
          ? {
              async getItem(name: string) {
                const owner = await initializeLocalWorkspace();
                const raw = await indexedDBStorage.getItem(
                  localKey(name, owner),
                );
                if (!raw) return raw;
                const stored = JSON.parse(raw);
                for (const session of stored.state?.sessions || []) {
                  const messages = [
                    ...(session.messages || []),
                    ...(session.messageBranches || []),
                  ];
                  restoreInterruptedToolCalls(messages);
                  for (const message of messages) {
                    if (message.streaming) {
                      message.streaming = false;
                      message.interrupted = true;
                    }
                  }
                }
                return JSON.stringify(stored);
              },
              async setItem(name: string, value: string) {
                if (!isLocalWorkspaceActive()) return;
                const write = ++latestChatWrite;
                // A failed identity check must not save into the legacy/guest store.
                const owner = initializeLocalWorkspace().catch(() => null);
                return persistLocalWrite(async () => {
                  const acceptedOwner = await owner;
                  if (
                    acceptedOwner === null ||
                    (await initializeLocalWorkspace()) !== acceptedOwner ||
                    write !== latestChatWrite
                  )
                    return;
                  await indexedDBStorage.setItem(
                    localKey(name, acceptedOwner),
                    value,
                  );
                }, saveChat);
              },
              async removeItem(name: string) {
                const owner = await initializeLocalWorkspace();
                return indexedDBStorage.removeItem(localKey(name, owner));
              },
            }
          : indexedDBStorage,
      );
  const oldOonRehydrateStorage = persistOptions?.onRehydrateStorage;
  persistOptions.onRehydrateStorage = (state) => {
    const afterRehydrate = oldOonRehydrateStorage?.(state);
    return (rehydrated, error) => {
      afterRehydrate?.(rehydrated, error);
      if (
        error &&
        (chat || persistOptions.name === StoreKey.ModelPreferences)
      ) {
        if (chat) reportChatError(error);
        return;
      }
      state.setHasHydrated(true);
    };
  };

  return create(
    persist(
      combine(
        {
          ...state,
          lastUpdateTime: 0,
          _hasHydrated: false,
        },
        (set, get) => {
          return {
            ...methods((partial, replace) => {
              if (!scoped || isLocalWorkspaceActive())
                set(partial as any, replace);
            }, get as any),

            markUpdate() {
              set({ lastUpdateTime: Date.now() } as Partial<
                T & M & MakeUpdater<T>
              >);
            },
            update(updater) {
              const state = deepClone(get());
              updater(state);
              set({
                ...state,
                lastUpdateTime: Date.now(),
              });
            },
            setHasHydrated: (state: boolean) => {
              set({ _hasHydrated: state } as Partial<T & M & MakeUpdater<T>>);
            },
          } as M & MakeUpdater<T>;
        },
      ),
      persistOptions as any,
    ),
  );
}
