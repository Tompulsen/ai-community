import React, { useRef, type CSSProperties } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";
import { useAnchoredPanel } from "../app/utils/use-anchored-panel";

const restoredProperties = (
  [
    [globalThis, "ResizeObserver"],
    [globalThis, "requestAnimationFrame"],
    [globalThis, "cancelAnimationFrame"],
    [window, "innerWidth"],
    [window, "innerHeight"],
    [window, "visualViewport"],
  ] as const
).map(([target, name]) => ({
  target: target as object,
  name: name as string,
  descriptor: Object.getOwnPropertyDescriptor(target, name),
}));

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observe = jest.fn();
  disconnect = jest.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  notify() {
    act(() => this.callback([], this as unknown as ResizeObserver));
  }
}

function rectangle(
  left: number,
  top: number,
  width = 44,
  height = 44,
): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  };
}

let triggerBounds: DOMRect;
let contentHeight = 240;
let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;
let requestFrame: ReturnType<typeof jest.fn>;
let cancelFrame: ReturnType<typeof jest.fn>;

beforeEach(() => {
  triggerBounds = rectangle(600, 500);
  contentHeight = 240;
  frames = new Map();
  nextFrame = 0;
  FakeResizeObserver.instances = [];
  requestFrame = jest.fn((callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  cancelFrame = jest.fn((id: number) => frames.delete(id));
  for (const [target, name, value] of [
    [globalThis, "ResizeObserver", FakeResizeObserver],
    [globalThis, "requestAnimationFrame", requestFrame],
    [globalThis, "cancelAnimationFrame", cancelFrame],
    [window, "innerWidth", 1024],
    [window, "innerHeight", 800],
    [window, "visualViewport", undefined],
  ] as const) {
    Object.defineProperty(target, name, { configurable: true, value });
  }
  jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === "trigger"
        ? triggerBounds
        : rectangle(0, 0, 320, contentHeight);
    });
  jest
    .spyOn(HTMLElement.prototype, "scrollHeight", "get")
    .mockImplementation(() => contentHeight);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  for (const { target, name, descriptor } of restoredProperties) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
  }
});

function nextAnimationFrame() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((callback) => callback(16)));
}

function Harness({
  open = true,
  align = "end",
  placement,
  onRender,
}: {
  open?: boolean;
  align?: "start" | "center" | "end";
  placement?: "auto" | "above" | "below";
  onRender?: (style: CSSProperties) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const style = useAnchoredPanel(open, triggerRef, panelRef, 320, {
    placement,
    align,
    gap: 8,
    maxHeight: 480,
  });
  onRender?.(style);
  return (
    <>
      <button ref={triggerRef} data-testid="trigger">
        Parameters
      </button>
      {open && <div ref={panelRef} data-testid="panel" style={style} />}
    </>
  );
}

test("above placement anchors its bottom and follows a moved trigger on the next frame", () => {
  const onRender = jest.fn<(style: CSSProperties) => void>();
  render(<Harness placement="above" onRender={onRender} />);
  const panel = screen.getByTestId("panel");
  expect(panel).toHaveStyle({
    top: "auto",
    bottom: "308px",
    left: "324px",
    width: "320px",
  });
  expect(FakeResizeObserver.instances[0].observe).toHaveBeenCalledWith(
    screen.getByTestId("trigger"),
  );
  expect(FakeResizeObserver.instances[0].observe).not.toHaveBeenCalledWith(
    panel,
  );
  const unchangedRenders = onRender.mock.calls.length;
  nextAnimationFrame();
  expect(onRender).toHaveBeenCalledTimes(unchangedRenders);

  triggerBounds = rectangle(580, 380);
  nextAnimationFrame();
  expect(panel).toHaveStyle({ top: "auto", bottom: "428px", left: "304px" });
  expect(frames.size).toBe(1);
});

test("closing and unmounting an above panel both cancel its pending follow frame", () => {
  const result = render(<Harness placement="above" />);
  const firstObserver = FakeResizeObserver.instances[0];
  const firstPending = [...frames.keys()][0];
  result.rerender(<Harness placement="above" open={false} />);
  expect(cancelFrame).toHaveBeenCalledWith(firstPending);
  expect(firstObserver.disconnect).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(0);

  result.rerender(<Harness placement="above" />);
  nextAnimationFrame();
  const lastPending = [...frames.keys()][0];
  const lastObserver = FakeResizeObserver.instances.at(-1)!;
  result.unmount();
  expect(cancelFrame).toHaveBeenCalledWith(lastPending);
  expect(lastObserver.disconnect).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(0);
});

test("default automatic placement retains top positioning and observation without polling", () => {
  render(<Harness />);
  const panel = screen.getByTestId("panel");
  const observer = FakeResizeObserver.instances[0];
  expect(panel).toHaveStyle({ top: "252px", bottom: "auto", left: "324px" });
  expect(observer.observe).toHaveBeenCalledWith(screen.getByTestId("trigger"));
  expect(observer.observe).toHaveBeenCalledWith(panel);
  expect(requestFrame).not.toHaveBeenCalled();
  contentHeight = 300;
  observer.notify();
  expect(panel).toHaveStyle({ top: "192px", bottom: "auto" });
  expect(requestFrame).not.toHaveBeenCalled();
});

test("below placement uses the space below even when the full panel also fits above", () => {
  triggerBounds = rectangle(600, 480);
  render(<Harness placement="below" />);
  expect(screen.getByTestId("panel")).toHaveStyle({
    top: "532px",
    bottom: "auto",
    maxHeight: "256px",
  });
  expect(frames.size).toBe(1);
});

test("below placement follows a moving trigger without rerendering unchanged frames", () => {
  triggerBounds = rectangle(600, 400);
  const onRender = jest.fn<(style: CSSProperties) => void>();
  const result = render(<Harness placement="below" onRender={onRender} />);
  const panel = screen.getByTestId("panel");
  expect(panel).toHaveStyle({ top: "452px" });
  const unchangedRenders = onRender.mock.calls.length;
  nextAnimationFrame();
  expect(onRender).toHaveBeenCalledTimes(unchangedRenders);

  triggerBounds = rectangle(600, 420);
  nextAnimationFrame();
  expect(panel).toHaveStyle({ top: "472px" });

  const pendingFrame = [...frames.keys()][0];
  result.rerender(<Harness placement="below" open={false} />);
  expect(cancelFrame).toHaveBeenCalledWith(pendingFrame);
  expect(frames.size).toBe(0);
});

test("below placement falls back above when there is not enough room below", () => {
  triggerBounds = rectangle(600, 700);
  render(<Harness placement="below" />);
  expect(screen.getByTestId("panel")).toHaveStyle({
    top: "452px",
    bottom: "auto",
    maxHeight: "480px",
  });
});

test("below placement stays in the larger space when neither side fits the full panel", () => {
  const viewport = Object.assign(new EventTarget(), {
    offsetLeft: 0,
    offsetTop: 180,
    width: 1024,
    height: 400,
  });
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: viewport,
  });
  triggerBounds = rectangle(600, 300);
  render(<Harness placement="below" />);
  expect(screen.getByTestId("panel")).toHaveStyle({
    top: "352px",
    bottom: "auto",
    maxHeight: "216px",
  });
});

