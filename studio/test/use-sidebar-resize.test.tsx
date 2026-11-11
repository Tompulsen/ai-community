import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { NARROW_SIDEBAR_WIDTH } from "../app/constant";
import { useSidebarResize } from "../app/components/use-sidebar-resize";

const restoredProperties = (
  [
    [globalThis, "requestAnimationFrame"],
    [globalThis, "cancelAnimationFrame"],
    [globalThis, "PointerEvent"],
    [window, "matchMedia"],
    [Element.prototype, "setPointerCapture"],
    [Element.prototype, "hasPointerCapture"],
    [Element.prototype, "releasePointerCapture"],
  ] as const
).map(([target, name]) => ({
  target: target as object,
  name: name as string,
  descriptor: Object.getOwnPropertyDescriptor(target, name),
}));

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly isPrimary: boolean;
  readonly pointerType: string;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
    this.pointerType = init.pointerType ?? "mouse";
  }
}

let clock = 0;
let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;
let reducedMotion = false;
let captured: Set<number>;
let cancelFrame: ReturnType<typeof jest.fn>;

function liveWidth(frame: HTMLElement) {
  return Number.parseFloat(
    frame.style.getPropertyValue("--sidebar-live-width"),
  );
}

beforeEach(() => {
  clock = 0;
  frames = new Map();
  nextFrame = 0;
  reducedMotion = false;
  captured = new Set();
  document.body.classList.remove("reduce-motion");
  cancelFrame = jest.fn((id: number) => frames.delete(id));
  for (const [target, name, value] of [
    [
      globalThis,
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        const id = ++nextFrame;
        frames.set(id, callback);
        return id;
      },
    ],
    [globalThis, "cancelAnimationFrame", cancelFrame],
    [globalThis, "PointerEvent", TestPointerEvent],
    [
      window,
      "matchMedia",
      (query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)" && reducedMotion,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      }),
    ],
    [Element.prototype, "setPointerCapture", (id: number) => captured.add(id)],
    [Element.prototype, "hasPointerCapture", (id: number) => captured.has(id)],
    [
      Element.prototype,
      "releasePointerCapture",
      (id: number) => captured.delete(id),
    ],
  ] as const) {
    Object.defineProperty(target, name, { configurable: true, value });
  }
  jest.spyOn(performance, "now").mockImplementation(() => clock);
  jest
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const frame = this.closest<HTMLElement>('[data-testid="frame"]');
      const preview = frame ? liveWidth(frame) : NaN;
      const width =
        this.dataset.testid === "frame"
          ? 1000
          : Number.isFinite(preview)
          ? preview
          : Number(frame?.dataset.committedWidth ?? 300);
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: width,
        bottom: 700,
        width,
        height: 700,
        toJSON: () => ({}),
      };
    });
});

afterEach(() => {
  cleanup();
  document.body.classList.remove("reduce-motion");
  jest.restoreAllMocks();
  for (const { target, name, descriptor } of restoredProperties) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
  }
});

function nextAnimationFrame(milliseconds = 16) {
  clock += milliseconds;
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((callback) => callback(clock)));
}

function finishMotion() {
  for (let attempt = 0; frames.size && attempt < 30; attempt++) {
    nextAnimationFrame(20);
  }
  expect(frames.size).toBe(0);
}

function pointer(
  type: string,
  target: Element | Window,
  clientX: number,
  extra: PointerEventInit = {},
) {
  fireEvent(
    target,
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX,
      pointerId: 1,
      isPrimary: true,
      ...extra,
    }),
  );
}

