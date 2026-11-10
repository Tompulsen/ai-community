import { act, renderHook } from "@testing-library/react";
import { jest } from "@jest/globals";
import { useTypewriterText } from "../app/components/use-typewriter";

let hidden = false;
let motion: MediaQueryList;
const originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");

beforeEach(() => {
  jest.useFakeTimers();
  hidden = false;
  document.body.classList.remove("reduce-motion");
  document.body.removeAttribute("data-motion");
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  motion = {
    matches: false,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  } as unknown as MediaQueryList;
  window.matchMedia = jest.fn(() => motion);
});

afterEach(() => {
  document.body.classList.remove("reduce-motion");
  document.body.removeAttribute("data-motion");
  jest.useRealTimers();
  jest.restoreAllMocks();
  if (originalHidden) Object.defineProperty(document, "hidden", originalHidden);
  else Reflect.deleteProperty(document, "hidden");
});

function advance(ms: number) {
  act(() => jest.advanceTimersByTime(ms));
}

test("paces a burst and continues typing after the network finishes", () => {
  const { result, rerender } = renderHook(
    ({ content, streaming }) => useTypewriterText(content, streaming),
    { initialProps: { content: "", streaming: true } },
  );
  const content = "平缓输出文字".repeat(30);
  rerender({ content, streaming: true });
  expect(result.current).toBe("");
  advance(64);
  expect(result.current.length).toBeGreaterThan(0);
  expect(result.current.length).toBeLessThan(content.length / 2);
  const partial = result.current;
  rerender({ content, streaming: false });
  expect(result.current).toBe(partial);
  advance(400);
  expect(result.current).toBe(content);
  // Later edits of a completed message must not start another typing animation.
  rerender({ content: content + "追加编辑", streaming: false });
  expect(result.current).toBe(content + "追加编辑");
});

test("shows history immediately, including a conversation reopened mid-stream", () => {
  const content = "历史内容".repeat(100);
  const { result } = renderHook(() => useTypewriterText(content, false));
  expect(result.current).toBe(content);
  const active = renderHook(() => useTypewriterText(content, true));
  expect(active.result.current).toBe(content);
});

test("replaces edited text and restarts a cleared response without old letters", () => {
  const { result, rerender } = renderHook(
    ({ content }) => useTypewriterText(content, true),
    { initialProps: { content: "" } },
  );
  rerender({ content: "旧内容".repeat(50) });
  advance(100);
  rerender({ content: "" });
  expect(result.current).toBe("");
  rerender({ content: "新的回答" });
  advance(1000);
  expect(result.current).toBe("新的回答");
});

