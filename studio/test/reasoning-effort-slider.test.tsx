import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";
import { ReasoningEffortSlider } from "../app/components/reasoning-effort-slider";
import {
  REASONING_EFFORT_OPTIONS,
  type ReasoningEffort,
} from "../app/utils/chat-params";

const captured = new Set<number>();
const levels = REASONING_EFFORT_OPTIONS.filter(
  (option) => option.value !== "auto",
);
const lastLevel = levels[levels.length - 1];
const steps = levels.length - 1;
const centerOf = (index: number) => 22 + (index / steps) * 256;
const labelOf = (value: ReasoningEffort) =>
  REASONING_EFFORT_OPTIONS.find((option) => option.value === value)!.label;
beforeEach(() => {
  captured.clear();
  Element.prototype.setPointerCapture = (id) => {
    captured.add(id);
  };
  Element.prototype.hasPointerCapture = (id) => captured.has(id);
  Element.prototype.releasePointerCapture = (id) => {
    captured.delete(id);
  };
  jest.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 300,
    bottom: 44,
    width: 300,
    height: 44,
    toJSON: () => ({}),
  });
});
afterEach(() => jest.restoreAllMocks());

function pointer(
  type: string,
  clientX: number,
  target: Element | Window = screen.getByRole("slider"),
  id = 1,
  extra: Record<string, unknown> = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
  });
  // jsdom's MouseEvent constructor rounds coordinates unlike browser PointerEvent.
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "pointerId", { value: id });
  for (const [key, value] of Object.entries(extra)) {
    Object.defineProperty(event, key, { value });
  }
  fireEvent(target, event);
}

function setup(
  value: ReasoningEffort = "auto",
  options: Pick<
    React.ComponentProps<typeof ReasoningEffortSlider>,
    "compact" | "onPreviewChange"
  > = {},
) {
  const onChange = jest.fn<(value: ReasoningEffort) => void>();
  function Control() {
    const [current, setCurrent] = useState(value);
    return (
      <ReasoningEffortSlider
        {...options}
        value={current}
        onChange={(next) => {
          onChange(next);
          setCurrent(next);
        }}
      />
    );
  }
  const result = render(<Control />);
  const slider = screen.getByRole("slider", { name: "推理强度" });
  const control = slider.parentElement!.parentElement!;
  return { ...result, onChange, slider, control };
}

test("automatic stays distinct from the levels and mounting never changes settings", () => {
  const { slider, control, onChange } = setup();
  expect(slider).toHaveAttribute("type", "range");
  expect(slider).toHaveAttribute("min", "0");
  expect(slider).toHaveAttribute("max", String(steps));
  expect(slider).toHaveAttribute("aria-valuetext", "自动，使用服务商默认设置");
  expect(screen.getByText("服务商默认")).toBeVisible();
  expect(screen.getByRole("button", { name: "自动" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getAllByRole("button")).toHaveLength(levels.length + 1);
  expect(control).toHaveAttribute("data-automatic", "true");
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "自动" }));
  expect(onChange).not.toHaveBeenCalled();
});

test("label buttons and assistive range changes update only the selected level", () => {
  const { onChange, slider } = setup();
  fireEvent.click(screen.getByRole("button", { name: labelOf("xhigh") }));
  expect(onChange).toHaveBeenLastCalledWith("xhigh");
  expect(slider).toHaveValue("3");
  fireEvent.click(screen.getByRole("button", { name: labelOf("xhigh") }));
  expect(onChange).toHaveBeenCalledTimes(1);
  fireEvent.change(slider, { target: { value: "1" } });
  expect(onChange).toHaveBeenLastCalledWith("medium");
  expect(
    screen.getByRole("button", { name: labelOf("medium") }),
  ).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "自动" }));
  expect(onChange).toHaveBeenLastCalledWith("auto");
  expect(slider).toHaveAttribute("aria-valuetext", "自动，使用服务商默认设置");
});

test("keyboard arrows, Home, End and Page keys remain bounded", () => {
  const { onChange, slider } = setup();
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  expect(onChange).toHaveBeenLastCalledWith("xhigh");
  fireEvent.keyDown(slider, { key: "Home" });
  expect(onChange).toHaveBeenLastCalledWith("low");
  fireEvent.keyDown(slider, { key: "ArrowDown" });
  expect(onChange).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(slider, { key: "End" });
  expect(onChange).toHaveBeenLastCalledWith(lastLevel.value);
  fireEvent.keyDown(slider, { key: "ArrowUp" });
  expect(onChange).toHaveBeenCalledTimes(3);
  fireEvent.keyDown(slider, { key: "PageDown" });
  expect(onChange).toHaveBeenLastCalledWith(levels[steps - 1].value);
  fireEvent.keyDown(slider, { key: "PageUp" });
  expect(onChange).toHaveBeenLastCalledWith(lastLevel.value);
});

