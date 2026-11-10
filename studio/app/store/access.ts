import { StoreKey, ApiPath, OPENAI_BASE_URL } from "../constant";
import { getHeaders } from "../client/api";
import {
  isAccountModelMode,
  DEFAULT_CUSTOM_PROVIDER,
  readCustomProvider,
} from "../utils/custom-provider";
import {
  getLocalTokenId,
  initializeLocalWorkspace,
} from "../utils/local-workspace";
import { getClientConfig } from "../config/client";
import { consumeWorkspaceConfig } from "../utils/workspace-bootstrap";
import { createPersistStore } from "../utils/store";
import { ensure } from "../utils/clone";
import { DEFAULT_CONFIG, useAppConfig } from "./config";
import { getModelProvider } from "../utils/model";
import { LLMModel } from "../client/api";
import {
  getExpectedNewApiUserId,
  invalidateNewApiModelSource,
  newApiClient,
  setNewApiExpectedUser,
  type NewApiSelection,
} from "../client/new-api";

let fetchState = 0; // 0 not fetch, 1 fetching, 2 done
let fetchEpoch = 0;
let fetchPromise: Promise<void> | undefined;
type ModelScope = { userId: number; tokenId: number };
const modelSnapshots = new Map<string, { models: LLMModel[]; at: number }>();
let activeModelScope: ModelScope | undefined;
const MODEL_TTL = 60_000;

function modelScopeKey(scope: ModelScope) {
  return JSON.stringify(["/studio/api/remote-models", scope.userId, scope.tokenId]);
}

function rememberModels(scope: ModelScope, models: LLMModel[]) {
  const key = modelScopeKey(scope);
  modelSnapshots.delete(key);
  modelSnapshots.set(key, { models, at: Date.now() });
  if (modelSnapshots.size > 20)
    modelSnapshots.delete(modelSnapshots.keys().next().value!);
}

function replaceModels(models: LLMModel[]) {
  useAppConfig.getState().clearModels();
  useAppConfig.getState().mergeModels(models);
}

type HydrationStore = {
  getState: () => { _hasHydrated?: boolean };
  subscribe: (listener: () => void) => () => void;
  persist?: unknown;
};

function waitForHydration(store: HydrationStore) {
  if (!store.persist || store.getState()._hasHydrated) {
    return Promise.resolve();
  }
  // This flag also settles when the existing persistence layer reports an error.
  return new Promise<void>((resolve) => {
    const check = () => {
      if (!store.getState()._hasHydrated) return;
      unsubscribe();
      resolve();
    };
    const unsubscribe = store.subscribe(check);
    check();
  });
}

/** 重置 fetch 状态，允许重新获取配置和模型 */
export function resetFetchState() {
  fetchEpoch++;
  fetchState = 0;
  fetchPromise = undefined;
}

/** 重新获取配置和模型列表（密码验证后调用） */
export function refetchModels() {
  resetFetchState();
  modelSnapshots.clear();
  activeModelScope = undefined;
  invalidateNewApiModelSource();
  if (isAccountModelMode(useAccessStore.getState())) {
    useAccessStore.setState({ modelListStatus: "loading" });
    setNewApiExpectedUser(null);
    useAppConfig.getState().clearModels();
  }
  return useAccessStore.getState().fetch();
}

/** Selection is already confirmed by the server; reuse only that exact key. */
export function refreshSelectedNewApiModels(selection: NewApiSelection) {
  if (
    !isAccountModelMode(useAccessStore.getState()) ||
    getExpectedNewApiUserId() !== selection.userId ||
    getLocalTokenId() !== selection.tokenId
  )
    return refetchModels();
  // Multiple consumers may observe the same confirmed selection.
  if (
    activeModelScope?.userId === selection.userId &&
    activeModelScope.tokenId === selection.tokenId &&
    fetchState > 0
  )
    return fetchState === 1
      ? fetchPromise || Promise.resolve()
      : refreshNewApiModels();
  resetFetchState();
  activeModelScope = { userId: selection.userId, tokenId: selection.tokenId };
  const cached = modelSnapshots.get(modelScopeKey(activeModelScope));
  replaceModels(cached?.models ?? []);
  useAccessStore.setState({
    modelListStatus: cached ? "ready" : "loading",
    modelRefreshError: false,
  });
  fetchState = 2;
  return refreshNewApiModels();
}

