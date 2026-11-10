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
  CollapsibleContent,
  SmoothDetails,
} from "../app/components/collapsible-content";

const mediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
let systemReducedMotion = false;

beforeEach(() => {
  jest.useFakeTimers();
  systemReducedMotion = false;
  document.body.classList.remove("reduce-motion");
  document.body.removeAttribute("data-motion");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches:
        query === "(prefers-reduced-motion: reduce)" && systemReducedMotion,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }),
  });
});

afterEach(() => {
  cleanup();
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
  document.body.classList.remove("reduce-motion");
  document.body.removeAttribute("data-motion");
  if (mediaDescriptor)
    Object.defineProperty(window, "matchMedia", mediaDescriptor);
  else Reflect.deleteProperty(window, "matchMedia");
});

function finishCollapse(panel: Element, property = "grid-template-rows") {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: property });
  fireEvent(panel, event);
}

function ContentFixture({
  open,
  onCollapsed,
}: {
  open: boolean;
  onCollapsed?: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger}>Parameters</button>
      <button>Unrelated control</button>
      <CollapsibleContent
        id="parameters-content"
        className="parameters-content"
        open={open}
        triggerRef={trigger}
        onCollapsed={onCollapsed}
      >
        <label>
          Parameter value
          <input defaultValue="Original" />
        </label>
        <span data-testid="panel-descendant">Detail</span>
      </CollapsibleContent>
    </>
  );
}

function contentPanel() {
  return document.getElementById("parameters-content")!;
}

test("initially closed content remains mounted and inaccessible without reporting a collapse", () => {
  const collapsed = jest.fn();
  render(<ContentFixture open={false} onCollapsed={collapsed} />);
  const panel = contentPanel();
  expect(panel.querySelector(".parameters-content")).toContainElement(
    panel.querySelector("input"),
  );
  expect(panel).toHaveAttribute("aria-hidden", "true");
  expect(panel).toHaveAttribute("inert");
  expect(panel.querySelector("input")).toHaveValue("Original");
  act(() => jest.runOnlyPendingTimers());
  expect(collapsed).not.toHaveBeenCalled();
});

test("closing and reopening retain the same content nodes and entered values", () => {
  const view = render(<ContentFixture open />);
  const panel = contentPanel();
  const input = screen.getByRole("textbox", { name: "Parameter value" });
  fireEvent.change(input, { target: { value: "Edited value" } });

  view.rerender(<ContentFixture open={false} />);
  expect(panel).toHaveAttribute("aria-hidden", "true");
  expect(panel).toHaveAttribute("inert");
  expect(panel.querySelector("input")).toBe(input);
  finishCollapse(panel);
  view.rerender(<ContentFixture open />);

  expect(contentPanel()).toBe(panel);
  expect(screen.getByRole("textbox", { name: "Parameter value" })).toBe(input);
  expect(input).toHaveValue("Edited value");
  expect(panel).not.toHaveAttribute("aria-hidden", "true");
  expect(panel).not.toHaveAttribute("inert");
});

test("collapsing returns focus from the content to its trigger", () => {
  const view = render(<ContentFixture open />);
  screen.getByRole("textbox", { name: "Parameter value" }).focus();
  view.rerender(<ContentFixture open={false} />);
  expect(screen.getByRole("button", { name: "Parameters" })).toHaveFocus();
});

test("collapsing leaves focus outside the content unchanged", () => {
  const view = render(<ContentFixture open />);
  const outside = screen.getByRole("button", { name: "Unrelated control" });
  outside.focus();
  view.rerender(<ContentFixture open={false} />);
  expect(outside).toHaveFocus();
});

test("normal collapse completes once after its own transition, ignoring descendant events", () => {
  const collapsed = jest.fn();
  const view = render(<ContentFixture open onCollapsed={collapsed} />);
  view.rerender(<ContentFixture open={false} onCollapsed={collapsed} />);

  expect(collapsed).not.toHaveBeenCalled();
  finishCollapse(screen.getByTestId("panel-descendant"));
  expect(collapsed).not.toHaveBeenCalled();
  finishCollapse(contentPanel());
  expect(collapsed).toHaveBeenCalledTimes(1);
  act(() => jest.runOnlyPendingTimers());
  expect(collapsed).toHaveBeenCalledTimes(1);
});

test("missing transition events still complete collapse through the bounded fallback", () => {
  const collapsed = jest.fn();
  const view = render(<ContentFixture open onCollapsed={collapsed} />);
  view.rerender(<ContentFixture open={false} onCollapsed={collapsed} />);
  expect(collapsed).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(300));
  expect(collapsed).toHaveBeenCalledTimes(1);
});

test("rapid reopening cancels pending completion and ignores stale transition events", () => {
  const collapsed = jest.fn();
  const view = render(<ContentFixture open onCollapsed={collapsed} />);
  view.rerender(<ContentFixture open={false} onCollapsed={collapsed} />);
  view.rerender(<ContentFixture open onCollapsed={collapsed} />);
  finishCollapse(contentPanel());
  act(() => jest.runOnlyPendingTimers());
  expect(collapsed).not.toHaveBeenCalled();
  expect(contentPanel()).not.toHaveAttribute("inert");

  view.rerender(<ContentFixture open={false} onCollapsed={collapsed} />);
  finishCollapse(contentPanel());
  expect(collapsed).toHaveBeenCalledTimes(1);
});