test("center alignment follows the trigger center when its size and position change", () => {
  render(<Harness align="center" />);
  const panel = screen.getByTestId("panel");
  expect(panel).toHaveStyle({
    top: "252px",
    left: "462px",
    width: "320px",
  });

  triggerBounds = rectangle(520, 500, 100);
  FakeResizeObserver.instances[0].notify();
  expect(panel).toHaveStyle({ left: "410px", width: "320px" });
  expect(requestFrame).not.toHaveBeenCalled();
});

test.each([
  { edge: "left", triggerLeft: 16, panelLeft: "12px" },
  { edge: "right", triggerLeft: 964, panelLeft: "692px" },
])(
  "center alignment keeps a panel near the $edge edge inside the viewport",
  ({ triggerLeft, panelLeft }) => {
    triggerBounds = rectangle(triggerLeft, 500);
    render(<Harness align="center" />);
    expect(screen.getByTestId("panel")).toHaveStyle({
      left: panelLeft,
      width: "320px",
    });
  },
);

test("center alignment clamps and shrinks on resize, then recenters when space returns", () => {
  render(<Harness align="center" />);
  const panel = screen.getByTestId("panel");
  expect(panel).toHaveStyle({ left: "462px", width: "320px" });

  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 720,
  });
  act(() => window.dispatchEvent(new Event("resize")));
  expect(panel).toHaveStyle({ left: "388px", width: "320px" });

  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 300,
  });
  act(() => window.dispatchEvent(new Event("resize")));
  expect(panel).toHaveStyle({ left: "12px", width: "276px" });

  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1024,
  });
  act(() => window.dispatchEvent(new Event("resize")));
  expect(panel).toHaveStyle({ left: "462px", width: "320px" });
});

test("center alignment respects an offset visual viewport and its resize events", () => {
  const viewport = Object.assign(new EventTarget(), {
    offsetLeft: 100,
    offsetTop: 0,
    width: 600,
    height: 800,
  });
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: viewport,
  });
  triggerBounds = rectangle(180, 500);
  render(<Harness align="center" />);
  const panel = screen.getByTestId("panel");
  expect(panel).toHaveStyle({ left: "112px", width: "320px" });

  triggerBounds = rectangle(400, 500);
  viewport.width = 400;
  act(() => viewport.dispatchEvent(new Event("resize")));
  expect(panel).toHaveStyle({ left: "168px", width: "320px" });
});