test("drag follows the pointer continuously and commits the nearest level once on release", () => {
  const { onChange, control, slider } = setup("low");
  pointer("pointerdown", 22);
  expect(captured.has(1)).toBe(true);
  pointer("pointermove", centerOf(1.25));
  expect(Number(control.style.getPropertyValue("--effort-index"))).toBeCloseTo(
    1.25,
  );
  expect(slider).toHaveValue("1");
  expect(control).toHaveAttribute("data-dragging", "true");
  expect(onChange).not.toHaveBeenCalled();
  pointer("pointerup", centerOf(1.25));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith("medium");
  expect(control.style.getPropertyValue("--effort-index")).toBe("1");
  expect(control).toHaveAttribute("data-dragging", "false");
  expect(captured.size).toBe(0);
});

test("grabbing the thumb off center preserves the grab position without a jump", () => {
  const { onChange, control } = setup("high");
  pointer("pointerdown", centerOf(2) + 10);
  expect(control.style.getPropertyValue("--effort-index")).toBe("2");
  pointer("pointermove", centerOf(3) + 10);
  expect(control.style.getPropertyValue("--effort-index")).toBe("3");
  pointer("pointerup", centerOf(3) + 10);
  expect(onChange).toHaveBeenCalledWith("xhigh");
});

test("clicks at both ends and window pointerup select the exact endpoint", () => {
  const { onChange } = setup();
  pointer("pointerdown", -100);
  pointer("pointerup", -100, window);
  expect(onChange).toHaveBeenLastCalledWith("low");
  pointer("pointerdown", 1000);
  pointer("pointerup", 1000, window);
  expect(onChange).toHaveBeenLastCalledWith(lastLevel.value);
  expect(captured.size).toBe(0);
});

test.each([
  "pointercancel",
  "lostpointercapture",
  "windowblur",
  "inputblur",
  "Escape",
])(
  "%s discards the drag without writing a setting and allows a new gesture",
  (cancel) => {
    const { onChange, slider, control } = setup("high");
    pointer("pointerdown", centerOf(2));
    pointer("pointermove", 278);
    expect(slider).toHaveValue(String(steps));
    if (cancel === "windowblur") fireEvent.blur(window);
    else if (cancel === "inputblur") fireEvent.blur(slider);
    else if (cancel === "Escape") fireEvent.keyDown(slider, { key: "Escape" });
    else pointer(cancel, 278);
    expect(slider).toHaveValue("2");
    expect(control).toHaveAttribute("data-dragging", "false");
    expect(captured.size).toBe(0);
    pointer("pointerup", 278);
    expect(onChange).not.toHaveBeenCalled();
    pointer("pointerdown", 278);
    pointer("pointerup", 278);
    expect(onChange).toHaveBeenCalledWith(lastLevel.value);
  },
);

test("a programmatic value change cancels the old gesture without a stale commit", () => {
  const onChange = jest.fn<(value: ReasoningEffort) => void>();
  const { rerender } = render(
    <ReasoningEffortSlider value="low" onChange={onChange} />,
  );
  pointer("pointerdown", 22);
  pointer("pointermove", 278);
  rerender(<ReasoningEffortSlider value="medium" onChange={onChange} />);
  expect(screen.getByRole("slider")).toHaveValue("1");
  expect(captured.size).toBe(0);
  pointer("pointerup", 278);
  expect(onChange).not.toHaveBeenCalled();
});

test("other pointers, nonprimary touches and secondary mouse buttons cannot hijack the drag", () => {
  const { onChange, slider } = setup("low");
  pointer("pointerdown", 278, slider, 1, { isPrimary: false });
  pointer("pointerup", 278);
  expect(onChange).not.toHaveBeenCalled();
  pointer("pointerdown", 278, slider, 1, { button: 2 });
  pointer("pointerup", 278);
  expect(onChange).not.toHaveBeenCalled();
  pointer("pointerdown", 22);
  pointer("pointermove", 278, slider, 2);
  pointer("pointerup", 278, slider, 2);
  expect(slider).toHaveValue("0");
  pointer("pointerup", 22);
  expect(onChange).not.toHaveBeenCalled();
});

