import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { jest } from "@jest/globals";

for (const icon of [
  "three-dots",
  "close",
  "eye",
  "eye-off",
  "down",
  "confirm",
  "cancel",
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
    Export: { Image: { Modal: "Image" } },
  },
}));
jest.unstable_mockModule("@/app/components/emoji", () => ({
  Avatar: () => null,
}));
jest.unstable_mockModule("../app/components/ui-lib.module.scss", () => ({
  default: {
    popover: "popover",
    "popover-content": "popover-content",
    "popover-mask": "popover-mask",
    "modal-container": "modal-container",
    "modal-container-max": "modal-container-max",
  },
}));
const { Modal, Popover } = await import("../app/components/ui-lib");

const animateDescriptor = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "animate",
);
const mediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
const nativeComputedStyle = window.getComputedStyle.bind(window);

type VisibleStyle = Partial<
  Record<"opacity" | "transform" | "width" | "height", string>
>;
type SurfaceAnimation = {
  target: HTMLElement;
  frames: Keyframe[];
  visible: VisibleStyle;
  cancel: ReturnType<typeof jest.fn>;
  onfinish: null | (() => void);
  finish: () => void;
};

let animations: SurfaceAnimation[];
let activeAnimations: WeakMap<HTMLElement, SurfaceAnimation>;
let reducedMotion = false;
let mediaListeners: Set<() => void>;
let animate: ReturnType<typeof jest.fn>;

function naturalSize(element: HTMLElement) {
  return element.classList.contains("modal-container-max")
    ? { width: 960, height: 720 }
    : { width: 640, height: 420 };
}

