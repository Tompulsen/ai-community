import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";
import { SmoothPanelContent } from "../app/components/smooth-panel-content";

const observerDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "ResizeObserver",
);
const animateDescriptor = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "animate",
);
const mediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");

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

type PanelAnimation = {
  frames: Keyframe[];
  currentHeight: number;
  currentTranslation: number;
  running: boolean;
  onfinish: null | (() => void);
  cancel: ReturnType<typeof jest.fn>;
  finish: () => void;
};

let animations: PanelAnimation[];
let activeAnimations: WeakMap<Element, PanelAnimation>;
let reducedMotion = false;
let viewportWidth = 320;
let mediaListeners: Set<() => void>;
let animate: ReturnType<typeof jest.fn>;

function naturalHeight(element: HTMLElement) {
  return Number(
    element
      .querySelector("[data-natural-height]")
      ?.getAttribute("data-natural-height") ?? 0,
  );
}

function renderedHeight(element: HTMLElement) {
  const animation = activeAnimations.get(element);
  if (animation?.running) return animation.currentHeight;
  if (element.style.height && element.style.height !== "auto")
    return Number.parseFloat(element.style.height);
  const maximum = Number.parseFloat(element.style.maxHeight) || Infinity;
  return Math.min(naturalHeight(element), maximum);
}

beforeEach(() => {
  animations = [];
  activeAnimations = new WeakMap();
  mediaListeners = new Set();
  reducedMotion = false;
  viewportWidth = 320;
  FakeResizeObserver.instances = [];
  document.body.classList.remove("reduce-motion");
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: FakeResizeObserver,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      get matches() {
        return reducedMotion;
      },
      addEventListener: (_name: string, listener: () => void) =>
        mediaListeners.add(listener),
      removeEventListener: (_name: string, listener: () => void) =>
        mediaListeners.delete(listener),
    }),
  });
  animate = jest.fn(function (
    this: HTMLElement,
    frames: Keyframe[],
  ): Animation {
    const element = this;
    const animation: PanelAnimation = {
      frames,
      currentHeight: Number.parseFloat(String(frames[0].height)),
      currentTranslation: Number(
        String(frames[0].transform).match(/translateY\(([-.\d]+)px\)/)?.[1] ??
          0,
      ),
      running: true,
      onfinish: null,
      cancel: jest.fn(() => {
        animation.running = false;
        if (activeAnimations.get(element) === animation)
          activeAnimations.delete(element);
      }),
      finish: () => {
        animation.running = false;
        if (activeAnimations.get(element) === animation)
          activeAnimations.delete(element);
        animation.onfinish?.();
      },
    };
    animations.push(animation);
    activeAnimations.set(element, animation);
    return animation as unknown as Animation;
  });
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: animate,
  });
  jest
    .spyOn(HTMLElement.prototype, "offsetHeight", "get")
    .mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("test-panel")
        ? renderedHeight(this)
        : naturalHeight(this);
    });
  jest
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockImplementation(() => viewportWidth);
  jest
    .spyOn(HTMLElement.prototype, "offsetWidth", "get")
    .mockImplementation(() => viewportWidth);
  jest
    .spyOn(HTMLElement.prototype, "offsetTop", "get")
    .mockImplementation(function (this: HTMLElement) {
      return Number(this.getAttribute("data-layout-top") ?? 0);
    });
  jest
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const movement = activeAnimations.get(this);
      const translation = movement?.running ? movement.currentTranslation : 0;
      const top = this.offsetTop + translation;
      return {
        x: 0,
        y: top,
        left: 0,
        right: viewportWidth,
        top,
        bottom: top + 32,
        width: viewportWidth,
        height: 32,
        toJSON: () => ({}),
      };
    });
});

afterEach(() => {
  cleanup();
  document.body.classList.remove("reduce-motion");
  jest.restoreAllMocks();
  for (const [target, name, descriptor] of [
    [globalThis, "ResizeObserver", observerDescriptor],
    [Element.prototype, "animate", animateDescriptor],
    [window, "matchMedia", mediaDescriptor],
  ] as const) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
  }
});

function panel(height: number, enabled?: boolean, layoutTop?: number) {
  return (
    <SmoothPanelContent enabled={enabled} className="test-panel">
      <div data-natural-height={height}>
        <input aria-label="Draft" defaultValue="Keep this draft" />
        {layoutTop !== undefined && (
          <div data-panel-layout data-layout-top={layoutTop}>
            Limits
          </div>
        )}
      </div>
    </SmoothPanelContent>
  );
}

function renderPanel(
  height = 140,
  enabled?: boolean,
  initialLayoutTop?: number,
) {
  let layoutTop = initialLayoutTop;
  const result = render(panel(height, enabled, layoutTop));
  const viewport = result.container.firstElementChild as HTMLDivElement;
  return {
    ...result,
    viewport,
    resize(nextHeight: number, nextLayoutTop = layoutTop) {
      layoutTop = nextLayoutTop;
      result.rerender(panel(nextHeight, enabled, layoutTop));
      FakeResizeObserver.instances[0]?.notify();
    },
  };
}

test("resizing is opt-in, leaving ordinary panels unsized and unanimated", () => {
  const result = renderPanel();
  const input = screen.getByRole("textbox", { name: "Draft" });
  result.resize(320);
  expect(result.viewport.style.height).toBe("");
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
  expect(input).toHaveValue("Keep this draft");
  expect(animate).not.toHaveBeenCalled();
  expect(FakeResizeObserver.instances).toHaveLength(0);
});

