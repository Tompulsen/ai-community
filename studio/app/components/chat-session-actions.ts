import Locale from "../locales";
import { useChatStore } from "../store";
import {
  getLocalScope,
  isLocalWorkspaceActive,
} from "../utils/local-workspace";

export async function renameChatSession(id: string): Promise<void> {
  if (!isLocalWorkspaceActive()) return;
  const owner = getLocalScope();
  const target = useChatStore
    .getState()
    .sessions.find((item) => item.id === id);
  if (!target) return;
  const { showPrompt } = await import("./ui-lib");
  const value = await showPrompt(Locale.Chat.Rename, target.topic, 1);
  const title = value?.trim();
  if (!title || !isLocalWorkspaceActive() || getLocalScope() !== owner) return;
  const state = useChatStore.getState();
  const currentTarget = state.sessions.find((item) => item.id === id);
  if (currentTarget)
    state.updateTargetSession(currentTarget, (session) => {
      session.topic = title;
    });
}