function setup({
  width = 300,
  isMobile = false,
  applyCommits = true,
}: {
  width?: number;
  isMobile?: boolean;
  applyCommits?: boolean;
} = {}) {
  const onWidthChange = jest.fn<(width: number) => void>();
  let setCommittedWidth: (width: number) => void = () => {};
  function Fixture() {
    const [committed, setCommitted] = useState(width);
    setCommittedWidth = setCommitted;
    const { shouldNarrow, ...handlers } = useSidebarResize({
      width: committed,
      isMobile,
      onWidthChange: (next) => {
        onWidthChange(next);
        if (applyCommits) setCommitted(next);
      },
    });
    return (
      <div data-testid="frame" data-committed-width={committed}>
        <aside
          data-testid="sidebar"
          data-width-mode={shouldNarrow ? "narrow" : "wide"}
        >
          <div
            role="separator"
            aria-label="Sidebar width"
            aria-valuenow={committed}
            tabIndex={0}
            {...handlers}
          />
        </aside>
      </div>
    );
  }
  const result = render(<Fixture />);
  return {
    ...result,
    onWidthChange,
    frame: screen.getByTestId("frame"),
    sidebar: screen.getByTestId("sidebar"),
    separator: screen.getByRole("separator"),
    commit(next: number) {
      act(() => setCommittedWidth(next));
    },
  };
}

test("dragging previews every width in the old dead zone and its narrow mode without persisting", () => {
  const result = setup();
  pointer("pointerdown", result.separator, 300);
  pointer("pointermove", window, 180);
  nextAnimationFrame();
  expect(liveWidth(result.frame)).toBe(180);
  expect(result.frame).toHaveAttribute("data-sidebar-resizing");
  expect(result.separator).toHaveAttribute("aria-valuenow", "300");
  expect(result.sidebar).toHaveAttribute("data-width-mode", "narrow");

  pointer("pointermove", window, 140);
  nextAnimationFrame();
  expect(liveWidth(result.frame)).toBe(140);
  expect(result.sidebar).toHaveAttribute("data-width-mode", "narrow");
  expect(result.onWidthChange).not.toHaveBeenCalled();
});

test("dragging a collapsed sidebar across the expanded threshold reveals its labels before release", () => {
  const result = setup({ width: NARROW_SIDEBAR_WIDTH });
  expect(result.sidebar).toHaveAttribute("data-width-mode", "narrow");
  pointer("pointerdown", result.separator, NARROW_SIDEBAR_WIDTH);
  pointer("pointermove", window, 240);
  nextAnimationFrame();
  expect(liveWidth(result.frame)).toBe(240);
  expect(result.sidebar).toHaveAttribute("data-width-mode", "wide");
  expect(result.separator).toHaveAttribute(
    "aria-valuenow",
    String(NARROW_SIDEBAR_WIDTH),
  );
  expect(result.onWidthChange).not.toHaveBeenCalled();

  pointer("pointercancel", window, 240);
  finishMotion();
  expect(result.sidebar).toHaveAttribute("data-width-mode", "narrow");
  expect(result.onWidthChange).not.toHaveBeenCalled();
});

test("one drag can cross the narrow threshold repeatedly without committing", () => {
  const result = setup();
  pointer("pointerdown", result.separator, 300);
  for (const [coordinate, mode] of [
    [240, "wide"],
    [229, "narrow"],
    [230, "wide"],
    [180, "narrow"],
    [300, "wide"],
  ] as const) {
    pointer("pointermove", window, coordinate);
    nextAnimationFrame();
    expect(liveWidth(result.frame)).toBe(coordinate);
    expect(result.sidebar).toHaveAttribute("data-width-mode", mode);
    expect(result.frame).toHaveAttribute("data-sidebar-resizing");
    expect(result.separator).toHaveAttribute("aria-valuenow", "300");
    expect(result.onWidthChange).not.toHaveBeenCalled();
  }
});

test("a quick drag flushes the pointerup coordinate and never becomes a click toggle", () => {
  const result = setup();
  pointer("pointerdown", result.separator, 300);
  pointer("pointermove", window, 260);
  pointer("pointerup", window, 410);
  finishMotion();
  expect(result.onWidthChange).toHaveBeenLastCalledWith(410);
  expect(result.separator).toHaveAttribute("aria-valuenow", "410");
});

