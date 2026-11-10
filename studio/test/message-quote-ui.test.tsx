import React, { useRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import type { MessageQuote } from "../app/utils/message-quote";

jest.unstable_mockModule("@/app/locales", () => ({
  default: { Chat: { Actions: {} }, Download: {} },
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showToast: jest.fn(),
}));
jest.unstable_mockModule("@/app/utils/image-download", () => ({
  downloadImage: jest.fn(),
}));
for (const icon of ["copy", "edit", "reload", "pin", "clear", "download"]) {
  jest.unstable_mockModule(`@/app/icons/${icon}.svg`, () => ({
    default: () => <svg aria-hidden="true" />,
  }));
}
const { MessageQuoteView, MessageQuoteSelection } = await import(
  "../app/components/message-quote"
);

const quote: MessageQuote = {
  messageId: "message-1",
  role: "assistant",
  text: "  First line\n**Literal Markdown**\n<script>Not executable</script>",
};
const rangeDescriptor = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getBoundingClientRect",
);
let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
let selectionBounds: DOMRect;

function rect(left: number, top: number, width: number, height: number) {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {
      return {};
    },
  } as DOMRect;
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  selectionBounds = rect(200, 250, 180, 22);
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(() => rect(50, 100, 600, 500));
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => selectionBounds,
  });
});

afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
  jest.restoreAllMocks();
  if (rangeDescriptor)
    Object.defineProperty(
      Range.prototype,
      "getBoundingClientRect",
      rangeDescriptor,
    );
  else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});

function flushFrames() {
  act(() => {
    const pending = [...frames.entries()];
    frames.clear();
    for (const [, callback] of pending) callback(performance.now());
  });
}

function select(start: Node, end = start, startOffset = 0, endOffset?: number) {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset ?? end.textContent!.length);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent(document, new Event("selectionchange"));
  flushFrames();
}

function Harness({
  disabled = false,
  mobile = false,
  onQuote = () => {},
}: {
  disabled?: boolean;
  mobile?: boolean;
  onQuote?: (value: MessageQuote) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={containerRef} data-testid="quote-container">
        <article
          data-quotable-message
          data-message-id="message-1"
          data-message-role="assistant"
        >
          <p data-testid="answer-one">First answer</p>
          <p data-testid="answer-two">Second line</p>
          <p data-testid="blank">{"   "}</p>
          <textarea aria-label="Editable text" defaultValue="Private draft" />
          <div
            contentEditable
            suppressContentEditableWarning
            data-testid="editable"
          >
            Editable block
          </div>
        </article>
        <article
          data-quotable-message
          data-message-id="message-2"
          data-message-role="user"
        >
          <p data-testid="other-answer">Other answer</p>
        </article>
        <article
          data-quotable-message
          data-message-id="system"
          data-message-role="system"
        >
          <p data-testid="system">System context</p>
        </article>
      </div>
      <p data-testid="outside">Outside chat</p>
      <MessageQuoteSelection
        containerRef={containerRef}
        disabled={disabled}
        mobile={mobile}
        onQuote={onQuote}
      />
    </>
  );
}

test("quote view preserves raw multiline text and offers removal only in the composer", () => {
  const remove = jest.fn();
  const { container, rerender } = render(
    <MessageQuoteView quote={quote} onRemove={remove} />,
  );
  const view = screen.getByTestId("composer-quote");
  expect(view.textContent).toContain(quote.text);
  expect(screen.getByText("引用 · AI 回复")).toBeInTheDocument();
  expect(container.querySelector("strong")).toBeNull();
  expect(container.querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "取消引用" }));
  expect(remove).toHaveBeenCalledTimes(1);
  rerender(<MessageQuoteView quote={{ ...quote, role: "user" }} />);
  expect(screen.getByTestId("message-quote")).toBeInTheDocument();
  expect(screen.getByText("引用 · 你的消息")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "取消引用" })).toBeNull();
});

