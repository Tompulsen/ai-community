import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";
import { ChatSplitPane } from "../app/components/chat-split-pane";

const capture = new Set<number>();
beforeEach(() => {
  capture.clear();
  Element.prototype.setPointerCapture = (id) => {
    capture.add(id);
  };
  Element.prototype.hasPointerCapture = (id) => capture.has(id);
  Element.prototype.releasePointerCapture = (id) => {
    capture.delete(id);
  };
  jest.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    left: 0,
    top: 0,
    right: 1010,
    bottom: 700,
    width: 1010,
    height: 700,
    y: 0,
    toJSON: () => ({}),
  });
});
afterEach(() => jest.restoreAllMocks());

function pointer(type: string, x: number, id = 1) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, button: 0 });
  Object.defineProperty(event, "pointerId", { value: id });
  fireEvent(screen.getByRole("separator"), event);
}
function setup() {
  const close = jest.fn();
  render(
    <ChatSplitPane preview={<iframe title="example" />} onClose={close}>
      Chat
    </ChatSplitPane>,
  );
  return { close, divider: screen.getByRole("separator") };
}
test("Escape cancels to the size before dragging; double-click resets to equal panes", () => {
  const { divider } = setup();
  fireEvent.keyDown(divider, { key: "ArrowRight" });
  expect(divider.getAttribute("aria-valuenow")).toBe("52");
  pointer("pointerdown", 525);
  expect(screen.getByTestId("preview-drag-mask")).toBeTruthy();
  pointer("pointermove", 305);
  expect(divider.getAttribute("aria-valuenow")).toBe("30");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(divider.getAttribute("aria-valuenow")).toBe("52");
  expect(screen.queryByTestId("preview-drag-mask")).toBeNull();
  expect(capture.size).toBe(0);
  fireEvent.doubleClick(divider);
  expect(divider.getAttribute("aria-valuenow")).toBe("50");
});

test("dragging beyond 80 percent collapses preview and ends the drag", () => {
  const { close } = setup();
  pointer("pointerdown", 505);
  pointer("pointermove", 806);
  expect(close).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("preview-drag-mask")).toBeNull();
  expect(capture.size).toBe(0);
});

test.each(["pointercancel", "lostpointercapture", "blur"])(
  "%s cancels cleanly and another drag works",
  (type) => {
    const { divider } = setup();
    pointer("pointerdown", 505);
    pointer("pointermove", 305, 2);
    expect(divider.getAttribute("aria-valuenow")).toBe("50");
    pointer("pointermove", 305);
    if (type === "blur") fireEvent.blur(window);
    else pointer(type, 305);
    expect(divider.getAttribute("aria-valuenow")).toBe("50");
    expect(screen.queryByTestId("preview-drag-mask")).toBeNull();
    pointer("pointerdown", 505);
    pointer("pointermove", 605);
    pointer("pointerup", 605);
    expect(divider.getAttribute("aria-valuenow")).toBe("60");
    expect(capture.size).toBe(0);
  },
);
