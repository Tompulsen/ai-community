import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { ModelEffortControl } from "../app/components/model-effort-control";
import type { ModelConfig } from "../app/store";
import { REASONING_EFFORT_OPTIONS } from "../app/utils/chat-params";

const title = "选择模型: Gemini selected alias";
const changeModelLabel = "更换模型: Gemini selected alias";
const levels = REASONING_EFFORT_OPTIONS.filter(
  (option) => option.value !== "auto",
);
const captures = new Set<number>();
const mediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
const showDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);
let reducedMotion = false;
let mobileView = false;

beforeEach(() => {
  jest.useFakeTimers();
  reducedMotion = false;
  mobileView = false;
  document.body.classList.remove("reduce-motion");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches:
        (query === "(prefers-reduced-motion: reduce)" && reducedMotion) ||
        (query === "(max-width: 600px)" && mobileView),
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
      this.querySelector<HTMLButtonElement>("button")?.focus();
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  captures.clear();
  Element.prototype.setPointerCapture = (id) => {
    captures.add(id);
  };
  Element.prototype.hasPointerCapture = (id) => captures.has(id);
  Element.prototype.releasePointerCapture = (id) => {
    captures.delete(id);
  };
  jest.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 500,
    left: 100,
    top: 500,
    right: 420,
    bottom: 544,
    width: 320,
    height: 44,
    toJSON: () => ({}),
  });
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{ width: 40, height: 40 }] as unknown as DOMRectList);
});

afterEach(() => {
  cleanup();
  act(() => jest.runOnlyPendingTimers());
  document.body.classList.remove("reduce-motion");
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
  showReasoning = true,
  onSelectModel = jest.fn(),
  update = jest.fn(),
  model = "gemini-selected-alias",
  providerName = "account",
}: {
  showReasoning?: boolean;
  onSelectModel?: () => void;
  update?: (value: ModelConfig) => void;
  model?: string;
  providerName?: string;
}) {
  const [config, setConfig] = useState({
    model,
    providerName,
    chatApiFormat: "gemini",
    reasoningEffort: "high",
    temperature: 0.7,
  } as ModelConfig);
  const [open, setOpen] = useState(false);
  const current = { ...config, model, providerName };
  return (
    <>
      <ModelEffortControl
        modelLabel="Gemini selected alias"
        modelTitle={title}
        modelPickerId="full-model-picker"
        onSelectModel={onSelectModel}
        modelConfig={current}
        showReasoning={showReasoning}
        open={open}
        onOpenChange={setOpen}
        mobile={mobileView}
        updateConfig={(updater) => {
          const next = { ...current };
          updater(next);
          update(next);
          setConfig(next);
        }}
      />
      <button onClick={() => setOpen(false)}>Other parameter</button>
    </>
  );
}

function open() {
  const trigger = screen.getByRole("button", { name: /^思考强度：/ });
  const modelTrigger = screen.getByRole("button", { name: title });
  trigger.focus();
  fireEvent.click(trigger);
  const panel = screen.getByRole("dialog", { name: "思考强度" });
  return { trigger, modelTrigger, panel };
}

function advanceExit(milliseconds = 260) {
  act(() => {
    jest.advanceTimersByTime(milliseconds);
  });
  act(() => jest.runAllTicks());
}