test("first measurement is immediate and repeated unchanged observations do not animate", () => {
  const { viewport } = renderPanel(140, true);
  expect(viewport.style.height).toBe("140px");
  FakeResizeObserver.instances[0].notify();
  expect(animate).not.toHaveBeenCalled();
  expect(viewport).not.toHaveAttribute("data-resizing");
});

test("a hidden dialog waits for its first visible measurement before setting a height", () => {
  viewportWidth = 0;
  const result = renderPanel(0, true);
  expect(result.viewport.style.height).toBe("");
  viewportWidth = 320;
  result.resize(140);
  expect(result.viewport.style.height).toBe("140px");
  expect(animate).not.toHaveBeenCalled();
  expect(result.viewport).not.toHaveAttribute("data-resizing");
});

test("content grows from its rendered height and preserves the existing controls", () => {
  const result = renderPanel(140, true);
  const input = screen.getByRole("textbox", { name: "Draft" });
  result.resize(300);
  expect(result.viewport.style.height).toBe("300px");
  expect(animations[0].frames).toEqual([
    { height: "140px" },
    { height: "300px" },
  ]);
  expect(result.viewport).toHaveAttribute("data-resizing", "true");
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
  act(() => animations[0].finish());
  expect(result.viewport.offsetHeight).toBe(300);
  expect(result.viewport).not.toHaveAttribute("data-resizing");
});

test("a rapid reversal continues from the visible height and ignores stale completion", () => {
  const result = renderPanel(140, true);
  result.resize(320);
  const first = animations[0];
  first.currentHeight = 210;
  result.resize(140);
  const second = animations[1];
  expect(first.cancel).toHaveBeenCalledTimes(1);
  expect(second.frames).toEqual([{ height: "210px" }, { height: "140px" }]);
  act(() => first.onfinish?.());
  expect(result.viewport).toHaveAttribute("data-resizing", "true");
  act(() => second.finish());
  expect(result.viewport.style.height).toBe("140px");
  expect(result.viewport).not.toHaveAttribute("data-resizing");
});

test("a following entry keeps its original visible position as the content above expands", () => {
  const result = renderPanel(140, true, 100);
  const entry = screen.getByText("Limits");
  result.resize(300, 260);
  const movement = animations.find(
    (animation) => animation.frames[0].transform,
  )!;
  expect(movement.frames).toEqual([
    { transform: "translateY(-160px)" },
    { transform: "translateY(0)" },
  ]);
  expect(entry.getBoundingClientRect().top).toBe(100);
  const animationCount = animations.length;
  FakeResizeObserver.instances[0].notify();
  expect(animations).toHaveLength(animationCount);
  expect(movement.cancel).not.toHaveBeenCalled();
  act(() => movement.finish());
  expect(entry.getBoundingClientRect().top).toBe(260);
});

test("reversing a following entry continues from its visible position and unmount cancels it", () => {
  const result = renderPanel(140, true, 100);
  const entry = screen.getByText("Limits");
  result.resize(300, 260);
  const first = animations.find((animation) => animation.frames[0].transform)!;
  first.currentTranslation = -80;
  expect(entry.getBoundingClientRect().top).toBe(180);
  result.resize(140, 100);
  const second = animations
    .filter((animation) => animation.frames[0].transform)
    .at(-1)!;
  expect(first.cancel).toHaveBeenCalledTimes(1);
  expect(second.frames).toEqual([
    { transform: "translateY(80px)" },
    { transform: "translateY(0)" },
  ]);
  expect(entry.getBoundingClientRect().top).toBe(180);
  act(() => first.onfinish?.());
  result.unmount();
  expect(second.cancel).toHaveBeenCalledTimes(1);
});

test("the final height respects the available maximum without removing content", () => {
  const result = renderPanel(140, true);
  result.viewport.style.maxHeight = "240px";
  result.resize(400);
  expect(animations[0].frames).toEqual([
    { height: "140px" },
    { height: "240px" },
  ]);
  act(() => animations[0].finish());
  expect(result.viewport.offsetHeight).toBe(240);
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue(
    "Keep this draft",
  );
});

test.each(["system", "app"])(
  "%s reduced motion presents the final size without a spatial animation",
  (preference) => {
    if (preference === "system") reducedMotion = true;
    else document.body.classList.add("reduce-motion");
    const result = renderPanel(140, true);
    result.resize(300);
    expect(result.viewport.style.height).toBe("300px");
    expect(result.viewport).not.toHaveAttribute("data-resizing");
    expect(animate).not.toHaveBeenCalled();
  },
);

test("enabling reduced motion during a transition cancels it at the final size", () => {
  const result = renderPanel(140, true);
  result.resize(300);
  animations[0].currentHeight = 210;
  reducedMotion = true;
  act(() => mediaListeners.forEach((listener) => listener()));
  expect(animations[0].cancel).toHaveBeenCalledTimes(1);
  expect(result.viewport.offsetHeight).toBe(300);
  expect(result.viewport).not.toHaveAttribute("data-resizing");
  expect(animate).toHaveBeenCalledTimes(1);
});

test("unmounting cancels motion, disconnects observation and clears temporary sizing", () => {
  const result = renderPanel(140, true);
  result.resize(300);
  const observer = FakeResizeObserver.instances[0];
  const animation = animations[0];
  result.unmount();
  expect(animation.cancel).toHaveBeenCalledTimes(1);
  expect(observer.disconnect).toHaveBeenCalledTimes(1);
  expect(mediaListeners.size).toBe(0);
  expect(result.viewport.style.height).toBe("");
  expect(result.viewport).not.toHaveAttribute("data-resizing");
});
