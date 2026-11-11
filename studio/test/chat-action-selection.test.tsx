import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { jest } from "@jest/globals";

const { ChatMessageActions } = await import("../app/components/chat-action");

const mediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
const showDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: query === "(max-width: 600px)" }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
      this.querySelector<HTMLButtonElement>("button")?.focus();
      document.getSelection()?.removeAllRanges();
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{ width: 44, height: 44 }] as unknown as DOMRectList);
});

afterEach(() => {
  cleanup();
  act(() => jest.runOnlyPendingTimers());
  document.getSelection()?.removeAllRanges();
  jest.useRealTimers();
  jest.restoreAllMocks();
  for (const [target, property, descriptor] of [
    [window, "matchMedia", mediaDescriptor],
    [HTMLDialogElement.prototype, "showModal", showDescriptor],
    [HTMLDialogElement.prototype, "close", closeDescriptor],
  ] as const) {
    if (descriptor) Object.defineProperty(target, property, descriptor);
    else Reflect.deleteProperty(target, property);
  }
});

function Harness({
  onQuoteSelection,
  compact = true,
}: {
  onQuoteSelection?: (text: string) => void;
  compact?: boolean;
}) {
  return (
    <>
      <article
        data-quotable-message
        data-message-id="first"
        data-message-role="assistant"
      >
        <pre data-testid="message-text">
          {"  Selected first line\n    second line\nEntire answer end"}
        </pre>
        <span data-testid="blank">{"   "}</span>
        <textarea aria-label="Draft" defaultValue="Do not quote this" />
        <div
          contentEditable
          suppressContentEditableWarning
          data-testid="editable"
        >
          Private editable text
        </div>
        <ChatMessageActions
          compact={compact}
          onQuoteSelection={onQuoteSelection}
          actions={[
            { id: "copy", text: "复制", icon: <svg />, onClick() {} },
            { id: "reuse", text: "复用输入", icon: <svg />, onClick() {} },
          ]}
        />
      </article>
      <article
        data-quotable-message
        data-message-id="second"
        data-message-role="user"
      >
        <p data-testid="other-message">Another message</p>
      </article>
    </>
  );
}

function select(start: Node, end = start, startOffset = 0, endOffset?: number) {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset ?? end.textContent!.length);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

async function finishClosing() {
  await act(async () => jest.advanceTimersByTime(260));
  act(() => jest.runAllTicks());
}

test("selecting text alone never shows a quote control or opens a sheet", () => {
  render(<Harness onQuoteSelection={jest.fn()} />);
  select(screen.getByTestId("message-text").firstChild!);
  fireEvent(document, new Event("selectionchange"));
  fireEvent.pointerUp(document);
  fireEvent.keyUp(document, { key: "Shift" });
  expect(screen.queryByRole("button", { name: "引用选中文字" })).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("More captures selected text before focus collapses it and consumes the exact snapshot after closing", async () => {
  const quote = jest.fn<(text: string) => void>();
  render(<Harness onQuoteSelection={quote} />);
  const excerpt = "  Selected first line\n    second line\n";
  select(
    screen.getByTestId("message-text").firstChild!,
    undefined,
    0,
    excerpt.length,
  );
  const more = screen.getByRole("button", { name: "更多消息操作" });
  fireEvent.pointerDown(more);
  more.focus();
  document.getSelection()?.removeAllRanges();
  fireEvent.click(more);
  const dialog = screen.getByRole("dialog", { name: "消息操作" });
  const action = within(dialog).getByRole("button", { name: "引用选中文字" });
  fireEvent.click(action);
  expect(quote).not.toHaveBeenCalled();
  await finishClosing();
  expect(quote).toHaveBeenCalledTimes(1);
  expect(quote).toHaveBeenCalledWith(excerpt);
  fireEvent.click(more);
  expect(screen.queryByRole("button", { name: "引用选中文字" })).toBeNull();
});

test("click and keyboard activation can capture a current selection without pointer state", () => {
  render(<Harness onQuoteSelection={jest.fn()} />);
  select(screen.getByTestId("message-text").firstChild!);
  const more = screen.getByRole("button", { name: "更多消息操作" });
  fireEvent.keyDown(more, { key: "Enter" });
  fireEvent.click(more);
  expect(
    screen.getByRole("button", { name: "引用选中文字" }),
  ).toBeInTheDocument();
});

test("empty, whitespace-only and cross-message selections never fall back to the full reply", async () => {
  render(<Harness onQuoteSelection={jest.fn()} />);
  const more = screen.getByRole("button", { name: "更多消息操作" });
  const selections = [
    () => document.getSelection()?.removeAllRanges(),
    () => select(screen.getByTestId("blank").firstChild!),
    () =>
      select(
        screen.getByTestId("message-text").firstChild!,
        screen.getByTestId("other-message").firstChild!,
      ),
  ];
  for (const choose of selections) {
    choose();
    fireEvent.pointerDown(more);
    fireEvent.click(more);
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).queryByRole("button", { name: "引用选中文字" }),
    ).toBeNull();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await finishClosing();
  }
});

test("cancelled pointer gestures and cancelled sheets cannot reuse an old selection", async () => {
  render(<Harness onQuoteSelection={jest.fn()} />);
  select(screen.getByTestId("message-text").firstChild!);
  const more = screen.getByRole("button", { name: "更多消息操作" });
  fireEvent.pointerDown(more);
  fireEvent.pointerCancel(more);
  document.getSelection()?.removeAllRanges();
  fireEvent.click(more);
  expect(screen.queryByRole("button", { name: "引用选中文字" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await finishClosing();

  select(screen.getByTestId("message-text").firstChild!);
  fireEvent.pointerDown(more);
  fireEvent.click(more);
  expect(
    screen.getByRole("button", { name: "引用选中文字" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  await finishClosing();
  fireEvent.click(more);
  expect(screen.queryByRole("button", { name: "引用选中文字" })).toBeNull();
});

test("keyboard activation discards an abandoned pointer snapshot", () => {
  render(<Harness onQuoteSelection={jest.fn()} />);
  select(screen.getByTestId("message-text").firstChild!);
  const more = screen.getByRole("button", { name: "更多消息操作" });
  fireEvent.pointerDown(more);
  document.getSelection()?.removeAllRanges();
  fireEvent.keyDown(more, { key: " " });
  fireEvent.click(more);
  expect(screen.queryByRole("button", { name: "引用选中文字" })).toBeNull();
});

test("editable selections and desktop actions do not add quote controls", () => {
  const { rerender } = render(<Harness onQuoteSelection={jest.fn()} />);
  select(screen.getByTestId("editable").firstChild!);
  const more = screen.getByRole("button", { name: "更多消息操作" });
  fireEvent.pointerDown(more);
  fireEvent.click(more);
  expect(screen.queryByRole("button", { name: "引用选中文字" })).toBeNull();
  rerender(<Harness onQuoteSelection={jest.fn()} compact={false} />);
  expect(screen.queryByRole("button", { name: "更多消息操作" })).toBeNull();
});