function pointer(type: string, index: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  Object.defineProperty(event, "clientX", {
    value: 122 + (index / (levels.length - 1)) * 276,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(screen.getByRole("slider", { name: "推理强度" }), event);
}

test("keyboard activation enters the nonmodal attached reasoning popover", () => {
  const originalMatches = Element.prototype.matches;
  jest.spyOn(Element.prototype, "matches").mockImplementation(function (
    this: Element,
    selector: string,
  ) {
    return selector === ":focus-visible"
      ? true
      : originalMatches.call(this, selector);
  });
  const update = jest.fn();
  render(<Harness update={update} />);
  const { trigger, modelTrigger, panel } = open();
  expect(modelTrigger).toHaveTextContent("Gemini selected alias");
  expect(trigger).toHaveTextContent("High");
  expect(trigger).not.toHaveTextContent("Gemini selected alias");
  expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  expect(modelTrigger).toHaveAttribute(
    "data-model-picker-trigger",
    "full-model-picker",
  );
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(panel.parentElement).toBe(document.body);
  expect(panel).toHaveAttribute("aria-modal", "false");
  expect(panel).toHaveStyle({ position: "fixed" });
  expect(
    within(panel).queryByText("Gemini selected alias"),
  ).not.toBeInTheDocument();
  const slider = within(panel).getByRole("slider", { name: "推理强度" });
  expect(slider).toHaveAttribute("min", "0");
  expect(slider).toHaveAttribute("max", "5");
  expect(slider).toHaveValue("2");
  expect(slider).toHaveFocus();
  expect(slider.parentElement!.parentElement).toHaveAttribute(
    "data-compact",
    "true",
  );
  expect(within(panel).getAllByRole("button")).toHaveLength(1);
  expect(
    within(panel).queryByRole("button", { name: changeModelLabel }),
  ).not.toBeInTheDocument();
  expect(update).not.toHaveBeenCalled();
});

test("a pointer-opened popover keeps trigger focus until Tab enters the slider", () => {
  const originalMatches = Element.prototype.matches;
  jest.spyOn(Element.prototype, "matches").mockImplementation(function (
    this: Element,
    selector: string,
  ) {
    return selector === ":focus-visible"
      ? false
      : originalMatches.call(this, selector);
  });
  render(<Harness />);
  const { trigger, panel } = open();
  const slider = within(panel).getByRole("slider", { name: "推理强度" });
  expect(trigger).toHaveFocus();
  expect(slider).not.toHaveFocus();
  fireEvent.keyDown(trigger, { key: "Tab" });
  expect(slider).toHaveFocus();
  expect(panel).toBeInTheDocument();
});

test("the model name and strength buttons invoke their own actions without changing settings", () => {
  const onSelectModel = jest.fn();
  const update = jest.fn();
  render(<Harness onSelectModel={onSelectModel} update={update} />);
  const modelTrigger = screen.getByRole("button", { name: title });
  expect(modelTrigger).toHaveAttribute("aria-controls", "full-model-picker");
  expect(modelTrigger).not.toHaveTextContent("High");
  fireEvent.click(modelTrigger);
  expect(onSelectModel).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  open();
  expect(screen.getByRole("dialog", { name: "思考强度" })).toBeInTheDocument();
  expect(onSelectModel).toHaveBeenCalledTimes(1);
  expect(update).not.toHaveBeenCalled();
});

test.each(levels)(
  "choosing $value updates the header, trigger and the same configuration",
  (level) => {
    const update = jest.fn();
    render(<Harness update={update} />);
    const { trigger, panel } = open();
    const slider = within(panel).getByRole("slider", { name: "推理强度" });
    if (level.value === "high") {
      fireEvent.change(slider, { target: { value: "0" } });
      update.mockClear();
    }
    fireEvent.change(slider, {
      target: { value: String(levels.indexOf(level)) },
    });
    expect(update).toHaveBeenLastCalledWith({
      model: "gemini-selected-alias",
      providerName: "account",
      chatApiFormat: "gemini",
      reasoningEffort: level.value,
      temperature: 0.7,
    });
    expect(trigger).toHaveTextContent(level.label);
    expect(within(panel).getByRole("status")).toHaveTextContent(level.label);
    expect(slider.closest("[data-effort]")).toHaveAttribute(
      "data-effort",
      level.value,
    );
  },
);

test("drag previews change only the header until release and cancellation restores it", () => {
  const update = jest.fn();
  render(<Harness update={update} />);
  const { trigger, panel } = open();
  const value = within(panel).getByRole("status");
  pointer("pointerdown", 2);
  pointer("pointermove", 5);
  expect(value).toHaveTextContent("Ultra");
  expect(
    within(panel).getByRole("slider").closest("[data-effort]"),
  ).toHaveAttribute("data-effort", "ultra");
  expect(trigger).toHaveTextContent("High");
  expect(update).not.toHaveBeenCalled();
  pointer("pointercancel", 5);
  expect(value).toHaveTextContent("High");
  expect(captures.size).toBe(0);
  pointer("pointerdown", 5);
  pointer("pointerup", 5);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ reasoningEffort: "ultra" }),
  );
  expect(trigger).toHaveTextContent("Ultra");
  expect(value).toHaveTextContent("Ultra");
});

