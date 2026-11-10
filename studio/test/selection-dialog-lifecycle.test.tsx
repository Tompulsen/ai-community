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
import { SelectionDialog } from "../app/components/selection-dialog";

const mediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
const viewportDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "visualViewport",
);
const heightDescriptor = Object.getOwnPropertyDescriptor(window, "innerHeight");
const showDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);
let mobile = false;
let systemReducedMotion = false;
const showModal = jest.fn(function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
  this.querySelector<HTMLButtonElement>("button")?.focus();
});
const closeModal = jest.fn(function (this: HTMLDialogElement) {
  this.removeAttribute("open");
});

beforeEach(() => {
  jest.useFakeTimers();
  mobile = false;
  systemReducedMotion = false;
  showModal.mockClear();
  closeModal.mockClear();
  document.body.classList.remove("reduce-motion");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches:
        (query === "(max-width: 600px)" && mobile) ||
        (query === "(prefers-reduced-motion: reduce)" && systemReducedMotion),
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: showModal,
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: closeModal,
  });
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{ width: 40, height: 40 }] as unknown as DOMRectList);
});

afterEach(() => {
  cleanup();
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
  document.body.classList.remove("reduce-motion");
  for (const [target, property, descriptor] of [
    [window, "matchMedia", mediaDescriptor],
    [window, "visualViewport", viewportDescriptor],
    [window, "innerHeight", heightDescriptor],
    [HTMLDialogElement.prototype, "showModal", showDescriptor],
    [HTMLDialogElement.prototype, "close", closeDescriptor],
  ] as const) {
    if (descriptor) Object.defineProperty(target, property, descriptor);
    else Reflect.deleteProperty(target, property);
  }
});

function endAnimation(element: HTMLElement, animationName: string) {
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: animationName });
  fireEvent(element, event);
}

function finishExit(dialog: HTMLElement) {
  const exitAnimation = mobile
    ? "compiled-selection-sheet-exit"
    : "compiled-selection-dialog-exit";
  dialog.style.animationName = exitAnimation;
  endAnimation(dialog, exitAnimation);
  act(() => jest.runAllTicks());
}

