import { pendingTasks } from "./local-tasks";
import { getLocalTokenId } from "./local-workspace";
import { ChatControllerPool } from "../client/controller";
import { useVideoStore } from "../store/video";

export function hasPendingGeneration() {
  return (
    ChatControllerPool.hasPending() ||
    useVideoStore.getState().isGenerating ||
    hasPendingAccountTasks()
  );
}

export function hasPendingAccountTasks(now = Date.now()) {
  return pendingTasks().some(
    (task) =>
      !task.customApiBase &&
      task.tokenId === getLocalTokenId() &&
      !task.needsAttention &&
      now - task.createdAt <
        (task.kind === "video" ? 2 * 60 * 60_000 : 30 * 60_000),
  );
}
