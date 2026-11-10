import type { LLMModel } from "../client/api";
import { DEFAULT_INPUT_TEMPLATE } from "../constant";
import { useChatStore } from "../store/chat";
import type { ChatSession } from "../store/chat";
import { getModelCapabilities } from "./model-capabilities";
import { CUSTOM_MODEL_PROVIDER } from "./custom-provider";
import { getLocalScope, isLocalWorkspaceActive } from "./local-workspace";

export type CommunityEntry = {
  id: string;
  kind: "text" | "image" | "video";
  model: string;
  defaultModels?: Partial<Record<"text" | "image" | "video", string>>;
};
type CommunityModel = Pick<LLMModel, "name" | "available"> &
  Partial<Pick<LLMModel, "provider">> & { isDefault?: boolean };
const titles = { text: "文本", image: "图片", video: "视频" };
const preparing = new Map<string, Promise<ChatSession>>();

/** Missing provenance keeps a usable model from the matching creation workspace. */
export function resolveCommunityRemixModel(
  entry: Pick<CommunityEntry, "kind" | "model">,
  models: CommunityModel[],
) {
  const available = models.filter(
    (model) =>
      model.available && model.provider?.providerName !== CUSTOM_MODEL_PROVIDER,
  );
  if (entry.model.trim()) {
    const model = available.find((item) => item.name === entry.model);
    return {
      model: entry.model,
      providerName: model?.provider?.providerName || "OpenAI",
    };
  }
  const candidates = available.filter((model) => {
    const category = getModelCapabilities(
      model.name,
      model.provider?.providerName,
    ).category;
    return entry.kind === "text"
      ? category === "chat" || category === "code"
      : category === entry.kind;
  });
  const current = findCommunityWorkspace(entry.kind)?.mask.modelConfig;
  const selected =
    candidates.find(
      (model) =>
        model.name === current?.model &&
        model.provider?.providerName === current.providerName,
    ) ??
    candidates.find((model) => model.isDefault) ??
    candidates[0];
  return {
    model: selected?.name ?? "",
    providerName: selected?.provider?.providerName || "OpenAI",
  };
}

export function findCommunityWorkspace(kind: CommunityEntry["kind"]) {
  const store = useChatStore.getState();
  const sessions = store.sessions;
  const matches = (session: ChatSession) => {
    if (
      session.communityWorkspaceKind ||
      session.creationKind ||
      session.mask.modelConfig.providerName === CUSTOM_MODEL_PROVIDER
    )
      return false;
    const category = getModelCapabilities(
      session.mask.modelConfig.model,
      session.mask.modelConfig.providerName,
    ).category;
    return kind === "text"
      ? category === "chat" || category === "code"
      : category === kind;
  };
  return (
    sessions.find((session) => session.communityWorkspaceKind === kind) ??
    sessions.find(
      (session) =>
        !session.communityWorkspaceKind &&
        session.creationKind === kind &&
        session.messages.length > 0,
    ) ??
    sessions.find(
      (session) =>
        !session.communityWorkspaceKind && session.creationKind === kind,
    ) ??
    (matches(store.currentSession()) ? store.currentSession() : undefined) ??
    sessions.find(matches)
  );
}

/** One persisted workspace per category in the currently verified account. */
export function startCommunityChat(
  entry: CommunityEntry,
  models: CommunityModel[],
): Promise<ChatSession> {
  const owner = getLocalScope();
  const key = `${owner}:${entry.kind}`;
  const existing = preparing.get(key);
  if (existing) return existing;
  const prepare = async () => {
    const assertOwner = () => {
      if (!isLocalWorkspaceActive() || getLocalScope() !== owner)
        throw new Error("工作区账号已变化，请重新连接。");
    };
    assertOwner();
    const store = useChatStore.getState();
    let session = findCommunityWorkspace(entry.kind);
    const created = !session;
    if (!session) {
      const previous = store.currentSession().id;
      store.newSession();
      session = store.currentSession();
      if (session.id === previous)
        throw new Error("工作区尚未准备好，请重新连接。");
    }
    const targetId = session.id;
    // Persist the marker before awaiting asset restoration, including under StrictMode.
    store.updateTargetSession(session, (target) => {
      target.communityWorkspaceKind = entry.kind;
      target.creationKind = entry.kind;
      if (created) {
        target.topic = titles[entry.kind];
        const model = models.find(
          (item) =>
            item.available &&
            item.name === entry.model &&
            item.provider?.providerName !== CUSTOM_MODEL_PROVIDER,
        );
        target.mask.syncGlobalConfig = false;
        target.mask.modelConfig.model = entry.model;
        target.mask.modelConfig.providerName =
          model?.provider?.providerName || "OpenAI";
        target.mask.modelConfig.template = DEFAULT_INPUT_TEMPLATE;
        target.mask.context = [];
      }
    });
    const index = useChatStore
      .getState()
      .sessions.findIndex((item) => item.id === targetId);
    if (index < 0) throw new Error("制作工作区已变化，请重新打开。");
    await store.selectSession(index);
    assertOwner();
    const selected = useChatStore.getState().currentSession();
    if (
      selected.id !== targetId ||
      selected.communityWorkspaceKind !== entry.kind
    )
      throw new Error("会话已切换，请重新打开制作工作区。");
    return selected;
  };
  const task = prepare().finally(() => {
    if (preparing.get(key) === task) preparing.delete(key);
  });
  preparing.set(key, task);
  return task;
}
