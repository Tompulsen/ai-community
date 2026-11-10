import React, { useRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { useStreamTailReveal } from "../app/components/use-stream-tail-reveal";

const savedProperties = (
  [
    [window, "CSS"],
    [window, "Highlight"],
    [window, "matchMedia"],
    [Element.prototype, "animate"],
    [document, "hidden"],
  ] as const
).map(([target, name]) => ({
  target,
  name,
  descriptor: Object.getOwnPropertyDescriptor(target, name),
}));

type TailAnimation = {
  target: HTMLElement;
  cancel: ReturnType<typeof jest.fn>;
  onfinish: (() => void) | null;
};

let registry: Map<string, Set<Range>>;
let animations: TailAnimation[];
let reducedMotion: boolean;
let hidden: boolean;
let mediaListeners: Set<() => void>;
let animate: ReturnType<typeof jest.fn>;

beforeEach(() => {
  registry = new Map();
  animations = [];
  reducedMotion = false;
  hidden = false;
  mediaListeners = new Set();
  document.body.classList.remove("reduce-motion");
  document.getSelection()?.removeAllRanges();
  animate = jest.fn(function (this: HTMLElement): Animation {
    const animation: TailAnimation = {
      target: this,
      cancel: jest.fn(),
      onfinish: null,
    };
    animations.push(animation);
    return animation as unknown as Animation;
  });
  for (const [target, name, value] of [
    [window, "CSS", { highlights: registry, registerProperty: jest.fn() }],
    [window, "Highlight", Set],
    [
      window,
      "matchMedia",
      () => ({
        get matches() {
          return reducedMotion;
        },
        addEventListener: (_event: string, listener: () => void) =>
          mediaListeners.add(listener),
        removeEventListener: (_event: string, listener: () => void) =>
          mediaListeners.delete(listener),
      }),
    ],
    [Element.prototype, "animate", animate],
  ] as const) {
    Object.defineProperty(target, name, { configurable: true, value });
  }
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
});

afterEach(() => {
  cleanup();
  document.body.classList.remove("reduce-motion");
  document.getSelection()?.removeAllRanges();
  jest.restoreAllMocks();
  for (const { target, name, descriptor } of savedProperties) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
  }
});

function Fixture({
  content,
  active = true,
  element = "p",
  id = "response",
}: {
  content: string;
  active?: boolean;
  element?: "p" | "code" | "a";
  id?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useStreamTailReveal(root, content, active);
  return (
    <div ref={root} data-testid={id}>
      {React.createElement(element, null, content)}
    </div>
  );
}

function activeRanges() {
  return [...registry.values()].flatMap((highlight) => [...highlight]);
}

test("saved history and reopened running messages never replay existing text", () => {
  const result = render(<Fixture content="Saved response" active={false} />);
  expect(animate).not.toHaveBeenCalled();
  result.rerender(<Fixture content="Saved response edited" active={false} />);
  expect(animate).not.toHaveBeenCalled();
  expect(screen.getByText("Saved response edited")).toBeInTheDocument();
  render(<Fixture content="Reopened running response" />);
  expect(animate).not.toHaveBeenCalled();
});

test("only new plain text fades while the existing DOM and earlier ranges remain stable", () => {
  const result = render(<Fixture content="Existing response" />);
  const root = screen.getByTestId("response");
  const paragraph = root.firstElementChild!;
  const text = paragraph.firstChild;
  result.rerender(<Fixture content="Existing response grows" />);
  const first = activeRanges()[0];
  expect(first.toString()).toBe(" grows");

  result.rerender(<Fixture content="Existing response grows again" />);
  expect(root.firstElementChild).toBe(paragraph);
  expect(paragraph.firstChild).toBe(text);
  expect(paragraph.childNodes).toHaveLength(1);
  expect(first.toString()).toBe(" grows");
  expect(activeRanges().map((range) => range.toString())).toEqual([
    " grows",
    " again",
  ]);
  expect(animations).toHaveLength(2);
});

test("parallel messages share highlight collections without clearing each other's ranges", () => {
  const first = render(<Fixture id="first" content="One" />);
  const second = render(<Fixture id="second" content="Two" />);
  first.rerender(<Fixture id="first" content="One tail" />);
  second.rerender(<Fixture id="second" content="Two suffix" />);
  expect(registry.size).toBe(1);
  expect(activeRanges().map((range) => range.toString())).toEqual([
    " tail",
    " suffix",
  ]);
  expect(animations[0].target).toBe(screen.getByTestId("first"));
  expect(animations[1].target).toBe(screen.getByTestId("second"));

  first.unmount();
  expect(activeRanges().map((range) => range.toString())).toEqual([" suffix"]);
  expect(animations[1].cancel).not.toHaveBeenCalled();
  act(() => animations[1].onfinish?.());
  expect(registry.size).toBe(0);
});

test.each([false, true])(
  "a selected response remains copyable while text grows, reverse=%s",
  (reverse) => {
    const result = render(<Fixture content="Existing response" />);
    result.rerender(<Fixture content="Existing response grows" />);
    const paragraph = screen.getByTestId("response").firstElementChild!;
    const text = paragraph.firstChild!;
    const selection = document.getSelection()!;
    selection.setBaseAndExtent(text, reverse ? 8 : 0, text, reverse ? 0 : 8);
    fireEvent(document, new Event("selectionchange"));
    expect(registry.size).toBe(0);
    expect(animations[0].cancel).toHaveBeenCalledTimes(1);

    result.rerender(<Fixture content="Existing response grows again" />);
    expect(selection.toString()).toBe("Existing");
    expect(selection.anchorOffset).toBe(reverse ? 8 : 0);
    expect(selection.focusOffset).toBe(reverse ? 0 : 8);
    expect(paragraph.firstChild).toBe(text);
    expect(registry.size).toBe(0);
    expect(animations).toHaveLength(1);
  },
);

test("actively clearing a selection does not bring it back on the next stream update", () => {
  const result = render(<Fixture content="Existing response" />);
  result.rerender(<Fixture content="Existing response grows" />);
  const text = screen.getByTestId("response").firstElementChild!.firstChild!;
  const selection = document.getSelection()!;
  selection.setBaseAndExtent(text, 0, text, 8);
  fireEvent(document, new Event("selectionchange"));
  selection.removeAllRanges();
  fireEvent(document, new Event("selectionchange"));

  result.rerender(<Fixture content="Existing response grows again" />);
  expect(selection.rangeCount).toBe(0);
  expect(selection.toString()).toBe("");
  expect(animations).toHaveLength(2);
});

test("clicking to collapse a selection does not restore it before selectionchange arrives", () => {
  const result = render(<Fixture content="Existing response" />);
  result.rerender(<Fixture content="Existing response grows" />);
  const root = screen.getByTestId("response");
  const text = root.firstElementChild!.firstChild!;
  const selection = document.getSelection()!;
  selection.setBaseAndExtent(text, 0, text, 8);
  fireEvent(document, new Event("selectionchange"));
  fireEvent.pointerDown(root);
  selection.collapse(text, 0);

  result.rerender(<Fixture content="Existing response grows again" />);
  expect(selection.isCollapsed).toBe(true);
  expect(selection.toString()).toBe("");
  expect(animations).toHaveLength(2);
});

test.each(["code", "a"] as const)(
  "leaves %s content and Markdown structural changes to the existing renderer",
  (element) => {
    const result = render(<Fixture content="Existing" element={element} />);
    const node = screen.getByTestId("response").firstElementChild;
    result.rerender(<Fixture content="Existing new" element={element} />);
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByTestId("response").firstElementChild).toBe(node);
    result.rerender(<Fixture content="Existing **bold**" />);
    expect(animate).not.toHaveBeenCalled();
  },
);