test("a valid single-message selection offers a captured quote that survives selection collapse", () => {
  const onQuote = jest.fn<(value: MessageQuote) => void>();
  render(<Harness onQuote={onQuote} />);
  select(screen.getByTestId("answer-one").firstChild!);
  const button = screen.getByRole("button", { name: "引用选中文字" });
  expect(button).toHaveStyle({ left: "200px", top: "198px" });
  const pointer = new Event("pointerdown", { bubbles: true, cancelable: true });
  fireEvent(button, pointer);
  expect(pointer.defaultPrevented).toBe(true);
  document.getSelection()?.removeAllRanges();
  fireEvent.click(button);
  expect(onQuote).toHaveBeenCalledWith({
    messageId: "message-1",
    role: "assistant",
    text: "First answer",
  });
  expect(screen.queryByRole("button", { name: "引用选中文字" })).toBeNull();
});

test("empty, whitespace-only, collapsed, cross-message and external selections offer no quote", () => {
  render(<Harness />);
  flushFrames();
  expect(screen.queryByRole("button")).toBeNull();
  const first = screen.getByTestId("answer-one").firstChild!;
  select(first, first, 1, 1);
  expect(screen.queryByRole("button")).toBeNull();
  select(screen.getByTestId("blank").firstChild!);
  expect(screen.queryByRole("button")).toBeNull();
  select(first, screen.getByTestId("other-answer").firstChild!);
  expect(screen.queryByRole("button")).toBeNull();
  select(screen.getByTestId("outside").firstChild!);
  expect(screen.queryByRole("button")).toBeNull();
  select(screen.getByTestId("system").firstChild!);
  expect(screen.queryByRole("button")).toBeNull();
});

test("editable text and stale selections while an input is focused do not offer a quote", () => {
  render(<Harness />);
  select(screen.getByTestId("editable").firstChild!);
  expect(screen.queryByRole("button")).toBeNull();
  const input = screen.getByRole("textbox", { name: "Editable text" });
  act(() => input.focus());
  select(screen.getByTestId("answer-one").firstChild!);
  expect(screen.queryByRole("button")).toBeNull();
});

test("mobile prefers below the selection, keeps the toolbar within the chat and hides offscreen selections", () => {
  render(<Harness mobile />);
  select(screen.getByTestId("answer-one").firstChild!);
  expect(screen.getByRole("button")).toHaveStyle({ top: "280px" });
  selectionBounds = rect(620, 530, 50, 20);
  fireEvent.scroll(window);
  flushFrames();
  expect(screen.getByRole("button")).toHaveStyle({
    left: "562px",
    top: "478px",
  });
  selectionBounds = rect(200, 800, 100, 20);
  fireEvent.scroll(window);
  flushFrames();
  expect(screen.queryByRole("button")).toBeNull();
});

test("disabled state hides the toolbar and unmount cancels scheduled updates and listeners", () => {
  const { rerender, unmount } = render(<Harness />);
  select(screen.getByTestId("answer-one").firstChild!);
  expect(screen.getByRole("button")).toBeInTheDocument();
  rerender(<Harness disabled />);
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<Harness />);
  fireEvent(document, new Event("selectionchange"));
  expect(frames.size).toBeGreaterThan(0);
  unmount();
  expect(frames.size).toBe(0);
  fireEvent(document, new Event("selectionchange"));
  fireEvent.keyUp(document, { key: "Shift" });
  fireEvent.pointerUp(document);
  fireEvent.scroll(window);
  expect(frames.size).toBe(0);
});

test("Escape dismisses the floating action and its selection", () => {
  render(<Harness />);
  select(screen.getByTestId("answer-one").firstChild!);
  expect(screen.getByRole("button")).toBeInTheDocument();
  fireEvent.keyUp(document, { key: "Escape" });
  expect(screen.queryByRole("button")).toBeNull();
  expect(document.getSelection()?.rangeCount).toBe(0);
});