test("unmount releases pointer capture without submitting the preview", () => {
  const { onChange, unmount } = setup();
  pointer("pointerdown", 278);
  expect(captured.size).toBe(1);
  unmount();
  expect(captured.size).toBe(0);
  fireEvent.pointerUp(window);
  expect(onChange).not.toHaveBeenCalled();
});

test("hiding the page pauses the effect and cancels an unfinished gesture", () => {
  const { onChange, slider, control } = setup("high");
  pointer("pointerdown", centerOf(2));
  pointer("pointermove", 278);
  expect(control).toHaveAttribute("data-energized", "true");
  jest.spyOn(document, "hidden", "get").mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  expect(control).toHaveAttribute("data-page-visible", "false");
  expect(control).toHaveAttribute("data-energized", "true");
  expect(slider).toHaveValue("2");
  expect(captured.size).toBe(0);
  pointer("pointerup", 278);
  expect(onChange).not.toHaveBeenCalled();
});

test("window blur pauses highest-level feedback and focus makes it available again", () => {
  const { control, onChange } = setup(lastLevel.value);
  expect(control).toHaveAttribute("data-energized", "true");
  fireEvent.blur(window);
  expect(control).toHaveAttribute("data-page-visible", "false");
  fireEvent.focus(window);
  expect(control).toHaveAttribute("data-page-visible", "true");
  expect(onChange).not.toHaveBeenCalled();
});

test("a touch drag keeps automatic unchanged until release and cancel restores it", () => {
  const { onChange, slider, control } = setup();
  pointer("pointerdown", centerOf(2), slider, 11, { pointerType: "touch" });
  pointer("pointermove", 278, slider, 11, { pointerType: "touch" });
  expect(control).toHaveAttribute("data-automatic", "false");
  expect(onChange).not.toHaveBeenCalled();
  pointer("pointercancel", 278, slider, 11, { pointerType: "touch" });
  expect(control).toHaveAttribute("data-automatic", "true");
  expect(slider).toHaveAttribute("aria-valuetext", "自动，使用服务商默认设置");
  expect(onChange).not.toHaveBeenCalled();
});

test("compact mode keeps one accessible range and leaves the header and options to its popover", () => {
  const onPreviewChange = jest.fn<(value: ReasoningEffort | null) => void>();
  const { slider, control, onChange } = setup("high", {
    compact: true,
    onPreviewChange,
  });
  expect(control).toHaveAttribute("data-compact", "true");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(slider).toHaveValue("2");
  expect(onChange).not.toHaveBeenCalled();
  expect(onPreviewChange).not.toHaveBeenCalled();
  fireEvent.keyDown(slider, { key: "End" });
  expect(onChange).toHaveBeenCalledWith(lastLevel.value);
  expect(onPreviewChange).not.toHaveBeenCalled();
});

test("preview changes only across levels and clears after the committed drag", () => {
  const onPreviewChange = jest.fn<(value: ReasoningEffort | null) => void>();
  const { onChange } = setup("low", { compact: true, onPreviewChange });
  pointer("pointerdown", centerOf(0));
  pointer("pointermove", centerOf(1.1));
  pointer("pointermove", centerOf(1.3));
  pointer("pointermove", centerOf(steps));
  expect(onPreviewChange.mock.calls.map(([value]) => value)).toEqual([
    "low",
    "medium",
    lastLevel.value,
  ]);
  expect(onChange).not.toHaveBeenCalled();
  pointer("pointerup", centerOf(steps));
  expect(onPreviewChange).toHaveBeenLastCalledWith(null);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(lastLevel.value);
});

test("cancel and unmount clear compact preview without committing it", () => {
  const onPreviewChange = jest.fn<(value: ReasoningEffort | null) => void>();
  const { onChange, unmount } = setup("high", {
    compact: true,
    onPreviewChange,
  });
  pointer("pointerdown", centerOf(2));
  pointer("pointermove", centerOf(steps));
  pointer("pointercancel", centerOf(steps));
  expect(onPreviewChange).toHaveBeenLastCalledWith(null);
  pointer("pointerdown", centerOf(steps));
  expect(onPreviewChange).toHaveBeenLastCalledWith(lastLevel.value);
  unmount();
  expect(onPreviewChange).toHaveBeenLastCalledWith(null);
  expect(onChange).not.toHaveBeenCalled();
});