test("a burst has a bounded tail and repeated frames cannot create unlimited ranges or nodes", () => {
  const result = render(<Fixture content="" />);
  let content = "A".repeat(1000);
  result.rerender(<Fixture content={content} />);
  expect(activeRanges()[0].toString().length).toBeLessThanOrEqual(256);
  for (let index = 0; index < 30; index++) {
    content += ` tail${index}`;
    result.rerender(<Fixture content={content} />);
  }
  expect(activeRanges().length).toBeLessThanOrEqual(8);
  expect(animations.length).toBeLessThanOrEqual(8);
  expect(screen.getByTestId("response").querySelectorAll("*")).toHaveLength(1);
  expect(screen.getByText(content)).toBeInTheDocument();
});

test.each(["application", "system", "hidden"])(
  "%s preference clears running motion and leaves all content visible",
  async (preference) => {
    const result = render(<Fixture content="Existing" />);
    result.rerender(<Fixture content="Existing tail" />);
    expect(animations).toHaveLength(1);
    await act(async () => {
      if (preference === "application")
        document.body.classList.add("reduce-motion");
      else if (preference === "system") {
        reducedMotion = true;
        mediaListeners.forEach((listener) => listener());
      } else {
        hidden = true;
        document.dispatchEvent(new Event("visibilitychange"));
      }
    });
    expect(registry.size).toBe(0);
    expect(animations[0].cancel).toHaveBeenCalledTimes(1);
    result.rerender(<Fixture content="Existing tail more" />);
    expect(animations).toHaveLength(1);
    expect(screen.getByText("Existing tail more")).toBeInTheDocument();
  },
);

test("content replacement and unmount clear animation, registry and preference listeners", () => {
  const result = render(<Fixture content="Existing" />);
  result.rerender(<Fixture content="Existing tail" />);
  result.rerender(<Fixture content="A replacement" />);
  expect(registry.size).toBe(0);
  expect(animations[0].cancel).toHaveBeenCalledTimes(1);
  expect(mediaListeners.size).toBe(0);
  result.rerender(<Fixture content="A replacement grows" />);
  result.unmount();
  expect(animations[1].cancel).toHaveBeenCalledTimes(1);
  expect(registry.size).toBe(0);
  expect(mediaListeners.size).toBe(0);
});

test("browsers without native highlights keep normal text with no replacement markup", () => {
  Object.defineProperty(window, "CSS", { configurable: true, value: {} });
  const result = render(<Fixture content="Existing" />);
  result.rerender(<Fixture content="Existing tail" />);
  expect(animate).not.toHaveBeenCalled();
  expect(screen.getByText("Existing tail")).toBeInTheDocument();
  expect(screen.getByTestId("response").querySelectorAll("*")).toHaveLength(1);
});

test("native animation rejection falls back to ordinary text without leaving ranges or retrying", () => {
  animate.mockImplementation(() => {
    throw new Error("Unsupported animation property");
  });
  const result = render(<Fixture content="Existing" />);
  expect(() =>
    result.rerender(<Fixture content="Existing tail" />),
  ).not.toThrow();
  expect(registry.size).toBe(0);
  result.rerender(<Fixture content="Existing tail more" />);
  expect(animate).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Existing tail more")).toBeInTheDocument();
});