test("a long stationary press still toggles and commits only after settling", () => {
  const result = setup();
  pointer("pointerdown", result.separator, 300);
  clock += 1000;
  pointer("pointerup", window, 302);
  expect(result.onWidthChange).not.toHaveBeenCalled();
  expect(result.frame).toHaveAttribute("data-sidebar-settling");
  finishMotion();
  expect(result.onWidthChange).toHaveBeenCalledTimes(1);
  expect(result.onWidthChange).toHaveBeenCalledWith(NARROW_SIDEBAR_WIDTH);
  expect(result.frame.style.getPropertyValue("--sidebar-live-width")).toBe("");
  expect(result.frame).not.toHaveAttribute("data-sidebar-settling");
});

test.each([
  {
    coordinate: -200,
    preview: NARROW_SIDEBAR_WIDTH,
    final: NARROW_SIDEBAR_WIDTH,
  },
  { coordinate: 900, preview: 500, final: 500 },
  { coordinate: 138, preview: 138, final: NARROW_SIDEBAR_WIDTH },
  { coordinate: 140, preview: 140, final: 230 },
])(
  "dragging to $coordinate previews $preview and settles at $final",
  ({ coordinate, preview, final }) => {
    const result = setup();
    pointer("pointerdown", result.separator, 300);
    pointer("pointermove", window, coordinate);
    nextAnimationFrame();
    expect(liveWidth(result.frame)).toBe(preview);
    expect(result.onWidthChange).not.toHaveBeenCalled();
    pointer("pointerup", window, coordinate);
    finishMotion();
    expect(result.onWidthChange).toHaveBeenLastCalledWith(final);
    expect(result.separator).toHaveAttribute("aria-valuenow", String(final));
  },
);

test.each(["pointercancel", "blur"])(
  "%s returns to the committed width without a toggle",
  (event) => {
    const result = setup();
    pointer("pointerdown", result.separator, 300);
    pointer("pointermove", window, 150);
    nextAnimationFrame();
    expect(result.sidebar).toHaveAttribute("data-width-mode", "narrow");
    if (event === "blur") fireEvent.blur(window);
    else pointer(event, window, 150);
    finishMotion();
    expect(result.separator).toHaveAttribute("aria-valuenow", "300");
    expect(result.sidebar).toHaveAttribute("data-width-mode", "wide");
    expect(result.frame.style.getPropertyValue("--sidebar-live-width")).toBe(
      "",
    );
    expect(result.onWidthChange).not.toHaveBeenCalled();
    expect(captured.size).toBe(0);
  },
);

test.each(["drag", "settle"])(
  "unmounting during %s clears pending frames, listeners and transient layout",
  (stage) => {
    const result = setup();
    pointer("pointerdown", result.separator, 300);
    pointer("pointermove", window, 140);
    if (stage === "settle") {
      nextAnimationFrame();
      pointer("pointerup", window, 140);
    }
    expect(frames.size).toBeGreaterThan(0);
    result.unmount();
    expect(frames.size).toBe(0);
    expect(result.frame.style.getPropertyValue("--sidebar-live-width")).toBe(
      "",
    );
    expect(result.frame).not.toHaveAttribute("data-sidebar-resizing");
    expect(result.frame).not.toHaveAttribute("data-sidebar-settling");
    pointer("pointermove", window, 450);
    pointer("pointerup", window, 450);
    expect(result.onWidthChange).not.toHaveBeenCalled();
    expect(captured.size).toBe(0);
  },
);

test("grabbing a settling sidebar continues from its rendered width and cancellation restores the committed width", () => {
  const result = setup();
  pointer("pointerdown", result.separator, 300);
  pointer("pointerup", window, 300);
  nextAnimationFrame(100);
  const rendered = liveWidth(result.frame);
  expect(rendered).toBeGreaterThan(NARROW_SIDEBAR_WIDTH);
  expect(rendered).toBeLessThan(300);
  const pendingFrame = [...frames.keys()][0];

  pointer("pointerdown", result.separator, rendered);
  expect(cancelFrame).toHaveBeenCalledWith(pendingFrame);
  pointer("pointermove", window, rendered + 40);
  nextAnimationFrame();
  expect(liveWidth(result.frame)).toBeCloseTo(rendered + 40, 3);
  expect(result.onWidthChange).not.toHaveBeenCalled();
  expect(result.separator).toHaveAttribute("aria-valuenow", "300");
  pointer("pointercancel", window, rendered + 40);
  finishMotion();
  expect(result.frame.style.getPropertyValue("--sidebar-live-width")).toBe("");
  expect(result.separator).toHaveAttribute("aria-valuenow", "300");
  expect(result.onWidthChange).not.toHaveBeenCalled();
});

