import type { ChatMessage } from "../store/chat";
import { importInTransition } from "./import-in-transition";

let loading: Promise<void> | undefined;

export function preloadChatRenderers(
  messages: readonly ChatMessage[],
): Promise<void> {
  if (messages.length === 0) return Promise.resolve();
  return (loading ??= importInTransition(() =>
    Promise.all([
      import("../components/markdown"),
      import("../components/reasoning-panel"),
    ]),
  )
    .then(() => {})
    .catch((error) => {
      loading = undefined;
      throw error;
    }));
}