test("the automatic button restores the provider default without changing other fields", () => {
  const update = jest.fn();
  render(<Harness update={update} />);
  const { trigger, panel } = open();
  const automatic = within(panel).getByRole("button", { name: "自动" });
  fireEvent.click(automatic);
  expect(update).toHaveBeenLastCalledWith(
    expect.objectContaining({ reasoningEffort: "auto", temperature: 0.7 }),
  );
  expect(trigger).toHaveTextContent("自动");
  expect(within(panel).getByRole("status")).toHaveTextContent("自动");
  expect(automatic).toHaveAttribute("aria-pressed", "true");
  expect(within(panel).getByRole("slider")).toHaveAttribute(
    "aria-valuetext",
    "自动，使用服务商默认设置",
  );
});

test("clicking the model name closes the desktop popover before handing off to the picker", () => {
  const onSelectModel = jest.fn(() => {
    expect(
      screen.queryByRole("dialog", { name: "思考强度" }),
    ).not.toBeInTheDocument();
  });
  render(<Harness onSelectModel={onSelectModel} />);
  const { trigger, modelTrigger } = open();
  fireEvent.click(modelTrigger);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(onSelectModel).toHaveBeenCalledTimes(1);
  expect(modelTrigger).toHaveFocus();
});

test.each(["pointer", "focus"])(
  "outside %s dismisses the popover without stealing the user's next focus",
  (interaction) => {
    render(<Harness />);
    const { trigger } = open();
    const outside = screen.getByRole("button", { name: "Other parameter" });
    if (interaction === "pointer") fireEvent.pointerDown(outside);
    act(() => outside.focus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(outside).toHaveFocus();
  },
);

test("Escape closes the desktop popover and restores strength trigger focus", () => {
  render(<Harness />);
  const { trigger, panel } = open();
  fireEvent.keyDown(within(panel).getByRole("slider"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test.each([false, true])(
  "Escape first cancels dragging without dismissing the %s mobile parameter view",
  (isMobile) => {
    mobileView = isMobile;
    const update = jest.fn();
    render(<Harness update={update} />);
    const { trigger, panel } = open();
    pointer("pointerdown", 2);
    pointer("pointermove", 5);
    expect(within(panel).getByRole("status")).toHaveTextContent("Ultra");
    fireEvent.keyDown(within(panel).getByRole("slider"), { key: "Escape" });
    advanceExit();
    expect(panel).toBeInTheDocument();
    expect(within(panel).getByRole("status")).toHaveTextContent("High");
    expect(captures.size).toBe(0);
    expect(update).not.toHaveBeenCalled();
    fireEvent.keyDown(within(panel).getByRole("slider"), { key: "Escape" });
    advanceExit();
    expect(panel).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  },
);

test("IME Escape and a previously handled Escape leave the desktop popover open", () => {
  render(<Harness />);
  const { panel } = open();
  const slider = within(panel).getByRole("slider");
  fireEvent.keyDown(slider, { key: "Escape", isComposing: true });
  fireEvent.keyDown(slider, { key: "Escape", keyCode: 229 });
  const handled = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  handled.preventDefault();
  fireEvent(slider, handled);
  expect(panel).toBeInTheDocument();
});

test("clicking the strength trigger again toggles only its popover", () => {
  const onSelectModel = jest.fn();
  render(<Harness onSelectModel={onSelectModel} />);
  const { trigger } = open();
  fireEvent.click(trigger);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(trigger);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(onSelectModel).not.toHaveBeenCalled();
});

test("mobile uses the existing compact native sheet and focuses the unchanged slider", () => {
  mobileView = true;
  render(<Harness />);
  const { trigger, panel } = open();
  expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  expect(panel.tagName).toBe("DIALOG");
  expect(panel).toHaveAttribute("open");
  expect(panel).toHaveAttribute("aria-modal", "true");
  expect(panel.parentElement).toBe(document.body);
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
  expect(within(panel).getByRole("slider")).toHaveFocus();
  expect(within(panel).getAllByText("思考强度")).toHaveLength(1);
  expect(within(panel).getByRole("button", { name: "自动" })).toBeVisible();
  expect(
    within(panel).getByRole("button", { name: changeModelLabel }),
  ).toBeVisible();
});

test.each(["model-name", "sheet-footer"])(
  "mobile waits for the sheet exit before the %s entry hands off to the model picker",
  (entry) => {
    mobileView = true;
    const onSelectModel = jest.fn();
    render(<Harness onSelectModel={onSelectModel} />);
    const { trigger, modelTrigger, panel } = open();
    fireEvent.click(
      entry === "model-name"
        ? modelTrigger
        : within(panel).getByRole("button", { name: changeModelLabel }),
    );
    expect(panel).toHaveAttribute("data-closing", "true");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(onSelectModel).not.toHaveBeenCalled();
    advanceExit(259);
    expect(onSelectModel).not.toHaveBeenCalled();
    expect(panel).toBeInTheDocument();
    advanceExit(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSelectModel).toHaveBeenCalledTimes(1);
    expect(modelTrigger).toHaveFocus();
  },
);

test("a real sheet exit animation can complete model handoff without a duplicate timer callback", () => {
  mobileView = true;
  const onSelectModel = jest.fn();
  render(<Harness onSelectModel={onSelectModel} />);
  const { panel } = open();
  fireEvent.click(
    within(panel).getByRole("button", { name: changeModelLabel }),
  );
  panel.style.animationName = "selection-sheet-exit";
  const exit = new Event("animationend", { bubbles: true });
  Object.defineProperty(exit, "animationName", {
    value: "selection-sheet-exit",
  });
  fireEvent(panel, exit);
  expect(onSelectModel).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  advanceExit();
  expect(onSelectModel).toHaveBeenCalledTimes(1);
});

test("reopening the mobile sheet cancels a pending model handoff", () => {
  mobileView = true;
  const onSelectModel = jest.fn();
  render(<Harness onSelectModel={onSelectModel} />);
  const { trigger, panel } = open();
  fireEvent.click(
    within(panel).getByRole("button", { name: changeModelLabel }),
  );
  fireEvent.click(trigger);
  advanceExit();
  expect(panel).toBeInTheDocument();
  expect(panel).not.toHaveAttribute("data-closing");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(onSelectModel).not.toHaveBeenCalled();
});

test.each(["application", "system"])(
  "%s reduced motion hands off immediately without waiting for an animation",
  (source) => {
    mobileView = true;
    if (source === "application") document.body.classList.add("reduce-motion");
    else reducedMotion = true;
    const onSelectModel = jest.fn();
    render(<Harness onSelectModel={onSelectModel} />);
    const { panel } = open();
    fireEvent.click(
      within(panel).getByRole("button", { name: changeModelLabel }),
    );
    expect(onSelectModel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    advanceExit();
    expect(onSelectModel).toHaveBeenCalledTimes(1);
  },
);

test.each(["image", "video"])(
  "%s model buttons open the full picker directly without a parameter region",
  (model) => {
    const onSelectModel = jest.fn();
    render(
      <Harness
        model={model}
        showReasoning={false}
        onSelectModel={onSelectModel}
      />,
    );
    const trigger = screen.getByRole("button", { name: title });
    expect(trigger).not.toHaveTextContent("High");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-controls", "full-model-picker");
    fireEvent.click(trigger);
    expect(onSelectModel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  },
);

test.each([
  { model: "other-model", providerName: "account" },
  { model: "gemini-selected-alias", providerName: "octopus-custom" },
])(
  "changing model identity closes the old mobile sheet and cancels pending handoff ($model/$providerName)",
  (identity) => {
    mobileView = true;
    const onSelectModel = jest.fn();
    const { rerender } = render(<Harness onSelectModel={onSelectModel} />);
    const { panel } = open();
    fireEvent.click(
      within(panel).getByRole("button", { name: changeModelLabel }),
    );
    expect(panel).toHaveAttribute("data-closing", "true");
    rerender(<Harness {...identity} onSelectModel={onSelectModel} />);
    advanceExit();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSelectModel).not.toHaveBeenCalled();
    open();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  },
);

test("unmounting during mobile handoff cancels the delayed picker action", () => {
  mobileView = true;
  const onSelectModel = jest.fn();
  const { unmount } = render(<Harness onSelectModel={onSelectModel} />);
  const { panel } = open();
  fireEvent.click(
    within(panel).getByRole("button", { name: changeModelLabel }),
  );
  unmount();
  advanceExit();
  expect(onSelectModel).not.toHaveBeenCalled();
});