test("flushes hidden content without losing text or replaying it on return", () => {
  const { result, rerender } = renderHook(
    ({ content }) => useTypewriterText(content, true),
    { initialProps: { content: "" } },
  );
  const content = "后台接收".repeat(100);
  rerender({ content });
  advance(64);
  act(() => {
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(result.current).toBe(content);
  rerender({ content: content + "新内容" });
  expect(result.current).toBe(content + "新内容");
  act(() => {
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(result.current).toBe(content + "新内容");
});

test("bypasses typing for image/error content and reduced motion", () => {
  const { result, rerender } = renderHook(
    ({ content, instant }) => useTypewriterText(content, true, instant),
    { initialProps: { content: "", instant: false } },
  );
  rerender({
    content: "![Generated Image](data:image/png;base64,abc)",
    instant: true,
  });
  expect(result.current).toBe("![Generated Image](data:image/png;base64,abc)");
  (motion as { matches: boolean }).matches = true;
  const reduced = renderHook(
    ({ content }) => useTypewriterText(content, true),
    { initialProps: { content: "" } },
  );
  reduced.rerender({ content: "减少动态效果时立即显示" });
  expect(reduced.result.current).toBe("减少动态效果时立即显示");
});

test("application reduced motion shows new content immediately", () => {
  document.body.classList.add("reduce-motion");
  const { result, rerender } = renderHook(
    ({ content }) => useTypewriterText(content, true),
    { initialProps: { content: "" } },
  );
  rerender({ content: "No visible backlog".repeat(20) });
  expect(result.current).toBe("No visible backlog".repeat(20));
  expect(jest.getTimerCount()).toBe(0);
});

test.each(["application", "system"])(
  "%s reduced motion flushes a running stream and never replays it when disabled",
  async (preference) => {
    const { result, rerender } = renderHook(
      ({ content }) => useTypewriterText(content, true),
      { initialProps: { content: "" } },
    );
    const content = "A growing response. ".repeat(30);
    rerender({ content });
    advance(64);
    expect(result.current.length).toBeLessThan(content.length);
    const onSystemChange = (
      motion.addEventListener as ReturnType<typeof jest.fn>
    ).mock.calls[0][1] as () => void;
    await act(async () => {
      if (preference === "application")
        document.body.classList.add("reduce-motion");
      else {
        (motion as { matches: boolean }).matches = true;
        onSystemChange();
      }
    });
    expect(result.current).toBe(content);
    expect(jest.getTimerCount()).toBe(0);

    await act(async () => {
      if (preference === "application")
        document.body.classList.remove("reduce-motion");
      else {
        (motion as { matches: boolean }).matches = false;
        onSystemChange();
      }
    });
    advance(64);
    expect(result.current).toBe(content);
    rerender({ content: content + "Only the new tail" });
    expect(result.current).toBe(content);
    advance(400);
    expect(result.current).toBe(content + "Only the new tail");
  },
);

test.each([
  ["system", true],
  ["reduced", false],
] as const)(
  "changing only motion from full to %s flushes typing without replaying the response",
  async (preference, systemReduced) => {
    (motion as { matches: boolean }).matches = systemReduced;
    document.body.dataset.motion = "full";
    const { result, rerender } = renderHook(
      ({ content }) => useTypewriterText(content, true),
      { initialProps: { content: "" } },
    );
    const content = "A growing response. ".repeat(30);
    rerender({ content });
    advance(64);
    expect(result.current.length).toBeGreaterThan(0);
    expect(result.current.length).toBeLessThan(content.length);

    await act(async () => {
      document.body.dataset.motion = preference;
    });
    expect(document.body.classList.contains("reduce-motion")).toBe(false);
    expect(result.current).toBe(content);
    expect(jest.getTimerCount()).toBe(0);

    await act(async () => {
      document.body.dataset.motion = "full";
    });
    advance(64);
    expect(result.current).toBe(content);
    rerender({ content: content + "Only the new tail" });
    expect(result.current).toBe(content);
    advance(400);
    expect(result.current).toBe(content + "Only the new tail");
  },
);

test("reveals whole emoji graphemes without splitting their UTF-16 characters", () => {
  const glyphs = ["你", "👩‍💻", "👍🏽", "好", "🇨🇳"];
  const content = glyphs.join("");
  const validPrefixes = [
    "",
    ...glyphs.map((_, i) => glyphs.slice(0, i + 1).join("")),
  ];
  const { result, rerender } = renderHook(
    ({ content }) => useTypewriterText(content, true),
    { initialProps: { content: "" } },
  );
  rerender({ content });
  for (let i = 0; i < 30; i++) {
    advance(16);
    expect(validPrefixes).toContain(result.current);
  }
  expect(result.current).toBe(content);
});

test("removes scheduled animation work when the message unmounts", () => {
  const { rerender, unmount } = renderHook(
    ({ content }) => useTypewriterText(content, true),
    { initialProps: { content: "" } },
  );
  rerender({ content: "pending".repeat(100) });
  expect(jest.getTimerCount()).toBeGreaterThan(0);
  unmount();
  expect(jest.getTimerCount()).toBe(0);
});

test("catches up large bursts without turning them into one full-text update", () => {
  const { result, rerender } = renderHook(
    ({ content, streaming }) => useTypewriterText(content, streaming),
    { initialProps: { content: "", streaming: true } },
  );
  const content = "长回答".repeat(1500);
  rerender({ content, streaming: false });
  advance(64);
  expect(result.current.length).toBeGreaterThan(240);
  expect(result.current.length).toBeLessThan(content.length);
  advance(336);
  expect(result.current).toBe(content);
});

test("follows a sustained fast stream without leaving seconds of visible backlog", () => {
  const { result, rerender } = renderHook(
    ({ content, streaming }) => useTypewriterText(content, streaming),
    { initialProps: { content: "", streaming: true } },
  );
  let content = "";
  for (let i = 0; i < 50; i++) {
    content += "Continuous response with a fast stream of new tokens. ";
    rerender({ content, streaming: true });
    advance(40);
  }
  expect(result.current.length).toBeGreaterThan(content.length * 0.8);
  expect(result.current.length).toBeLessThan(content.length);
  rerender({ content, streaming: false });
  advance(400);
  expect(result.current).toBe(content);
});

test("waits for the low surrogate rather than displaying half an emoji", () => {
  const { result, rerender } = renderHook(
    ({ content }) => useTypewriterText(content, true),
    { initialProps: { content: "" } },
  );
  rerender({ content: "\ud83d" });
  advance(100);
  expect(result.current).toBe("");
  rerender({ content: "😀" });
  advance(100);
  expect(result.current).toBe("😀");
});
