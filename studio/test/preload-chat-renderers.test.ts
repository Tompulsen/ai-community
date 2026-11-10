import { jest } from "@jest/globals";
import type { ChatMessage } from "../app/store/chat";

const markdownLoaded = jest.fn();
const reasoningLoaded = jest.fn();
jest.unstable_mockModule("@/app/components/markdown", () => {
  markdownLoaded();
  return { Markdown: () => null };
});
jest.unstable_mockModule("@/app/components/reasoning-panel", () => {
  reasoningLoaded();
  return { ReasoningPanel: () => null };
});
beforeEach(() => {
  jest.resetModules();
  markdownLoaded.mockClear();
  reasoningLoaded.mockClear();
});

test("keeps empty chats light and warms shared renderer modules for history", async () => {
  const { preloadChatRenderers } = await import(
    "../app/utils/preload-chat-renderers"
  );
  await preloadChatRenderers([]);
  expect(markdownLoaded).not.toHaveBeenCalled();
  expect(reasoningLoaded).not.toHaveBeenCalled();
  const history: ChatMessage[] = [
    { id: "warm-history", role: "assistant", content: "Saved reply", date: "" },
  ];
  await Promise.all([
    preloadChatRenderers(history),
    preloadChatRenderers(history),
  ]);
  expect(markdownLoaded).toHaveBeenCalledTimes(1);
  expect(reasoningLoaded).toHaveBeenCalledTimes(1);
});

test("allows the renderer preload to retry after a load failure", async () => {
  markdownLoaded.mockImplementationOnce(() => {
    throw new Error("Temporary chunk failure");
  });
  const { preloadChatRenderers } = await import(
    "../app/utils/preload-chat-renderers"
  );
  const history: ChatMessage[] = [
    { id: "retry-history", role: "assistant", content: "Reply", date: "" },
  ];
  await expect(preloadChatRenderers(history)).rejects.toThrow(
    "Temporary chunk failure",
  );
  await expect(preloadChatRenderers(history)).resolves.toBeUndefined();
  expect(markdownLoaded).toHaveBeenCalledTimes(2);
});