test("external value updates invalidate preview instead of submitting an old level", () => {
  const onPreviewChange = jest.fn<(value: ReasoningEffort | null) => void>();
  const onChange = jest.fn<(value: ReasoningEffort) => void>();
  const { rerender } = render(
    <ReasoningEffortSlider
      value="low"
      onChange={onChange}
      onPreviewChange={onPreviewChange}
      compact
    />,
  );
  pointer("pointerdown", centerOf(0));
  pointer("pointermove", centerOf(steps));
  rerender(
    <ReasoningEffortSlider
      value="medium"
      onChange={onChange}
      onPreviewChange={onPreviewChange}
      compact
    />,
  );
  expect(onPreviewChange).toHaveBeenLastCalledWith(null);
  expect(screen.getByRole("slider")).toHaveValue("1");
  pointer("pointerup", centerOf(steps));
  expect(onChange).not.toHaveBeenCalled();
});

test.each(["high", "xhigh", "max", "ultra"] as const)(
  "%s exposes stronger energy feedback without changing the setting",
  (value) => {
    const { control, onChange } = setup(value);
    expect(control).toHaveAttribute("data-energized", "true");
    expect(control).toHaveAttribute("data-level", value);
    expect(onChange).not.toHaveBeenCalled();
  },
);

test.each([
  ["low", 0],
  ["medium", 0],
  ["high", 2],
  ["xhigh", 9],
  ["max", 15],
  ["ultra", 22],
  ["auto", 0],
] as const)(
  "%s renders the upstream density of %s stars without mixing them into nebula opacity",
  (value, count) => {
    const { container } = setup(value, { compact: true });
    const dots = container.querySelectorAll("[data-brightness]");
    expect(dots).toHaveLength(count);
    if (count) {
      const particle = dots[0].parentElement as HTMLElement;
      const stars = particle.parentElement as HTMLElement;
      const energy = stars.previousElementSibling!;
      expect(energy.contains(dots[0])).toBe(false);
      expect(stars.parentElement).toBe(energy.parentElement);
      expect(
        Number(particle.style.animationDuration.replace("s", "")),
      ).toBeGreaterThan(0);
      expect(
        Number(particle.style.animationDelay.replace("s", "")),
      ).toBeLessThan(0);
      if (value === "max") expect(stars.style.opacity).toBe("0.88");
      if (value === "ultra") {
        expect(stars.style.opacity).toBe("1");
        expect(particle.style.animationDuration).toBe("0.470s");
        expect(particle.style.animationDelay).toBe("-0.294s");
      }
    }
  },
);

test("existing indexed stars keep their node and height when the position adds more stars", () => {
  const onChange = jest.fn();
  const { container, rerender } = render(
    <ReasoningEffortSlider value="max" onChange={onChange} compact />,
  );
  const first = container.querySelector("[data-brightness]")!;
  const parent = first.parentElement!;
  expect(parent.style.top).toBe("52%");
  rerender(<ReasoningEffortSlider value="ultra" onChange={onChange} compact />);
  expect(container.querySelector("[data-brightness]")).toBe(first);
  expect(first.parentElement).toBe(parent);
  expect(parent.style.top).toBe("52%");
  expect(container.querySelectorAll("[data-brightness]")).toHaveLength(22);
  expect(onChange).not.toHaveBeenCalled();
});

test("grabbing the outer edge of the twenty-two-pixel compact thumb preserves its offset", () => {
  const { onChange, control } = setup("high", { compact: true });
  pointer("pointerdown", centerOf(2) + 9);
  expect(control.style.getPropertyValue("--effort-index")).toBe("2");
  pointer("pointermove", centerOf(3) + 9);
  expect(control.style.getPropertyValue("--effort-index")).toBe("3");
  pointer("pointerup", centerOf(3) + 9);
  expect(onChange).toHaveBeenCalledWith("xhigh");
});

test("raw star timing remains available for OS slowdown without replacing normal inline phases", () => {
  const { container, onChange } = setup("ultra", { compact: true });
  const first = container.querySelector("[data-brightness]")!
    .parentElement as HTMLElement;
  const duration = parseFloat(first.style.getPropertyValue("--star-duration"));
  const delay = parseFloat(first.style.getPropertyValue("--star-delay"));
  expect(duration).toBeCloseTo(0.47032, 12);
  expect(delay).toBeCloseTo(-0.29407415918885055, 12);
  expect(duration * 2.6).toBeCloseTo(1.222832, 12);
  expect(delay / duration).toBeCloseTo((delay * 2.6) / (duration * 2.6), 12);
  expect(first.style.animationDuration).toBe("0.470s");
  expect(first.style.animationDelay).toBe("-0.294s");
  expect(onChange).not.toHaveBeenCalled();
});