function remoteModels(json: any): LLMModel[] {
  if (!Array.isArray(json.data)) throw new Error("Invalid model list");
  return json.data
    .filter((m: any) => typeof m?.id === "string" && m.id)
    .map((m: any) => ({
      name: m.id,
      displayName: m.id,
      available: true,
      sorted: 0,
      provider: {
        id: m.id,
        providerName: m.id.split("-")[0] || "openai",
        providerType: "openai",
        sorted: 0,
      },
      type: "text",
    }));
}

/** Revalidate the selected key after returning from the New API dashboard. */
export function refreshNewApiModels(force = false) {
  const access = useAccessStore.getState();
  if (!isAccountModelMode(access)) {
    if (!access.newApiEnabled) return Promise.resolve();
    if (fetchState === 1) return fetchPromise || Promise.resolve();
    return newApiClient.session().then(() => undefined);
  }
  if (fetchState !== 2) return useAccessStore.getState().fetch();
  const scope = activeModelScope;
  const cached = scope && modelSnapshots.get(modelScopeKey(scope));
  if (!force && cached && Date.now() - cached.at < MODEL_TTL)
    return Promise.resolve();
  resetFetchState();
  const epoch = fetchEpoch;
  fetchState = 1;
  useAccessStore.setState({
    modelListStatus: cached ? "ready" : "loading",
    modelRefreshError: false,
  });
  fetchPromise = (async () => {
    try {
      const response = await fetch("/studio/api/remote-models", {
        headers: { ...getHeaders() },
        cache: "no-store",
      });
      if (epoch !== fetchEpoch) return;
      if ([401, 403, 409].includes(response.status)) {
        await refetchModels();
        return;
      }
      if (!response.ok) throw new Error("Model request failed");
      const models = remoteModels(await response.json());
      if (epoch !== fetchEpoch) return;
      if (scope) rememberModels(scope, models);
      replaceModels(models);
      useAccessStore.setState({ modelListStatus: "ready" });
    } catch {
      if (epoch !== fetchEpoch) return;
      fetchState = 2;
      if (!cached) useAppConfig.getState().clearModels();
      useAccessStore.setState({
        modelListStatus: cached ? "ready" : "error",
        modelRefreshError: true,
      });
    } finally {
      if (epoch === fetchEpoch && fetchState !== 0) fetchState = 2;
    }
  })();
  return fetchPromise;
}

const isApp = getClientConfig()?.buildMode === "export";

const DEFAULT_OPENAI_URL = isApp ? OPENAI_BASE_URL : ApiPath.V1;

const DEFAULT_ACCESS_STATE = {
  ...DEFAULT_CUSTOM_PROVIDER,
  switchingToken: false,
  modelListStatus: "idle" as "idle" | "loading" | "ready" | "error",
  modelRefreshError: false,

  // openai
  openaiUrl: DEFAULT_OPENAI_URL,
  openaiApiKey: "",

  // server config（CODE 系统已移除，仅保留 ACCESS_PASSWORD 服务端认证）
  needCode: false,
  hideUserApiKey: false,
  hideBalanceQuery: false,
  disableGPT4: false,
  disableFastLink: false,
  customModels: "",
  defaultModel: "",
  visionModels: "",
  hasModelApiKey: false,
  hasModelsApiUrl: false,
  modelsApiUrl: "",
  newApiEnabled: false,
};