test("a controlled closed picker mounts its content only when opened", () => {
  const onClose = jest.fn();
  const view = render(
    <SelectionDialog title="Models" open={false} onClose={onClose}>
      <input aria-label="Model search" data-autofocus />
    </SelectionDialog>,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(showModal).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();

  view.rerender(
    <SelectionDialog title="Models" open onClose={onClose}>
      <input aria-label="Model search" data-autofocus />
    </SelectionDialog>,
  );
  expect(screen.getByRole("dialog", { name: "Models" })).toHaveAttribute(
    "open",
  );
  expect(screen.getByRole("textbox")).toHaveFocus();
  expect(showModal).toHaveBeenCalledTimes(1);
});

test("a compact action sheet preserves initial focus, keyboard cycling and exit scope", () => {
  mobile = true;
  const onClose = jest.fn();
  render(<button>Message actions</button>);
  const trigger = screen.getByRole("button", { name: "Message actions" });
  trigger.focus();
  render(
    <SelectionDialog title="Message menu" compact onClose={onClose}>
      <button data-autofocus>Copy</button>
      <button>Export</button>
    </SelectionDialog>,
  );
  const dialog = screen.getByRole("dialog", { name: "Message menu" });
  const first = within(dialog).getByRole("button", { name: "关闭" });
  const copy = within(dialog).getByRole("button", { name: "Copy" });
  const last = within(dialog).getByRole("button", { name: "Export" });
  expect(copy).toHaveFocus();
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(last).toHaveFocus();
  fireEvent.keyDown(last, { key: "Escape" });
  expect(dialog).toHaveAttribute("data-closing", "true");
  expect(dialog).toHaveAttribute("open");
  expect(onClose).not.toHaveBeenCalled();
  finishExit(dialog);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("a compact sheet tracks the keyboard viewport until it closes or unmounts", () => {
  mobile = true;
  const viewport = Object.assign(new EventTarget(), {
    height: 700,
    offsetTop: 0,
  });
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: viewport,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });
  const add = jest.spyOn(viewport, "addEventListener");
  const remove = jest.spyOn(viewport, "removeEventListener");
  const removeWindow = jest.spyOn(window, "removeEventListener");
  const onClose = jest.fn();
  const view = render(
    <SelectionDialog title="Parameters" compact onClose={onClose}>
      <input aria-label="Compression" />
    </SelectionDialog>,
  );
  const dialog = screen.getByRole("dialog");
  expect(
    dialog.style.getPropertyValue("--selection-dialog-viewport-height"),
  ).toBe("700px");
  act(() => {
    viewport.height = 400;
    viewport.dispatchEvent(new Event("resize"));
  });
  expect(
    dialog.style.getPropertyValue("--selection-dialog-viewport-height"),
  ).toBe("400px");
  expect(
    dialog.style.getPropertyValue("--selection-dialog-viewport-bottom"),
  ).toBe("400px");
  act(() => {
    viewport.offsetTop = 120;
    viewport.dispatchEvent(new Event("scroll"));
  });
  expect(
    dialog.style.getPropertyValue("--selection-dialog-viewport-bottom"),
  ).toBe("280px");
  const listener = add.mock.calls.find(([type]) => type === "resize")?.[1];
  fireEvent.keyDown(dialog, { key: "Escape" });
  finishExit(dialog);
  expect(remove).toHaveBeenCalledWith("resize", listener);
  expect(remove).toHaveBeenCalledWith("scroll", listener);
  expect(removeWindow).toHaveBeenCalledWith("resize", listener);
  expect(
    dialog.style.getPropertyValue("--selection-dialog-viewport-height"),
  ).toBe("");
  view.unmount();

  const second = render(
    <SelectionDialog title="Parameters" compact onClose={onClose}>
      <input aria-label="Compression" />
    </SelectionDialog>,
  );
  const activeDialog = screen.getByRole("dialog");
  const nextListener = add.mock.calls
    .filter(([type]) => type === "resize")
    .at(-1)?.[1];
  second.unmount();
  expect(remove).toHaveBeenCalledWith("resize", nextListener);
  expect(remove).toHaveBeenCalledWith("scroll", nextListener);
  expect(
    activeDialog.style.getPropertyValue("--selection-dialog-viewport-bottom"),
  ).toBe("");
});

test("closing holds the native focus scope and completes only once after its own animation", () => {
  const onClose = jest.fn();
  render(<button>Choose a model</button>);
  const trigger = screen.getByRole("button", { name: "Choose a model" });
  trigger.focus();
  render(
    <SelectionDialog title="Models" onClose={onClose}>
      <button>Choose Atlas</button>
    </SelectionDialog>,
  );
  const dialog = screen.getByRole("dialog", { name: "Models" });
  const close = within(dialog).getByRole("button", { name: "关闭" });
  const last = within(dialog).getByRole("button", { name: "Choose Atlas" });

  fireEvent.click(close);
  fireEvent.click(close);
  fireEvent.keyDown(last, { key: "Escape" });
  expect(dialog).toHaveAttribute("open");
  expect(dialog).toHaveAttribute("data-closing", "true");
  expect(onClose).not.toHaveBeenCalled();
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(close).toHaveFocus();
  fireEvent.animationEnd(last);
  expect(onClose).not.toHaveBeenCalled();
  const backdropEnd = new Event("animationend", { bubbles: true });
  Object.defineProperty(backdropEnd, "pseudoElement", { value: "::backdrop" });
  fireEvent(dialog, backdropEnd);
  expect(onClose).not.toHaveBeenCalled();

  finishExit(dialog);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(closeModal).toHaveBeenCalledTimes(1);
  expect(trigger).toHaveFocus();
  act(() => jest.advanceTimersByTime(1000));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test.each([
  ["desktop", false, 220],
  ["mobile", true, 260],
] as const)(
  "%s falls back after its exit duration when animationend is unavailable",
  (_viewport, isMobile, fallback) => {
    mobile = isMobile;
    const onClose = jest.fn();
    render(
      <SelectionDialog title="Models" onClose={onClose} children={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    act(() => jest.advanceTimersByTime(fallback - 1));
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(onClose).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  },
);

test("a parent selection closes the controlled picker through its exit lifecycle", () => {
  const onClose = jest.fn();
  const onSelect = jest.fn();
  function Picker() {
    const [open, setOpen] = React.useState(true);
    return (
      <SelectionDialog
        title="Models"
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <button
          onClick={() => {
            onSelect("Atlas");
            setOpen(false);
          }}
        >
          Choose Atlas
        </button>
      </SelectionDialog>
    );
  }
  render(<Picker />);
  fireEvent.click(screen.getByRole("button", { name: "Choose Atlas" }));
  const dialog = screen.getByRole("dialog");
  expect(onSelect).toHaveBeenCalledWith("Atlas");
  expect(dialog).toHaveAttribute("data-closing", "true");
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Choose Atlas" }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  finishExit(dialog);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("reopening cancels the pending exit and uses the latest callback on a later close", () => {
  const firstClose = jest.fn();
  const latestClose = jest.fn();
  const view = render(
    <SelectionDialog
      title="Models"
      open
      onClose={firstClose}
      children={null}
    />,
  );
  const dialog = screen.getByRole("dialog");
  view.rerender(
    <SelectionDialog
      title="Models"
      open={false}
      onClose={firstClose}
      children={null}
    />,
  );
  act(() => jest.advanceTimersByTime(100));
  view.rerender(
    <SelectionDialog
      title="Models"
      open
      onClose={latestClose}
      children={null}
    />,
  );
  expect(dialog).not.toHaveAttribute("data-closing");
  fireEvent.animationEnd(dialog);
  act(() => jest.advanceTimersByTime(1000));
  expect(dialog).toHaveAttribute("open");
  expect(firstClose).not.toHaveBeenCalled();
  expect(latestClose).not.toHaveBeenCalled();

  fireEvent.keyDown(dialog, { key: "Escape" });
  finishExit(dialog);
  expect(latestClose).toHaveBeenCalledTimes(1);
  expect(firstClose).not.toHaveBeenCalled();
});

test.each([
  ["desktop", false],
  ["mobile", true],
] as const)(
  "a late %s entry animation cannot finish an exit",
  (_viewport, isMobile) => {
    mobile = isMobile;
    const onClose = jest.fn();
    render(
      <SelectionDialog title="Models" onClose={onClose} children={null} />,
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    dialog.style.animationName = mobile
      ? "compiled-selection-sheet-exit"
      : "compiled-selection-dialog-exit";
    endAnimation(
      dialog,
      mobile
        ? "compiled-selection-sheet-enter"
        : "compiled-selection-dialog-enter",
    );
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveAttribute("data-closing", "true");
    expect(onClose).not.toHaveBeenCalled();
    finishExit(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  },
);

test.each([
  { isComposing: true, keyCode: 27 },
  { isComposing: false, keyCode: 229 },
])(
  "composition Escape keeps the dialog open ($isComposing, $keyCode)",
  (ime) => {
    const onClose = jest.fn();
    render(
      <SelectionDialog title="Models" onClose={onClose}>
        <input aria-label="Model search" />
      </SelectionDialog>,
    );
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Escape", ...ime });
    expect(screen.getByRole("dialog")).not.toHaveAttribute("data-closing");
    act(() => jest.advanceTimersByTime(1000));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape", keyCode: 27 });
    finishExit(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  },
);

test("native cancellation stays blocked during composition and then closes once", () => {
  const onClose = jest.fn();
  render(
    <SelectionDialog title="Models" onClose={onClose}>
      <input aria-label="Model search" />
    </SelectionDialog>,
  );
  const dialog = screen.getByRole("dialog");
  const input = screen.getByRole("textbox");
  fireEvent.compositionStart(input);
  expect(fireEvent(dialog, new Event("cancel", { cancelable: true }))).toBe(
    false,
  );
  expect(dialog).not.toHaveAttribute("data-closing");
  fireEvent.compositionEnd(input);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  finishExit(dialog);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test.each(["application", "system"])(
  "%s reduced motion completes closing without an animation delay",
  (preference) => {
    if (preference === "application")
      document.body.classList.add("reduce-motion");
    else systemReducedMotion = true;
    const onClose = jest.fn();
    render(
      <SelectionDialog title="Models" onClose={onClose} children={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => jest.runAllTicks());
    expect(jest.getTimerCount()).toBe(0);
  },
);

test("only a click beyond the dialog bounds dismisses its backdrop", () => {
  const onClose = jest.fn();
  render(<SelectionDialog title="Models" onClose={onClose} children={null} />);
  const dialog = screen.getByRole("dialog");
  jest.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
    left: 100,
    right: 500,
    top: 100,
    bottom: 500,
  } as DOMRect);
  fireEvent.click(dialog, { clientX: 200, clientY: 200 });
  expect(dialog).not.toHaveAttribute("data-closing");
  fireEvent.click(dialog, { clientX: 30, clientY: 30 });
  expect(dialog).toHaveAttribute("data-closing", "true");
  finishExit(dialog);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("unmount cancels pending completion and Strict Mode preserves the original opener", () => {
  const onClose = jest.fn();
  render(<button>Open models</button>);
  const trigger = screen.getByRole("button", { name: "Open models" });
  trigger.focus();
  const view = render(
    <React.StrictMode>
      <SelectionDialog title="Models" onClose={onClose} children={null} />
    </React.StrictMode>,
  );
  act(() => jest.runAllTicks());
  expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
  expect(showModal).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  view.unmount();
  act(() => jest.advanceTimersByTime(1000));
  expect(onClose).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  expect(trigger).toHaveFocus();
});
