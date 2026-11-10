import React, { useRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import {
  CURRENT_SEARCH_HIGHLIGHT,
  SEARCH_HIGHLIGHT,
  renderedSearchRanges,
  useConversationSearchHighlight,
} from "../app/components/use-conversation-search-highlight";

const savedCss = Object.getOwnPropertyDescriptor(window, "CSS");
const savedHighlight = Object.getOwnPropertyDescriptor(window, "Highlight");
const savedResize = Object.getOwnPropertyDescriptor(window, "ResizeObserver");
const savedRangeRect = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getBoundingClientRect",
);
let registry: Map<string, Set<Range>>;
let resizeCallbacks: (() => void)[];

beforeEach(() => {
  jest.useFakeTimers();
  resizeCallbacks = [];
  registry = new Map();
  Object.defineProperty(window, "CSS", {
    configurable: true,
    value: { highlights: registry },
  });
  Object.defineProperty(window, "Highlight", {
    configurable: true,
    value: class extends Set<Range> {
      constructor(...ranges: Range[]) {
        super(ranges);
      }
    },
  });
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: 40, bottom: 56, height: 16 }),
  });
});

afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
  if (savedCss) Object.defineProperty(window, "CSS", savedCss);
  else Reflect.deleteProperty(window, "CSS");
  if (savedHighlight)
    Object.defineProperty(window, "Highlight", savedHighlight);
  else Reflect.deleteProperty(window, "Highlight");
  if (savedResize) Object.defineProperty(window, "ResizeObserver", savedResize);
  else Reflect.deleteProperty(window, "ResizeObserver");
  if (savedRangeRect)
    Object.defineProperty(
      Range.prototype,
      "getBoundingClientRect",
      savedRangeRect,
    );
  else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  jest.useRealTimers();
});

test("literal, case-insensitive matching spans Markdown nodes without changing markup", () => {
  const element = document.createElement("div");
  element.innerHTML = "前缀 [a<strong>+b</strong>] 后缀 [A+B]";
  const markup = element.innerHTML;
  const ranges = renderedSearchRanges(element, "[a+b]");
  expect(ranges.map((range) => range.toString())).toEqual(["[a+b]", "[A+B]"]);
  expect(element.innerHTML).toBe(markup);
});

test("hidden controls do not contribute search matches", () => {
  const element = document.createElement("div");
  element.innerHTML =
    "<button>needle</button><span aria-hidden='true'>needle</span><p>needle</p>";
  expect(renderedSearchRanges(element, "needle")).toHaveLength(1);
  expect(renderedSearchRanges(element, "  ")).toHaveLength(0);
});

function Fixture({ occurrence = 0, enabled = true }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useConversationSearchHighlight({
    containerRef,
    query: "needle",
    current: {
      messageId: "answer",
      messageIndex: 0,
      start: occurrence * 10,
      end: 6,
    },
    occurrence,
    navigation: occurrence,
    page: 0,
    enabled,
  });
  return (
    <div ref={containerRef} data-testid="history">
      <article data-quotable-message="" data-message-id="answer">
        <div aria-hidden="true">
          <div className="markdown-body">needle in folded reasoning</div>
        </div>
        <div
          className="markdown-body"
          data-chat-search-content="true"
          data-testid="answer"
        >
          needle and needle
        </div>
      </article>
    </div>
  );
}

test("changing the current occurrence preserves native selection and clears highlights on close", () => {
  const view = render(<Fixture />);
  const text = screen.getByTestId("answer").firstChild!;
  const selection = document.getSelection()!;
  const nativeRange = document.createRange();
  nativeRange.setStart(text, 7);
  nativeRange.setEnd(text, 10);
  selection.addRange(nativeRange);
  expect(registry.get(SEARCH_HIGHLIGHT)?.size).toBe(2);
  expect(document.querySelector("[data-chat-search-fallback]")).toBeNull();
  expect([...registry.get(CURRENT_SEARCH_HIGHLIGHT)!][0].startOffset).toBe(0);
  view.rerender(<Fixture occurrence={1} />);
  expect([...registry.get(CURRENT_SEARCH_HIGHLIGHT)!][0].startOffset).toBe(11);
  expect(selection.toString()).toBe("and");
  expect(selection.anchorNode).toBe(text);
  expect(
    document.querySelector("[data-chat-search-current='true']"),
  ).not.toBeNull();
  view.rerender(<Fixture occurrence={1} enabled={false} />);
  expect(registry.size).toBe(0);
  expect(document.querySelector("[data-chat-search-current]")).toBeNull();
  expect(selection.toString()).toBe("and");
});

test("unsupported browsers still identify the active message and clean up on unmount", () => {
  Object.defineProperty(window, "Highlight", {
    configurable: true,
    value: undefined,
  });
  const view = render(<Fixture />);
  expect(
    document.querySelector("[data-chat-search-current='true']"),
  ).not.toBeNull();
  expect(
    document.querySelector("[data-chat-search-fallback='true']"),
  ).not.toBeNull();
  view.unmount();
  expect(registry.size).toBe(0);
});

test("late content reflow keeps the current hit visible until the user scrolls", () => {
  render(<Fixture />);
  const body = screen.getByTestId("history");
  Object.defineProperty(body, "clientHeight", { value: 300 });
  body.getBoundingClientRect = () => ({ top: 0, bottom: 300 }) as DOMRect;
  let contentTop = 500;
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: contentTop - body.scrollTop,
      bottom: contentTop - body.scrollTop + 16,
      height: 16,
    }),
  });
  act(() => jest.advanceTimersByTime(50));
  expect(body.scrollTop).toBe(425);
  contentTop = 900;
  act(() => {
    resizeCallbacks.forEach((callback) => callback());
    jest.advanceTimersByTime(20);
  });
  expect(body.scrollTop).toBe(825);
  fireEvent.wheel(body, { deltaY: -150 });
  contentTop = 1300;
  act(() => {
    resizeCallbacks.forEach((callback) => callback());
    jest.advanceTimersByTime(20);
  });
  expect(body.scrollTop).toBe(825);
});
