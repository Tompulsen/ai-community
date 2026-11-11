import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";

for (const icon of [
  "three-dots",
  "close",
  "eye",
  "eye-off",
  "down",
  "confirm",
  "cancel",
  "clear",
  "max",
  "min",
]) {
  jest.unstable_mockModule(`@/app/icons/${icon}.svg`, () => ({
    default: () => <svg />,
  }));
}
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    UI: { Confirm: "Confirm", Cancel: "Cancel", Close: "Close" },
    Chat: {
      Actions: {
        FullScreen: "Full Screen",
        ExitFullScreen: "Exit Full Screen",
      },
    },
  },
}));
jest.unstable_mockModule("@/app/components/emoji", () => ({
  Avatar: () => null,
}));
jest.unstable_mockModule("@/app/components/mask-config", () => ({
  ContextPrompts: () => null,
}));
const useChatStore = jest.fn();
jest.unstable_mockModule("@/app/store", () => ({ useChatStore }));
const { EditInputModal } = await import("../app/components/chat-modals");

const originalDraft = "Original draft";
const confirm = jest.fn<(text: string) => void>();
const close = jest.fn();

beforeEach(() => {
  document.body.classList.add("reduce-motion");
  confirm.mockClear();
  close.mockClear();
  useChatStore.mockClear();
});

afterEach(() => {
  document.body.classList.remove("reduce-motion");
  expect(useChatStore).not.toHaveBeenCalled();
});

function renderEditor() {
  function DraftEditor() {
    const [draft, setDraft] = React.useState(originalDraft);
    const [open, setOpen] = React.useState(true);
    return (
      <>
        <output aria-label="Draft">{draft}</output>
        {open && (
          <EditInputModal
            initialValue={draft}
            onConfirm={(value) => {
              confirm(value);
              setDraft(value);
            }}
            onClose={() => {
              close();
              setOpen(false);
            }}
          />
        )}
      </>
    );
  }
  render(<DraftEditor />);
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

test("labels and focuses the editor with its caret after the current draft", () => {
  const input = renderEditor();
  expect(input).toHaveAccessibleName("\u7f16\u8f91\u8f93\u5165\u5185\u5bb9");
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(originalDraft.length);
  expect(input.selectionEnd).toBe(originalDraft.length);
});

test.each([{ ctrlKey: true }, { metaKey: true }])(
  "%j + Enter writes the edited draft once and closes without submitting it",
  (modifier) => {
    const input = renderEditor();
    fireEvent.change(input, { target: { value: "Updated\n  draft" } });
    expect(fireEvent.keyDown(input, { key: "Enter", ...modifier })).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("Updated\n  draft");
    expect(screen.getByLabelText("Draft").textContent).toBe("Updated\n  draft");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(close).toHaveBeenCalledTimes(1);
  },
);

test.each([false, true])(
  "Enter with shift=%s leaves default newline handling and local editing intact",
  (shiftKey) => {
    const input = renderEditor();
    expect(fireEvent.keyDown(input, { key: "Enter", shiftKey })).toBe(true);
    fireEvent.change(input, { target: { value: originalDraft + "\nmore" } });
    expect(input).toHaveValue(originalDraft + "\nmore");
    expect(screen.getByLabelText("Draft")).toHaveTextContent(originalDraft);
    expect(confirm).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  },
);

test.each(["Cancel", "Close", "Escape"])(
  "%s discards local edits and keeps the original draft",
  (action) => {
    const input = renderEditor();
    fireEvent.change(input, { target: { value: "Discard this edit" } });
    if (action === "Escape") fireEvent.keyDown(input, { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: action }));
    expect(screen.getByLabelText("Draft")).toHaveTextContent(originalDraft);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  },
);

test.each(["", " \n  keep this spacing\t "])(
  "the confirm button saves %j without trimming or requiring a model request",
  (value) => {
    const input = renderEditor();
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(confirm).toHaveBeenCalledWith(value);
    expect(screen.getByLabelText("Draft").textContent).toBe(value);
    expect(close).toHaveBeenCalledTimes(1);
  },
);

test("composition state protects candidate selection even without a native flag", () => {
  const input = renderEditor();
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "\u5019\u9009\u6587\u5b57" } });
  expect(fireEvent.keyDown(input, { key: "Enter", ctrlKey: true })).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(input).toHaveValue("\u5019\u9009\u6587\u5b57");
});

test.each([{ isComposing: true }, { keyCode: 229 }])(
  "native IME metadata %j prevents keyboard confirmation",
  (metadata) => {
    const input = renderEditor();
    expect(
      fireEvent.keyDown(input, { key: "Enter", metaKey: true, ...metadata }),
    ).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  },
);

test("a trailing commit Enter is ignored until release and a deliberate shortcut", () => {
  const input = renderEditor();
  fireEvent.compositionStart(input);
  fireEvent.change(input, {
    target: { value: "\u5df2\u786e\u8ba4\u6587\u5b57" },
  });
  fireEvent.compositionEnd(input);
  expect(fireEvent.keyDown(input, { key: "Enter", ctrlKey: true })).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.keyUp(input, { key: "Enter" });
  expect(fireEvent.keyDown(input, { key: "Enter", ctrlKey: true })).toBe(false);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledWith("\u5df2\u786e\u8ba4\u6587\u5b57");
  expect(close).toHaveBeenCalledTimes(1);
});

test("a repeated shortcut cannot confirm the editor", () => {
  const input = renderEditor();
  expect(
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true, repeat: true }),
  ).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

describe("animated editor exits", () => {
  beforeEach(() => {
    document.body.classList.remove("reduce-motion");
    jest.useFakeTimers();
  });
  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  test("freezes the confirmed draft and ignores pending shortcuts and cancel", () => {
    const input = renderEditor();
    fireEvent.change(input, { target: { value: "Saved draft" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    const mask = document.querySelector(".modal-mask")!;
    expect(mask).toHaveClass("modal-closing");
    expect(confirm).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Late draft" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.animationEnd(mask);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("Saved draft");
    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Draft").textContent).toBe("Saved draft");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => jest.advanceTimersByTime(180));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  test("cancelling first cannot save a draft during the exit delay", () => {
    const input = renderEditor();
    fireEvent.change(input, { target: { value: "Discarded draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    act(() => jest.advanceTimersByTime(180));
    expect(confirm).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Draft")).toHaveTextContent(originalDraft);
  });
});
