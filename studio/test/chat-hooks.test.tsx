import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { useLongPress } from "../app/components/chat-hooks";

const message = { id: "user-1" };

function LongPressMessage({
  onLongPress,
}: {
  onLongPress: (event: React.MouseEvent | React.TouchEvent, value: any) => void;
}) {
  const handlers = useLongPress(onLongPress, 500);
  return (
    <div
      data-testid="message"
      onMouseDown={(event) => handlers.onMouseDown(event, message)}
      onMouseUp={handlers.onMouseUp}
      onMouseLeave={handlers.onMouseLeave}
      onTouchStart={(event) => handlers.onTouchStart(event, message)}
      onTouchEnd={handlers.onTouchEnd}
      onTouchMove={handlers.onTouchMove}
    >
      <p data-testid="body">Original message</p>
      <textarea aria-label="Edited message" />
      <input aria-label="Input" />
      <select aria-label="Select">
        <option>Selected</option>
      </select>
      <div contentEditable suppressContentEditableWarning>
        <span data-testid="editable-child">Editable text</span>
      </div>
      <button type="button">
        <span data-testid="button-child">Save</span>
      </button>
      <a href="#source">
        <span data-testid="link-child">Source</span>
      </a>
      <details>
        <summary>
          <span data-testid="summary-child">Details</span>
        </summary>
      </details>
      <div role="button" tabIndex={0}>
        <span data-testid="role-button-child">Action</span>
      </div>
    </div>
  );
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

const gestures = [
  ["mouse", fireEvent.mouseDown],
  ["touch", fireEvent.touchStart],
] as const;

test.each(gestures)(
  "%s long press opens the message menu only after the configured delay",
  (_kind, start) => {
    const onLongPress = jest.fn();
    render(<LongPressMessage onLongPress={onLongPress} />);
    start(screen.getByTestId("body"));
    act(() => jest.advanceTimersByTime(499));
    expect(onLongPress).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledWith(expect.anything(), message);
  },
);

test.each(gestures)(
  "%s long press leaves native controls and their children alone",
  (_kind, start) => {
    const onLongPress = jest.fn();
    render(<LongPressMessage onLongPress={onLongPress} />);
    const controls = [
      screen.getByRole("textbox", { name: "Edited message" }),
      screen.getByRole("textbox", { name: "Input" }),
      screen.getByRole("combobox", { name: "Select" }),
      screen.getByTestId("editable-child"),
      screen.getByTestId("button-child"),
      screen.getByTestId("link-child"),
      screen.getByTestId("summary-child"),
      screen.getByTestId("role-button-child"),
    ];
    for (const control of controls) {
      start(control);
      act(() => jest.advanceTimersByTime(500));
    }
    expect(onLongPress).not.toHaveBeenCalled();
  },
);

test.each([
  ["mouse up", fireEvent.mouseUp],
  ["mouse leave", fireEvent.mouseLeave],
  ["touch end", fireEvent.touchEnd],
  ["touch move", fireEvent.touchMove],
] as const)("%s cancels a pending menu", (_kind, cancel) => {
  const onLongPress = jest.fn();
  render(<LongPressMessage onLongPress={onLongPress} />);
  fireEvent.mouseDown(screen.getByTestId("body"));
  act(() => jest.advanceTimersByTime(200));
  cancel(screen.getByTestId("message"));
  act(() => jest.advanceTimersByTime(500));
  expect(onLongPress).not.toHaveBeenCalled();
});

test("unmount cancels a pending menu", () => {
  const onLongPress = jest.fn();
  const { unmount } = render(<LongPressMessage onLongPress={onLongPress} />);
  fireEvent.touchStart(screen.getByTestId("body"));
  unmount();
  act(() => jest.advanceTimersByTime(500));
  expect(onLongPress).not.toHaveBeenCalled();
});