test.each([NARROW_SIDEBAR_WIDTH, 300])(
  "a second click reverses the pending snap from committed width %s",
  (width) => {
    const result = setup({ width });
    pointer("pointerdown", result.separator, width);
    pointer("pointerup", window, width);
    nextAnimationFrame(80);
    const rendered = liveWidth(result.frame);
    expect(rendered).toBeGreaterThan(NARROW_SIDEBAR_WIDTH);
    expect(rendered).toBeLessThan(300);
    expect(result.onWidthChange).not.toHaveBeenCalled();

    pointer("pointerdown", result.separator, rendered);
    pointer("pointerup", window, rendered);
    finishMotion();
    expect(result.separator).toHaveAttribute("aria-valuenow", String(width));
    expect(result.frame.style.getPropertyValue("--sidebar-live-width")).toBe(
      "",
    );
    expect(result.onWidthChange).not.toHaveBeenCalled();
  },
);

test.each([
  { reverse: false, final: 372 },
  { reverse: true, final: 348 },
])(
  "rapid keyboard steps accumulate before commit, reverse=$reverse",
  ({ reverse, final }) => {
    const result = setup();
    for (let step = 0; step < 3; step++) {
      fireEvent.keyDown(result.separator, { key: "ArrowRight" });
    }
    nextAnimationFrame(80);
    expect(result.onWidthChange).not.toHaveBeenCalled();
    expect(result.separator).toHaveAttribute("aria-valuenow", "300");
    if (reverse) fireEvent.keyDown(result.separator, { key: "ArrowLeft" });
    finishMotion();
    expect(result.onWidthChange).toHaveBeenCalledTimes(1);
    expect(result.onWidthChange).toHaveBeenCalledWith(final);
    expect(result.separator).toHaveAttribute("aria-valuenow", String(final));
  },
);

test("the final preview remains until the owner applies the committed width", () => {
  const result = setup({ applyCommits: false });
  pointer("pointerdown", result.separator, 300);
  pointer("pointerup", window, 300);
  finishMotion();
  expect(result.onWidthChange).toHaveBeenCalledWith(NARROW_SIDEBAR_WIDTH);
  expect(liveWidth(result.frame)).toBe(NARROW_SIDEBAR_WIDTH);
  expect(result.separator).toHaveAttribute("aria-valuenow", "300");

  result.commit(NARROW_SIDEBAR_WIDTH);
  expect(result.separator).toHaveAttribute(
    "aria-valuenow",
    String(NARROW_SIDEBAR_WIDTH),
  );
  expect(liveWidth(result.frame)).toBe(NARROW_SIDEBAR_WIDTH);
  expect(result.frame).toHaveAttribute("data-sidebar-settling");
  nextAnimationFrame();
  expect(liveWidth(result.frame)).toBe(NARROW_SIDEBAR_WIDTH);
  expect(result.frame).toHaveAttribute("data-sidebar-settling");
  nextAnimationFrame();
  expect(result.frame.style.getPropertyValue("--sidebar-live-width")).toBe("");
  expect(result.frame).not.toHaveAttribute("data-sidebar-settling");
  expect(frames.size).toBe(0);
});