export const useAccessStore = createPersistStore(
  { ...DEFAULT_ACCESS_STATE },

  (set, get) => ({
    enabledAccessControl() {
      this.fetch();

      return get().needCode;
    },
    getVisionModels() {
      this.fetch();
      return get().visionModels;
    },

    isValidOpenAI() {
      return ensure(get(), ["openaiApiKey"]);
    },

    isAuthorized() {
      this.fetch();

      // 有 OpenAI API Key 或无需服务端认证
      return this.isValidOpenAI() || !this.enabledAccessControl();
    },
    fetch() {
      if (getClientConfig()?.buildMode === "export") return Promise.resolve();
      if (fetchState > 0) return fetchPromise || Promise.resolve();
      fetchState = 1;
      set({ modelListStatus: "loading", modelRefreshError: false });
      activeModelScope = undefined;
      const epoch = fetchEpoch;
      const isCurrent = () => epoch === fetchEpoch;
      fetchPromise = (async () => {
        await Promise.all([
          waitForHydration(useAccessStore),
          waitForHydration(useAppConfig),
        ]);
        if (typeof window !== "undefined") {
          await initializeLocalWorkspace();
          if (!isCurrent()) return;
          const previous = get();
          const profile = readCustomProvider({
            useCustomConfig: previous.useCustomConfig,
            customConfigName: previous.customConfigName,
            customApiMode: previous.customApiMode,
            customModelNames:
              previous.customModelNames ||
              useAppConfig.getState().customModels ||
              "",
            openaiUrl: previous.openaiUrl,
            openaiApiKey: previous.openaiApiKey,
          });
          set(() => ({
            ...profile,
            openaiUrl: profile.openaiUrl || DEFAULT_OPENAI_URL,
          }));
        }
        if (!isCurrent()) return;
        if (isAccountModelMode(get())) {
          useAppConfig.getState().clearModels();
          setNewApiExpectedUser(null);
        }
        let res = consumeWorkspaceConfig();
        if (!res) {
          const response = await fetch("/studio/api/config", {
            method: "post",
            body: null,
          });
          if (!response.ok) throw new Error("Config request failed");
          res = (await response.json()) as DangerConfig;
        }
        if (!isCurrent()) return;

        set(() => ({ ...res }));
        const accountMode = isAccountModelMode(get());
        if (accountMode || get().useCustomConfig)
          useAppConfig.getState().clearModels();
        if (get().newApiEnabled) {
          // Bind this tab to the current account before it can send model calls.
          if (accountMode) useAppConfig.getState().clearModels();
          setNewApiExpectedUser(null);
          const session = await newApiClient.session();
          if (!isCurrent()) return;
          setNewApiExpectedUser(
            session.authenticated ? session.user?.id ?? null : null,
          );
          if (
            accountMode &&
            (!session.authenticated || !session.selectedTokenId)
          ) {
            set({ modelListStatus: "ready" });
            return;
          }
          if (accountMode && session.user && session.selectedTokenId) {
            activeModelScope = {
              userId: session.user.id,
              tokenId: session.selectedTokenId,
            };
            // Prepare the selector before the user opens it.
            void newApiClient
              .modelGroups(session.user.id)
              .then(() => {
                if (isCurrent() && typeof window !== "undefined")
                  window.dispatchEvent(new Event("new-api-model-source-ready"));
              })
              .catch(() => {});
          }
        }

        if (isCurrent()) {
          const defaultModel = res.defaultModel ?? "";
          if (defaultModel !== "") {
            const [model, providerName] = getModelProvider(defaultModel);
            DEFAULT_CONFIG.modelConfig.model = model;
            DEFAULT_CONFIG.modelConfig.providerName = providerName as any;
          }
        }

        if (
          get().useCustomConfig ||
          res.newApiEnabled ||
          res.hasModelsApiUrl ||
          res.hasModelApiKey
        ) {
          const remote = await fetch("/studio/api/remote-models", {
            method: "GET",
            headers: { ...getHeaders() },
            cache: "no-store",
          });
          if (!remote.ok) throw new Error("Model request failed");
          const json = await remote.json();
          if (!isCurrent()) return;
          const models = remoteModels(json);
          if (accountMode && activeModelScope)
            rememberModels(activeModelScope, models);
          if (accountMode && models.length === 0) {
            useAppConfig.getState().clearModels();
          } else {
            useAppConfig.getState().mergeModels(models);
          }
        }
        if (isCurrent()) set({ modelListStatus: "ready" });
      })()
        .catch(() => {
          if (!isCurrent()) return;
          // Render-time authorization checks must not restart a failed fetch.
          // Explicit retry and focus revalidation reset this completed attempt.
          fetchState = 2;
          console.error("[Config] failed to fetch config");
          if (get().newApiEnabled) useAppConfig.getState().clearModels();
          set({ modelListStatus: "error" });
        })
        .finally(() => {
          if (isCurrent() && fetchState !== 0) fetchState = 2;
        });
      return fetchPromise;
    },
  }),
  {
    name: StoreKey.Access,
    version: 2,
    partialize: (state) => ({
      ...state,
      ...DEFAULT_CUSTOM_PROVIDER,
      openaiUrl: DEFAULT_OPENAI_URL,
      switchingToken: false,
      modelListStatus: "idle" as const,
      modelRefreshError: false,
    }),
  },
);