beforeEach(() => {
  animations = [];
  activeAnimations = new WeakMap();
  mediaListeners = new Set();
  reducedMotion = false;
  document.body.classList.remove("reduce-motion");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return query === "(prefers-reduced-motion: reduce)" && reducedMotion;
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
    const animation: SurfaceAnimation = {
      target: element,
      frames,
      visible: Object.fromEntries(
        ["opacity", "transform", "width", "height"]
          .filter((property) => frames[0][property] !== undefined)
          .map((property) => [property, String(frames[0][property])]),
      ),
      onfinish: null,
      cancel: jest.fn(() => {
        if (activeAnimations.get(element) === animation)
          activeAnimations.delete(element);
      }),
      finish: () => {
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
    .spyOn(window, "getComputedStyle")
    .mockImplementation((element, pseudo) => {
      const computed = nativeComputedStyle(element, pseudo);
      const html = element as HTMLElement;
      const size = naturalSize(html);
      const values: VisibleStyle = {
        opacity: computed.opacity || "1",
        transform: computed.transform || "none",
        ...(html.hasAttribute("data-modal-dialog")
          ? { width: `${size.width}px`, height: `${size.height}px` }
          : {}),
        ...activeAnimations.get(html)?.visible,
      };
      return new Proxy(computed, {
        get(target, property) {
          if (property === "getPropertyValue") {
            return (name: string) =>
              values[name as keyof VisibleStyle] ??
              target.getPropertyValue(name);
          }
          if (property in values) return values[property as keyof VisibleStyle];
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });
  jest
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const size = naturalSize(this);
      const visible = activeAnimations.get(this)?.visible;
      const width = Number.parseFloat(visible?.width ?? String(size.width));
      const height = Number.parseFloat(visible?.height ?? String(size.height));
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON: () => ({}),
      };
    });
});

afterEach(() => {
  cleanup();
  document.body.classList.remove("reduce-motion");
  jest.restoreAllMocks();
  for (const [target, name, descriptor] of [
    [Element.prototype, "animate", animateDescriptor],
    [window, "matchMedia", mediaDescriptor],
  ] as const) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
  }
});

function popover(open: boolean) {
  return (
    <Popover
      open={open}
      content={
        <input aria-label="Popover draft" defaultValue="Keep this draft" />
      }
    >
      <button>Open details</button>
    </Popover>
  );
}

function modal() {
  return (
    <Modal title="Preview">
      <input aria-label="Modal draft" defaultValue="Keep this draft" />
    </Modal>
  );
}

async function enableReducedMotion(preference: "app" | "system") {
  await act(async () => {
    if (preference === "app") document.body.classList.add("reduce-motion");
    else {
      reducedMotion = true;
      mediaListeners.forEach((listener) => listener());
    }
  });
}

test("a closing popover stays mounted until its exit ends but immediately releases interaction", () => {
  const result = render(popover(true));
  const draft = screen.getByRole("textbox", { name: "Popover draft" });
  const panel = draft.parentElement!;
  draft.focus();
  result.rerender(popover(false));

  expect(panel).toBeInTheDocument();
  expect(panel).toHaveAttribute("inert");
  expect(panel).toHaveAttribute("aria-hidden", "true");
  expect(draft).not.toHaveFocus();
  expect(
    screen.queryByRole("textbox", { name: "Popover draft" }),
  ).not.toBeInTheDocument();
  const mask = result.container.querySelector<HTMLElement>(".popover-mask");
  expect(!mask || getComputedStyle(mask).pointerEvents === "none").toBe(true);
  expect(animations).toHaveLength(1);
  expect(animations[0].target).toBe(panel);

  act(() => animations[0].finish());
  expect(panel).not.toBeInTheDocument();
});

test("reopening a closing popover preserves its node and draft and continues from its visible style", () => {
  const result = render(popover(true));
  const draft = screen.getByRole("textbox", { name: "Popover draft" });
  const panel = draft.parentElement!;
  fireEvent.change(draft, { target: { value: "An unfinished draft" } });
  result.rerender(popover(false));
  const closing = animations[0];
  closing.visible = {
    opacity: "0.4",
    transform: "matrix(0.99, 0, 0, 0.99, 0, 2)",
  };

  result.rerender(popover(true));
  expect(closing.cancel).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox", { name: "Popover draft" })).toBe(draft);
  expect(draft).toHaveValue("An unfinished draft");
  expect(draft.parentElement).toBe(panel);
  expect(panel).not.toHaveAttribute("inert");
  expect(panel).not.toHaveAttribute("aria-hidden");
  const reopening = animations.at(-1)!;
  expect(reopening).not.toBe(closing);
  expect(Number(reopening.frames[0].opacity)).toBe(0.4);
  expect(reopening.frames[0].transform).toBe(closing.visible.transform);

  result.unmount();
  expect(reopening.cancel).toHaveBeenCalledTimes(1);
  expect(mediaListeners.size).toBe(0);
});

test.each(["app", "system"] as const)(
  "%s reduced motion closes a popover without retaining its surface",
  (preference) => {
    if (preference === "app") document.body.classList.add("reduce-motion");
    else reducedMotion = true;
    const result = render(popover(true));
    const draft = screen.getByRole("textbox", { name: "Popover draft" });
    result.rerender(popover(false));
    expect(draft).not.toBeInTheDocument();
    expect(animate).not.toHaveBeenCalled();
  },
);

test.each(["app", "system"] as const)(
  "enabling %s reduced motion completes an in-progress popover exit immediately",
  async (preference) => {
    const result = render(popover(true));
    const draft = screen.getByRole("textbox", { name: "Popover draft" });
    result.rerender(popover(false));
    const closing = animations[0];
    expect(draft).toBeInTheDocument();

    await enableReducedMotion(preference);
    expect(closing.cancel).toHaveBeenCalled();
    expect(draft).not.toBeInTheDocument();
  },
);

test("a modal first opens at its final size, then maximizes without remounting its child", () => {
  render(modal());
  const dialog = screen.getByRole("dialog", { name: "Preview" });
  const draft = screen.getByRole("textbox", { name: "Modal draft" });
  expect(animate).not.toHaveBeenCalled();
  fireEvent.change(draft, { target: { value: "An unfinished draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Full Screen" }));

  expect(animations).toHaveLength(1);
  expect(animations[0].target).toBe(dialog);
  expect(animations[0].frames[0]).toMatchObject({
    width: "640px",
    height: "420px",
  });
  expect(animations[0].frames.at(-1)).toMatchObject({
    width: "960px",
    height: "720px",
  });
  expect(screen.getByRole("textbox", { name: "Modal draft" })).toBe(draft);
  expect(draft).toHaveValue("An unfinished draft");
  act(() => animations[0].finish());
  expect(dialog).not.toHaveAttribute("data-modal-resizing");
});

test("restoring during maximization continues from the visible dimensions", () => {
  render(modal());
  const dialog = screen.getByRole("dialog", { name: "Preview" });
  const draft = screen.getByRole("textbox", { name: "Modal draft" });
  fireEvent.click(screen.getByRole("button", { name: "Full Screen" }));
  const maximizing = animations[0];
  maximizing.visible = { width: "800px", height: "600px" };
  fireEvent.click(screen.getByRole("button", { name: "Exit Full Screen" }));

  expect(maximizing.cancel).toHaveBeenCalledTimes(1);
  const restoring = animations.at(-1)!;
  expect(restoring).not.toBe(maximizing);
  expect(restoring.frames[0]).toMatchObject({
    width: "800px",
    height: "600px",
  });
  expect(restoring.frames.at(-1)).toMatchObject({
    width: "640px",
    height: "420px",
  });
  expect(screen.getByRole("dialog", { name: "Preview" })).toBe(dialog);
  expect(screen.getByRole("textbox", { name: "Modal draft" })).toBe(draft);
});

test.each(["app", "system"] as const)(
  "%s reduced motion switches a modal size immediately",
  (preference) => {
    if (preference === "app") document.body.classList.add("reduce-motion");
    else reducedMotion = true;
    render(modal());
    const draft = screen.getByRole("textbox", { name: "Modal draft" });
    fireEvent.click(screen.getByRole("button", { name: "Full Screen" }));
    expect(animate).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Exit Full Screen" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Modal draft" })).toBe(draft);
  },
);

test.each(["app", "system"] as const)(
  "enabling %s reduced motion completes an in-progress modal resize immediately",
  async (preference) => {
    render(modal());
    const dialog = screen.getByRole("dialog", { name: "Preview" });
    fireEvent.click(screen.getByRole("button", { name: "Full Screen" }));
    const resizing = animations[0];
    expect(dialog).toHaveAttribute("data-modal-resizing");

    await enableReducedMotion(preference);
    expect(resizing.cancel).toHaveBeenCalled();
    expect(dialog).not.toHaveAttribute("data-modal-resizing");
    expect(dialog.getBoundingClientRect().width).toBe(960);
    expect(dialog.getBoundingClientRect().height).toBe(720);
  },
);

test("unmounting a resizing modal cancels its animation and preference listener", () => {
  const result = render(modal());
  const dialog = screen.getByRole("dialog", { name: "Preview" });
  fireEvent.click(screen.getByRole("button", { name: "Full Screen" }));
  const resizing = animations[0];
  result.unmount();
  expect(resizing.cancel).toHaveBeenCalledTimes(1);
  expect(dialog).not.toHaveAttribute("data-modal-resizing");
  expect(mediaListeners.size).toBe(0);
});