test.each(["app", "system"])(
  "%s reduced motion commits immediately and clears layout after two frames",
  (preference) => {
    if (preference === "app") document.body.classList.add("reduce-motion");
    else reducedMotion = true;
    const result = setup();
    pointer("pointerdown", result.separator, 300);
    pointer("pointerup", window, 300);
    expect(result.onWidthChange).toHaveBeenCalledTimes(1);
    expect(result.onWidthChange).toHaveBeenCalledWith(NARROW_SIDEBAR_WIDTH);
    expect(result.separator).toHaveAttribute(
      "aria-valuenow",
      String(NARROW_SIDEBAR_WIDTH),
    );
    expect(liveWidth(result.frame)).toBe(NARROW_SIDEBAR_WIDTH);
    expect(result.frame).toHaveAttribute("data-sidebar-settling");
    nextAnimationFrame();
    expect(liveWidth(result.frame)).toBe(NARROW_SIDEBAR_WIDTH);
    expect(result.frame).toHaveAttribute("data-sidebar-settling");
    nextAnimationFrame();
    expect(result.frame.style.getPropertyValue("--sidebar-live-width")).toBe(
      "",
    );
    expect(result.frame).not.toHaveAttribute("data-sidebar-settling");
    expect(frames.size).toBe(0);
  },
);

test("a reduced-motion drag snapping to the current width retains its marker through one paint", () => {
  reducedMotion = true;
  const result = setup({ width: NARROW_SIDEBAR_WIDTH });
  pointer("pointerdown", result.separator, NARROW_SIDEBAR_WIDTH);
  pointer("pointermove", window, 100);
  nextAnimationFrame();
  expect(liveWidth(result.frame)).toBe(100);
  pointer("pointerup", window, 100);
  expect(result.onWidthChange).not.toHaveBeenCalled();
  expect(result.separator).toHaveAttribute(
    "aria-valuenow",
    String(NARROW_SIDEBAR_WIDTH),
  );
  expect(liveWidth(result.frame)).toBe(NARROW_SIDEBAR_WIDTH);
  expect(result.frame).toHaveAttribute("data-sidebar-settling");
  nextAnimationFrame();
  expect(liveWidth(result.frame)).toBe(NARROW_SIDEBAR_WIDTH);
  expect(result.frame).toHaveAttribute("data-sidebar-settling");
  nextAnimationFrame();
  expect(result.frame.style.getPropertyValue("--sidebar-live-width")).toBe("");
  expect(result.frame).not.toHaveAttribute("data-sidebar-settling");
  expect(frames.size).toBe(0);
});

test("a new drag cancels deferred cleanup without losing its live width or marker", () => {
  reducedMotion = true;
  const result = setup();
  pointer("pointerdown", result.separator, 300);
  pointer("pointerup", window, 300);
  expect(result.onWidthChange).toHaveBeenCalledWith(NARROW_SIDEBAR_WIDTH);
  nextAnimationFrame();
  expect(result.frame).toHaveAttribute("data-sidebar-settling");
  const cleanupFrame = [...frames.keys()][0];

  pointer("pointerdown", result.separator, NARROW_SIDEBAR_WIDTH);
  expect(cancelFrame).toHaveBeenCalledWith(cleanupFrame);
  expect(result.frame).toHaveAttribute("data-sidebar-resizing");
  expect(result.frame).not.toHaveAttribute("data-sidebar-settling");
  pointer("pointermove", window, 260);
  nextAnimationFrame();
  nextAnimationFrame();
  expect(liveWidth(result.frame)).toBe(260);
  expect(result.frame).toHaveAttribute("data-sidebar-resizing");
  expect(result.separator).toHaveAttribute(
    "aria-valuenow",
    String(NARROW_SIDEBAR_WIDTH),
  );
  expect(result.onWidthChange).toHaveBeenCalledTimes(1);

  pointer("pointerup", window, 260);
  expect(result.onWidthChange).toHaveBeenCalledTimes(2);
  expect(result.onWidthChange).toHaveBeenLastCalledWith(260);
  expect(result.separator).toHaveAttribute("aria-valuenow", "260");
  expect(liveWidth(result.frame)).toBe(260);
  finishMotion();
  expect(result.frame.style.getPropertyValue("--sidebar-live-width")).toBe("");
  expect(result.frame).not.toHaveAttribute("data-sidebar-settling");
});

