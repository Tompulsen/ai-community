import React, { createRef, useSyncExternalStore } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";

const keys = {
  Enter: "Enter",
  CtrlEnter: "Ctrl + Enter",
  ShiftEnter: "Shift + Enter",
  AltEnter: "Alt + Enter",
  MetaEnter: "Meta + Enter",
};
let submitKey = keys.Enter;
let prompt = "Ocean waves";
const listeners = new Set<() => void>();
const materials = [
  { id: "image-1", url: "/reference.png", name: "reference.png" },
];
let state: {
  draft: { prompt: string; materials: typeof materials };
  updateDraft: (patch: { prompt: string }) => void;
};
const onSubmit = jest.fn();
const originalScroll = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);
jest.unstable_mockModule("@/app/store/config", () => ({
  SubmitKey: keys,
  useAppConfig: (selector: (config: { submitKey: string }) => unknown) =>
    selector({ submitKey }),
}));
jest.unstable_mockModule("@/app/store/video", () => ({
  useVideoStore: () =>
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => state,
    ),
}));
jest.unstable_mockModule("@/app/utils/use-anchored-panel", () => ({
  useAnchoredPanel: () => ({}),
}));
const { VideoPromptInput } = await import(
  "../app/components/video-workspace/video-prompt-input"
);

function input() {
  return screen.getByRole("textbox", { name: "视频提示词" });
}
function mount() {
  return render(
    <VideoPromptInput
      inputRef={createRef<HTMLTextAreaElement>()}
      onSubmit={onSubmit}
    />,
  );
}
beforeEach(() => {
  submitKey = keys.Enter;
  prompt = "Ocean waves";
  state = {
    draft: { prompt, materials },
    updateDraft: (patch) => {
      state = { ...state, draft: { ...state.draft, ...patch } };
      listeners.forEach((listener) => listener());
    },
  };
  onSubmit.mockReset();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: jest.fn(),
  });
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  if (originalScroll)
    Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else delete (Element.prototype as Partial<Element>).scrollIntoView;
});

test("Enter submits and Shift+Enter keeps the native newline", () => {
  mount();
  expect(fireEvent.keyDown(input(), { key: "Enter", shiftKey: true })).toBe(
    true,
  );
  expect(onSubmit).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(input(), { key: "Enter" })).toBe(false);
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test.each([
  [keys.CtrlEnter, { ctrlKey: true }],
  [keys.ShiftEnter, { shiftKey: true }],
  [keys.AltEnter, { altKey: true }],
  [keys.MetaEnter, { metaKey: true }],
])("video input follows the global %s send setting", (setting, modifiers) => {
  submitKey = setting;
  mount();
  expect(fireEvent.keyDown(input(), { key: "Enter" })).toBe(true);
  expect(onSubmit).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(input(), { key: "Enter", ...modifiers })).toBe(
    false,
  );
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test("composition, trailing commit Enter and key repeat never send", () => {
  mount();
  fireEvent.compositionStart(input());
  fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
  fireEvent.compositionEnd(input());
  fireEvent.keyDown(input(), { key: "Enter" });
  fireEvent.keyDown(input(), { key: "Enter", keyCode: 229 });
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.keyUp(input(), { key: "Enter" });
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(input(), { key: "Enter", repeat: true });
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test("Enter selects an image mention before it can send the prompt", () => {
  mount();
  fireEvent.change(input(), {
    target: { value: "Use @", selectionStart: 5, selectionEnd: 5 },
  });
  expect(
    screen.getByRole("listbox", { name: "选择参考图片" }),
  ).toBeInTheDocument();
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(state.draft.prompt).toBe("Use @图片1 ");
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.keyUp(input(), { key: "Enter" });
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(onSubmit).toHaveBeenCalledTimes(1);
});
