import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { ReasoningEffortSlider } from "../app/components/reasoning-effort-slider";
import {
  drawEffortBackground,
  fillBackgroundFor,
} from "../app/utils/reasoning-effort-motion";

function canvasContext() {
  const gradient = { addColorStop: jest.fn() };
  return {
    clearRect: jest.fn(),
    createLinearGradient: jest.fn(() => gradient),
    createRadialGradient: jest.fn(() => gradient),
    fillRect: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    setTransform: jest.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalCompositeOperation: "source-over",
  };
}

class CanvasResizeObserver {
  static instances: CanvasResizeObserver[] = [];
  observe = jest.fn();
  disconnect = jest.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    CanvasResizeObserver.instances.push(this);
  }

  notify() {
    act(() => this.callback([], this as unknown as ResizeObserver));
  }
}

const observerDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "ResizeObserver",
);
let size = { width: 320, height: 40 };
let drawing = canvasContext();

beforeEach(() => {
  size = { width: 320, height: 40 };
  drawing = canvasContext();
  CanvasResizeObserver.instances = [];
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: CanvasResizeObserver,
  });
  jest
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockImplementation(function (this: HTMLElement) {
      return this instanceof HTMLCanvasElement ? size.width : 0;
    });
  jest
    .spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockImplementation(function (this: HTMLElement) {
      return this instanceof HTMLCanvasElement ? size.height : 0;
    });
  jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(drawing as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  if (observerDescriptor)
    Object.defineProperty(globalThis, "ResizeObserver", observerDescriptor);
  else Reflect.deleteProperty(globalThis, "ResizeObserver");
});

test("seven bands cover the entire track while gradients and glow follow the fill endpoint", () => {
  drawEffortBackground(
    drawing as unknown as CanvasRenderingContext2D,
    320,
    40,
    0.5,
  );
  expect(drawing.clearRect).toHaveBeenCalledWith(0, 0, 320, 40);
  expect(drawing.fillRect.mock.calls).toEqual([
    [0, 0, 320, 40],
    [0, 0, 320, 40],
    [0, 0, 320, 40],
  ]);
  expect(drawing.beginPath).toHaveBeenCalledTimes(7);
  expect(drawing.moveTo).toHaveBeenCalledTimes(7);
  expect(drawing.stroke).toHaveBeenCalledTimes(7);
  expect(drawing.createLinearGradient.mock.calls).toEqual([
    [0, 0, 180, 0],
    [0, 0, 180, 0],
  ]);
  expect(drawing.createRadialGradient).toHaveBeenCalledWith(
    108,
    28,
    0,
    108,
    28,
    46,
  );
  expect(drawing.save).toHaveBeenCalledTimes(1);
  expect(drawing.restore).toHaveBeenCalledTimes(1);
});

test.each([
  [0, 40, 24],
  [1, 320, 192],
])(
  "position %s paints through its circular low cap or the full track endpoint",
  (position, endpoint, glowCenter) => {
    drawEffortBackground(
      drawing as unknown as CanvasRenderingContext2D,
      320,
      40,
      position,
    );
    expect(drawing.createLinearGradient.mock.calls).toEqual([
      [0, 0, endpoint, 0],
      [0, 0, endpoint, 0],
    ]);
    expect(drawing.createRadialGradient).toHaveBeenCalledWith(
      glowCenter,
      28,
      0,
      glowCenter,
      28,
      46,
    );
  },
);

test.each([
  [0, 40],
  [320, 0],
])("a %s by %s track performs no drawing", (width, height) => {
  drawEffortBackground(
    drawing as unknown as CanvasRenderingContext2D,
    width,
    height,
    0.5,
  );
  expect(drawing.clearRect).not.toHaveBeenCalled();
  expect(drawing.createLinearGradient).not.toHaveBeenCalled();
  expect(drawing.stroke).not.toHaveBeenCalled();
});

test.each([
  [false, 32, 64],
  [true, 28, 56],
])(
  "compact=%s repaints on observed resize, value and window resize, then releases its listeners",
  (compact, trackHeight, bitmapHeight) => {
    size = { width: 320, height: trackHeight };
    jest.replaceProperty(window, "devicePixelRatio", 3);
    const frame = jest.spyOn(window, "requestAnimationFrame");
    const addListener = jest.spyOn(window, "addEventListener");
    const removeListener = jest.spyOn(window, "removeEventListener");
    const onChange = jest.fn();
    const { container, rerender, unmount } = render(
      <ReasoningEffortSlider
        value="low"
        onChange={onChange}
        compact={compact}
      />,
    );
    const canvas = container.querySelector("canvas")!;
    const observer = CanvasResizeObserver.instances[0];
    expect(observer.observe).toHaveBeenCalledWith(canvas);
    expect(drawing.clearRect).toHaveBeenCalledWith(0, 0, 320, trackHeight);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(bitmapHeight);
    expect(drawing.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);

    drawing.clearRect.mockClear();
    size = { width: 480, height: trackHeight };
    observer.notify();
    expect(drawing.clearRect).toHaveBeenCalledTimes(1);
    expect(drawing.clearRect).toHaveBeenLastCalledWith(0, 0, 480, trackHeight);
    expect(canvas.width).toBe(960);

    drawing.clearRect.mockClear();
    rerender(
      <ReasoningEffortSlider
        value="ultra"
        onChange={onChange}
        compact={compact}
      />,
    );
    expect(drawing.clearRect).toHaveBeenCalledTimes(1);
    expect(drawing.createLinearGradient).toHaveBeenLastCalledWith(0, 0, 480, 0);

    size = { width: 200, height: trackHeight };
    fireEvent.resize(window);
    expect(drawing.clearRect).toHaveBeenLastCalledWith(0, 0, 200, trackHeight);
    expect(drawing.createLinearGradient).toHaveBeenLastCalledWith(0, 0, 200, 0);
    expect(frame).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    const resizeListener = addListener.mock.calls.find(
      ([event]) => event === "resize",
    )![1];
    unmount();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("resize", resizeListener);
    drawing.clearRect.mockClear();
    fireEvent.resize(window);
    expect(drawing.clearRect).not.toHaveBeenCalled();
  },
);

test("a missing canvas context keeps the CSS fallback and keyboard selection usable", () => {
  jest.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
  // jsdom drops modern HSL gradients, so inspect the CSS value React assigns.
  const background = jest.spyOn(
    CSSStyleDeclaration.prototype,
    "background",
    "set",
  );
  const onChange = jest.fn();
  const { container, rerender } = render(
    <ReasoningEffortSlider value="low" onChange={onChange} compact />,
  );
  const canvas = container.querySelector("canvas")!;
  expect(background).toHaveBeenLastCalledWith(fillBackgroundFor(0));
  expect(canvas).toHaveAttribute("aria-hidden", "true");
  const slider = screen.getByRole("slider", { name: "推理强度" });
  slider.focus();
  fireEvent.keyDown(slider, { key: "End" });
  expect(onChange).toHaveBeenCalledWith("ultra");
  rerender(<ReasoningEffortSlider value="ultra" onChange={onChange} compact />);
  expect(background).toHaveBeenLastCalledWith(fillBackgroundFor(1));
  expect(slider).toHaveValue("5");
  expect(slider).toHaveFocus();
  expect(drawing.clearRect).not.toHaveBeenCalled();
});