test.each([0, 1])(
  "unmounting after %s deferred cleanup frames immediately clears all transient state",
  (elapsedFrames) => {
    reducedMotion = true;
    const result = setup();
    pointer("pointerdown", result.separator, 300);
    pointer("pointerup", window, 300);
    expect(result.separator).toHaveAttribute(
      "aria-valuenow",
      String(NARROW_SIDEBAR_WIDTH),
    );
    for (let index = 0; index < elapsedFrames; index++) nextAnimationFrame();
    expect(frames.size).toBe(1);
    expect(result.frame).toHaveAttribute("data-sidebar-settling");
    const cleanupFrame = [...frames.keys()][0];

    result.unmount();
    expect(cancelFrame).toHaveBeenCalledWith(cleanupFrame);
    expect(frames.size).toBe(0);
    expect(result.frame.style.getPropertyValue("--sidebar-live-width")).toBe(
      "",
    );
    expect(result.frame).not.toHaveAttribute("data-sidebar-resizing");
    expect(result.frame).not.toHaveAttribute("data-sidebar-settling");
    nextAnimationFrame();
    expect(result.onWidthChange).toHaveBeenCalledTimes(1);
    expect(result.onWidthChange).toHaveBeenCalledWith(NARROW_SIDEBAR_WIDTH);
    expect(captured.size).toBe(0);
  },
);

test("mobile ignores desktop pointer resizing", () => {
  const result = setup({ isMobile: true, width: 100 });
  expect(result.sidebar).toHaveAttribute("data-width-mode", "wide");
  pointer("pointerdown", result.separator, 100);
  pointer("pointermove", window, 150);
  pointer("pointerup", window, 150);
  expect(result.onWidthChange).not.toHaveBeenCalled();
  expect(result.sidebar).toHaveAttribute("data-width-mode", "wide");
  expect(result.separator).toHaveAttribute("aria-valuenow", "100");
  expect(frames.size).toBe(0);
  expect(result.frame.style.getPropertyValue("--sidebar-live-width")).toBe("");
});

test.each([{ button: 2 }, { isPrimary: false }])(
  "ignores an unsupported pointerdown %j",
  (extra) => {
    const result = setup();
    pointer("pointerdown", result.separator, 300, extra);
    pointer("pointermove", window, 150);
    pointer("pointerup", window, 150);
    expect(result.onWidthChange).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(result.frame).not.toHaveAttribute("data-sidebar-resizing");
  },
);

test("another pointer cannot move or finish the active drag", () => {
  const result = setup();
  pointer("pointerdown", result.separator, 300);
  pointer("pointermove", window, 450, { pointerId: 2 });
  pointer("pointerup", window, 450, { pointerId: 2 });
  expect(result.onWidthChange).not.toHaveBeenCalled();
  expect(result.frame).toHaveAttribute("data-sidebar-resizing");
  pointer("pointermove", window, 350);
  nextAnimationFrame();
  expect(liveWidth(result.frame)).toBe(350);
  pointer("pointerup", window, 350);
  finishMotion();
  expect(result.onWidthChange).toHaveBeenLastCalledWith(350);
});

test("keyboard controls toggle, step, collapse at the minimum and reach both bounds", () => {
  reducedMotion = true;
  const result = setup();
  const key = (value: string) =>
    fireEvent.keyDown(result.separator, { key: value });

  key("Enter");
  expect(result.separator).toHaveAttribute(
    "aria-valuenow",
    String(NARROW_SIDEBAR_WIDTH),
  );
  key(" ");
  expect(result.separator).toHaveAttribute("aria-valuenow", "300");
  key("ArrowRight");
  expect(result.separator).toHaveAttribute("aria-valuenow", "324");
  key("ArrowLeft");
  expect(result.separator).toHaveAttribute("aria-valuenow", "300");
  key("Home");
  expect(result.separator).toHaveAttribute(
    "aria-valuenow",
    String(NARROW_SIDEBAR_WIDTH),
  );
  key("ArrowRight");
  expect(result.separator).toHaveAttribute("aria-valuenow", "230");
  key("ArrowLeft");
  expect(result.separator).toHaveAttribute(
    "aria-valuenow",
    String(NARROW_SIDEBAR_WIDTH),
  );
  key("End");
  expect(result.separator).toHaveAttribute("aria-valuenow", "500");
});