test.each(["application", "system"])(
  "%s reduced motion completes collapse immediately",
  (source) => {
    if (source === "application") document.body.classList.add("reduce-motion");
    else systemReducedMotion = true;
    const collapsed = jest.fn();
    const view = render(<ContentFixture open onCollapsed={collapsed} />);
    view.rerender(<ContentFixture open={false} onCollapsed={collapsed} />);
    expect(contentPanel()).toHaveAttribute("inert");
    expect(collapsed).toHaveBeenCalledTimes(1);
    act(() => jest.runOnlyPendingTimers());
    expect(collapsed).toHaveBeenCalledTimes(1);
  },
);

test.each([
  ["system", true],
  ["reduced", false],
] as const)(
  "changing only motion from full to %s completes a pending collapse",
  async (preference, systemReduced) => {
    systemReducedMotion = systemReduced;
    document.body.dataset.motion = "full";
    const collapsed = jest.fn();
    const view = render(<ContentFixture open onCollapsed={collapsed} />);
    view.rerender(<ContentFixture open={false} onCollapsed={collapsed} />);
    expect(collapsed).not.toHaveBeenCalled();

    await act(async () => {
      document.body.dataset.motion = preference;
    });
    expect(document.body.classList.contains("reduce-motion")).toBe(false);
    expect(collapsed).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    finishCollapse(contentPanel());
    act(() => jest.runOnlyPendingTimers());
    expect(collapsed).toHaveBeenCalledTimes(1);
  },
);

test("unmount cancels pending collapse completion", () => {
  const collapsed = jest.fn();
  const view = render(<ContentFixture open onCollapsed={collapsed} />);
  view.rerender(<ContentFixture open={false} onCollapsed={collapsed} />);
  view.unmount();
  act(() => jest.runOnlyPendingTimers());
  expect(collapsed).not.toHaveBeenCalled();
});

function DetailsFixture({ openOn = false }: { openOn?: boolean }) {
  return (
    <SmoothDetails summary="Advanced parameters" openOn={openOn}>
      <label>
        Advanced value
        <input defaultValue="Kept value" />
      </label>
    </SmoothDetails>
  );
}

function detailsElements() {
  const summary = screen.getByText("Advanced parameters").closest("summary")!;
  const details = summary.closest("details")!;
  const input = details.querySelector("input")!;
  return {
    summary,
    details,
    input,
  };
}

test("smooth details preserve native elements while delaying physical closing until collapse completes", () => {
  render(<DetailsFixture />);
  const { summary, details, input } = detailsElements();
  expect(details).not.toHaveAttribute("open");
  expect(summary).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(summary);
  expect(details).toHaveAttribute("open");
  expect(summary).toHaveAttribute("aria-expanded", "true");
  fireEvent.change(input, { target: { value: "Preserved edit" } });

  fireEvent.click(summary);
  const panel = input.closest("[aria-hidden]")!;
  expect(summary).toHaveAttribute("aria-expanded", "false");
  expect(details).toHaveAttribute("open");
  expect(panel).toHaveAttribute("inert");
  finishCollapse(panel);
  expect(details).not.toHaveAttribute("open");
  fireEvent.click(summary);
  expect(details.querySelector("input")).toBe(input);
  expect(input).toHaveValue("Preserved edit");
});

test("smooth details can reopen during collapse without stale events closing the reopened section", () => {
  render(<DetailsFixture openOn />);
  const { summary, details, input } = detailsElements();
  fireEvent.click(summary);
  const panel = input.closest("[aria-hidden]")!;
  fireEvent.click(summary);
  finishCollapse(panel);
  act(() => jest.runOnlyPendingTimers());
  expect(details).toHaveAttribute("open");
  expect(summary).toHaveAttribute("aria-expanded", "true");
  expect(panel).not.toHaveAttribute("inert");
});

test("openOn responds to a rising edge while allowing the user to close afterwards", () => {
  const view = render(<DetailsFixture />);
  const { summary, details, input } = detailsElements();
  view.rerender(<DetailsFixture openOn />);
  expect(details).toHaveAttribute("open");
  expect(summary).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(summary);
  finishCollapse(input.closest("[aria-hidden]")!);
  expect(details).not.toHaveAttribute("open");

  view.rerender(<DetailsFixture openOn />);
  expect(details).not.toHaveAttribute("open");
  view.rerender(<DetailsFixture openOn={false} />);
  view.rerender(<DetailsFixture openOn />);
  expect(details).toHaveAttribute("open");
  expect(summary).toHaveAttribute("aria-expanded", "true");
});

test("external native details toggles keep the summary and hidden content in sync", () => {
  render(<DetailsFixture />);
  const { summary, details, input } = detailsElements();
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  expect(summary).toHaveAttribute("aria-expanded", "true");
  expect(input.closest("[inert]")).toBeNull();
  act(() => {
    details.open = false;
    details.dispatchEvent(new Event("toggle"));
  });
  expect(summary).toHaveAttribute("aria-expanded", "false");
  expect(input.closest("[aria-hidden]")).toHaveAttribute("inert");
});

test("reduced motion closes smooth details immediately and restores focus to its summary", () => {
  systemReducedMotion = true;
  render(<DetailsFixture openOn />);
  const { summary, details, input } = detailsElements();
  input.focus();
  fireEvent.click(summary);
  expect(summary).toHaveFocus();
  expect(details).not.toHaveAttribute("open");
  expect(summary).toHaveAttribute("aria-expanded", "false");
});
