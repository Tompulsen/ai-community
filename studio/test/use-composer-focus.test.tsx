import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { useComposerFocus } from "../app/utils/use-composer-focus";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function Harness({
  mobile = false,
  onAction = jest.fn(),
  onFileClick = jest.fn(),
  closeOnPointerDown = false,
}: {
  mobile?: boolean;
  onAction?: () => void;
  onFileClick?: () => void;
  closeOnPointerDown?: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const { restoreAfterAction, ...handlers } = useComposerFocus(
    input,
    file,
    mobile,
    history,
  );
  const [portal, setPortal] = useState(false);
  return (
    <>
      <div data-testid="composer" {...handlers}>
        <span data-testid="composer-outside">Outside the input frame</span>
        <div data-composer-focus-area data-testid="input-frame">
          <span data-testid="composer-blank">Blank input padding</span>
          <textarea aria-label="Draft" ref={input} defaultValue="hello world" />
          <a href="#composer-fixture">Composer link</a>
          <img alt="Composer media" />
          <button type="button" onClick={onAction}>
            <span>Prompt action</span>
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.focus();
              onAction();
            }}
          >
            Focus action
          </button>
          <button
            type="button"
            onClick={() => {
              file.current?.click();
            }}
          >
            Upload material
          </button>
          <input
            aria-label="Material file"
            ref={file}
            type="file"
            multiple
            hidden
            onClick={onFileClick}
          />
          <select aria-label="Protocol" defaultValue="chat">
            <option value="chat">Chat</option>
            <option value="gemini">Gemini</option>
          </select>
          <input aria-label="Effort" type="range" min={0} max={5} />
          <input aria-label="Inline name" defaultValue="name" />
          <div
            role="textbox"
            aria-label="Editable prompt"
            contentEditable
            suppressContentEditableWarning
            tabIndex={0}
          >
            editable
          </div>
          <button type="button" onClick={() => setPortal(true)}>
            Open popup
          </button>
          <button
            type="button"
            onClick={(event) => {
              input.current?.blur();
              event.currentTarget.blur();
              restoreAfterAction();
              restoreAfterAction();
            }}
          >
            Finish toolbar action
          </button>
          {portal &&
            createPortal(
              <div role="dialog" aria-label="Popup">
                <input aria-label="Popup search" />
                <span data-composer-focus-area data-testid="popup-blank">
                  Popup padding
                </span>
                <button type="button" onClick={onAction}>
                  Popup action
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPortal(false);
                    restoreAfterAction();
                  }}
                >
                  Close popup
                </button>
              </div>,
              document.body,
            )}
        </div>
      </div>
      <div
        ref={history}
        tabIndex={0}
        data-testid="chat-history"
        onPointerDown={() => {
          if (!closeOnPointerDown) return;
          setPortal(false);
          restoreAfterAction();
        }}
        onClick={() => {
          if (closeOnPointerDown) return;
          setPortal(false);
          restoreAfterAction();
        }}
      >
        Chat history
      </div>
      <div
        tabIndex={0}
        data-testid="other-focusable-region"
        onClick={() => {
          setPortal(false);
          restoreAfterAction();
        }}
      >
        Another region
      </div>
      <input aria-label="Outside field" />
      <button type="button" onClick={onAction}>
        Outside action
      </button>
    </>
  );
}

function pointerDown(element: Element, pointerType = "mouse", button = 0) {
  const event = new MouseEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    button,
  });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  Object.defineProperty(event, "isPrimary", { value: true });
  fireEvent(element, event);
}

function clickMouse(element: HTMLElement, button = 0) {
  pointerDown(element, "mouse", button);
  const allowDefault = fireEvent.mouseDown(element, { button });
  if (allowDefault) {
    const focusTarget = element.closest<HTMLElement>(
      "button, input, select, textarea, [tabindex], [contenteditable]",
    );
    act(() => focusTarget?.focus());
  }
  fireEvent.mouseUp(element, { button });
  fireEvent.click(element, { button, detail: 1 });
  return allowDefault;
}

function draft() {
  return screen.getByRole("textbox", { name: "Draft" }) as HTMLTextAreaElement;
}

function closeFocusedPopupOnPointerDown() {
  const input = draft();
  input.focus();
  clickMouse(screen.getByRole("button", { name: "Open popup" }));
  clickMouse(screen.getByRole("textbox", { name: "Popup search" }));
  pointerDown(screen.getByTestId("chat-history"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  return input;
}

function insertFirstCharacter(character: string) {
  const active = document.activeElement;
  expect(active).toBe(draft());
  const input = active as HTMLTextAreaElement;
  const selection = input.selectionStart;
  input.setRangeText(
    character,
    input.selectionStart,
    input.selectionEnd,
    "end",
  );
  // jsdom places setRangeText's caret at the end even for insertion in the middle.
  input.setSelectionRange(
    selection + character.length,
    selection + character.length,
  );
  fireEvent.input(input, { inputType: "insertText", data: character });
  expect(input.selectionStart).toBe(selection + character.length);
}

test("mounting does not autofocus the composer or move focus from another input", () => {
  const outside = document.createElement("input");
  document.body.append(outside);
  outside.focus();
  const focus = jest.spyOn(HTMLTextAreaElement.prototype, "focus");
  const { unmount } = render(<Harness />);
  expect(outside).toHaveFocus();
  expect(focus).not.toHaveBeenCalled();
  unmount();
  outside.remove();
});

test("mouse toolbar actions preserve the draft selection, execute the click, and accept the first typed character", () => {
  const onAction = jest.fn();
  render(<Harness onAction={onAction} />);
  const input = draft();
  input.focus();
  input.setSelectionRange(6, 11);
  const focus = jest.spyOn(input, "focus");
  const allowDefault = clickMouse(screen.getByText("Prompt action"));
  expect(allowDefault).toBe(false);
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(6);
  expect(input.selectionEnd).toBe(11);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  insertFirstCharacter("你");
  expect(input).toHaveValue("hello 你");
});

test("a pointer-triggered explicit button.focus is redirected without losing the caret", () => {
  const onAction = jest.fn();
  render(<Harness onAction={onAction} />);
  const input = draft();
  input.focus();
  input.setSelectionRange(3, 3);
  clickMouse(screen.getByRole("button", { name: "Focus action" }));
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(3);
  expect(onAction).toHaveBeenCalledTimes(1);
  insertFirstCharacter("A");
  expect(input).toHaveValue("helAlo world");
});

test("desktop mouse toolbar interaction can return from an outside field to the draft", () => {
  render(<Harness />);
  const input = draft();
  input.setSelectionRange(5, 5);
  screen.getByRole("textbox", { name: "Outside field" }).focus();
  clickMouse(screen.getByRole("button", { name: "Prompt action" }));
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(5);
});

test.each([false, true])(
  "clicking input padding restores the caret and accepts the first character (mobile: %s)",
  (mobile) => {
    render(<Harness mobile={mobile} />);
    const input = draft();
    input.setSelectionRange(5, 5);
    screen.getByRole("textbox", { name: "Outside field" }).focus();
    const focus = jest.spyOn(input, "focus");
    const blank = screen.getByTestId("composer-blank");
    if (mobile) {
      pointerDown(blank, "touch");
      fireEvent.click(blank, { button: 0, detail: 1 });
    } else {
      clickMouse(blank);
    }
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(5);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    insertFirstCharacter("A");
    expect(input).toHaveValue("helloA world");
  },
);

test("blank delegation does not focus the draft a second time for a toolbar button", () => {
  render(<Harness />);
  const input = draft();
  input.focus();
  const focus = jest.spyOn(input, "focus");
  clickMouse(screen.getByRole("button", { name: "Prompt action" }));
  expect(input).toHaveFocus();
  expect(focus).toHaveBeenCalledTimes(1);
});

test.each([
  ["link", "Composer link"],
  ["img", "Composer media"],
] as const)(
  "clicking composer %s does not treat it as input padding",
  (role, name) => {
    render(<Harness />);
    screen.getByRole("textbox", { name: "Outside field" }).focus();
    const focus = jest.spyOn(draft(), "focus");
    clickMouse(screen.getByRole(role, { name }));
    expect(focus).not.toHaveBeenCalled();
  },
);

test("composer padding outside the marked input frame does not take draft focus", () => {
  render(<Harness />);
  screen.getByRole("textbox", { name: "Outside field" }).focus();
  const focus = jest.spyOn(draft(), "focus");
  clickMouse(screen.getByTestId("composer-outside"));
  expect(focus).not.toHaveBeenCalled();
});

test.each([
  { button: 2 },
  { button: 0, altKey: true },
  { button: 0, ctrlKey: true },
  { button: 0, metaKey: true },
  { button: 0, shiftKey: true },
])(
  "a modified or secondary padding click %p does not focus the draft",
  (event) => {
    render(<Harness />);
    screen.getByRole("textbox", { name: "Outside field" }).focus();
    const focus = jest.spyOn(draft(), "focus");
    fireEvent.click(screen.getByTestId("composer-blank"), {
      ...event,
      detail: 1,
    });
    expect(focus).not.toHaveBeenCalled();
  },
);

test("a portaled padding click remains outside the composer focus area", () => {
  render(<Harness />);
  clickMouse(screen.getByRole("button", { name: "Open popup" }));
  screen.getByRole("textbox", { name: "Popup search" }).focus();
  const focus = jest.spyOn(draft(), "focus");
  clickMouse(screen.getByTestId("popup-blank"));
  expect(focus).not.toHaveBeenCalled();
});

test.each(["Tab", "Enter", " "])(
  "keyboard %s access keeps a focused action button available to keyboard users",
  (key) => {
    const onAction = jest.fn();
    render(<Harness onAction={onAction} />);
    const input = draft();
    input.focus();
    const button = screen.getByRole("button", { name: "Focus action" });
    fireEvent.keyDown(input, { key: "Tab" });
    act(() => button.focus());
    fireEvent.keyDown(button, { key });
    if (key !== "Tab") fireEvent.click(button, { detail: 0 });
    expect(button).toHaveFocus();
    expect(onAction).toHaveBeenCalledTimes(key === "Tab" ? 0 : 1);
  },
);

test("keyboard navigation after a mouse action clears pointer-only focus redirection", () => {
  render(<Harness />);
  draft().focus();
  clickMouse(screen.getByRole("button", { name: "Prompt action" }));
  const button = screen.getByRole("button", { name: "Focus action" });
  fireEvent.keyDown(draft(), { key: "Tab" });
  act(() => button.focus());
  expect(button).toHaveFocus();
});

test("Tab originating outside the composer clears an earlier mouse focus mode", () => {
  render(<Harness />);
  draft().focus();
  clickMouse(screen.getByRole("button", { name: "Prompt action" }));
  const outside = screen.getByRole("textbox", { name: "Outside field" });
  act(() => outside.focus());
  expect(fireEvent.keyDown(outside, { key: "Tab" })).toBe(true);
  const button = screen.getByRole("button", { name: "Focus action" });
  act(() => button.focus());
  expect(button).toHaveFocus();
  fireEvent.click(button, { detail: 0 });
  expect(button).toHaveFocus();
});

test.each(["touch", "pen"])(
  "%s toolbar interaction does not force the virtual keyboard to open",
  (pointerType) => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Prompt action" });
    const focus = jest.spyOn(draft(), "focus");
    pointerDown(button, pointerType);
    act(() => button.focus());
    fireEvent.click(button);
    expect(button).toHaveFocus();
    expect(focus).not.toHaveBeenCalled();
  },
);

test("mobile toolbar clicks leave focus with the operated control", () => {
  render(<Harness mobile />);
  const button = screen.getByRole("button", { name: "Focus action" });
  const focus = jest.spyOn(draft(), "focus");
  expect(clickMouse(button)).toBe(true);
  expect(button).toHaveFocus();
  expect(focus).not.toHaveBeenCalled();
});

test.each([
  ["combobox", "Protocol"],
  ["slider", "Effort"],
  ["textbox", "Inline name"],
  ["textbox", "Editable prompt"],
] as const)(
  "%s %s remains focusable and is not treated as a toolbar action",
  (role, name) => {
    render(<Harness />);
    draft().focus();
    const control = screen.getByRole(role, { name });
    const focus = jest.spyOn(draft(), "focus");
    expect(clickMouse(control)).toBe(true);
    expect(control).toHaveFocus();
    expect(focus).not.toHaveBeenCalled();
  },
);

test("secondary mouse buttons do not trigger composer focus management", () => {
  render(<Harness />);
  const outside = screen.getByRole("textbox", { name: "Outside field" });
  outside.focus();
  const button = screen.getByRole("button", { name: "Prompt action" });
  const focus = jest.spyOn(draft(), "focus");
  pointerDown(button, "mouse", 2);
  expect(fireEvent.mouseDown(button, { button: 2 })).toBe(true);
  expect(outside).toHaveFocus();
  expect(focus).not.toHaveBeenCalled();
});

test("a popup portal escapes composer focus capture despite its React ancestry", () => {
  const onAction = jest.fn();
  render(<Harness onAction={onAction} />);
  draft().focus();
  clickMouse(screen.getByRole("button", { name: "Open popup" }));
  const search = screen.getByRole("textbox", { name: "Popup search" });
  expect(clickMouse(search)).toBe(true);
  expect(search).toHaveFocus();
  const button = screen.getByRole("button", { name: "Popup action" });
  expect(clickMouse(button)).toBe(true);
  expect(button).toHaveFocus();
  expect(onAction).toHaveBeenCalledTimes(1);
});

test("buttons outside the composer remain outside its focus policy", () => {
  const onAction = jest.fn();
  render(<Harness onAction={onAction} />);
  draft().focus();
  const button = screen.getByRole("button", { name: "Outside action" });
  expect(clickMouse(button)).toBe(true);
  expect(button).toHaveFocus();
  expect(onAction).toHaveBeenCalledTimes(1);
});

test.each(["change", "cancel"])(
  "file %s immediately restores the caret after the chooser without waiting for material processing",
  (eventName) => {
    const onFileClick = jest.fn();
    render(<Harness onFileClick={onFileClick} />);
    const input = draft();
    input.focus();
    input.setSelectionRange(4, 7);
    clickMouse(screen.getByRole("button", { name: "Upload material" }));
    expect(onFileClick).toHaveBeenCalledTimes(1);
    input.blur();
    expect(document.activeElement).toBe(document.body);
    const file = screen.getByLabelText("Material file");
    fireEvent(file, new Event(eventName, { bubbles: true }));
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(4);
    expect(input.selectionEnd).toBe(7);
  },
);

test.each(["change", "cancel"])(
  "file %s never takes focus from a different input",
  (eventName) => {
    render(<Harness />);
    draft().focus();
    clickMouse(screen.getByRole("button", { name: "Upload material" }));
    const outside = screen.getByRole("textbox", { name: "Outside field" });
    act(() => outside.focus());
    fireEvent(
      screen.getByLabelText("Material file"),
      new Event(eventName, { bubbles: true }),
    );
    expect(outside).toHaveFocus();
    act(() => jest.runOnlyPendingTimers());
    expect(outside).toHaveFocus();
  },
);

test("upload completion does not schedule delayed focus grabs", () => {
  render(<Harness />);
  draft().focus();
  clickMouse(screen.getByRole("button", { name: "Upload material" }));
  fireEvent.change(screen.getByLabelText("Material file"));
  const outside = screen.getByRole("textbox", { name: "Outside field" });
  act(() => outside.focus());
  act(() => jest.advanceTimersByTime(30_000));
  fireEvent.focus(window);
  expect(outside).toHaveFocus();
});

test("file events on mobile do not force the draft keyboard to reopen", () => {
  render(<Harness mobile />);
  const focus = jest.spyOn(draft(), "focus");
  clickMouse(screen.getByRole("button", { name: "Upload material" }));
  fireEvent.change(screen.getByLabelText("Material file"));
  fireEvent(screen.getByLabelText("Material file"), new Event("cancel"));
  expect(focus).not.toHaveBeenCalled();
});

test("unmount removes file listeners and pending focus work", () => {
  const { unmount } = render(<Harness />);
  const input = draft();
  const file = screen.getByLabelText("Material file");
  input.focus();
  clickMouse(screen.getByRole("button", { name: "Upload material" }));
  input.blur();
  const focus = jest.spyOn(input, "focus");
  unmount();
  fireEvent(file, new Event("change"));
  fireEvent(file, new Event("cancel"));
  fireEvent.focus(window);
  act(() => jest.runOnlyPendingTimers());
  expect(focus).not.toHaveBeenCalled();
});

test("finishing a mouse action restores the caret synchronously before the first character", () => {
  render(<Harness />);
  const input = draft();
  input.focus();
  input.setSelectionRange(3, 8);
  clickMouse(screen.getByRole("button", { name: "Finish toolbar action" }));
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(3);
  expect(input.selectionEnd).toBe(8);
  insertFirstCharacter("A");
  expect(input).toHaveValue("helArld");
  const focus = jest.spyOn(input, "focus");
  act(() => jest.advanceTimersByTime(1000));
  expect(focus).not.toHaveBeenCalled();
});

test("closing a portaled nonmodal popup restores the draft after commit before the first character", async () => {
  render(<Harness />);
  const input = draft();
  input.focus();
  input.setSelectionRange(2, 2);
  clickMouse(screen.getByRole("button", { name: "Open popup" }));
  const close = screen.getByRole("button", { name: "Close popup" });
  act(() => close.focus());
  await act(async () => {
    clickMouse(close);
  });
  act(() => jest.runAllTicks());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(2);
  insertFirstCharacter("A");
  expect(input).toHaveValue("heAllo world");
});

test("scheduled action restore leaves a newly focused field alone", () => {
  render(<Harness closeOnPointerDown />);
  closeFocusedPopupOnPointerDown();
  const outside = screen.getByRole("textbox", { name: "Outside field" });
  act(() => outside.focus());
  const focus = jest.spyOn(draft(), "focus");
  act(() => jest.advanceTimersByTime(20));
  expect(outside).toHaveFocus();
  expect(focus).not.toHaveBeenCalled();
});

test("closing a popup on history pointerdown restores the caret by click completion before the first character", () => {
  render(<Harness closeOnPointerDown />);
  const input = draft();
  input.focus();
  input.setSelectionRange(4, 4);
  clickMouse(screen.getByRole("button", { name: "Open popup" }));
  clickMouse(screen.getByRole("textbox", { name: "Popup search" }));
  const history = screen.getByTestId("chat-history");
  pointerDown(history);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(fireEvent.mouseDown(history)).toBe(true);
  act(() => history.focus());
  expect(history).toHaveFocus();
  fireEvent.mouseUp(history);
  fireEvent.click(history);
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(4);
  insertFirstCharacter("A");
  expect(input).toHaveValue("hellAo world");
  const focus = jest.spyOn(input, "focus");
  act(() => jest.advanceTimersByTime(20));
  expect(focus).not.toHaveBeenCalled();
});

test("the history exception does not take focus from another tabbable region", () => {
  render(<Harness />);
  draft().focus();
  clickMouse(screen.getByRole("button", { name: "Open popup" }));
  const other = screen.getByTestId("other-focusable-region");
  expect(clickMouse(other)).toBe(true);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(other).toHaveFocus();
  const focus = jest.spyOn(draft(), "focus");
  act(() => jest.advanceTimersByTime(20));
  expect(other).toHaveFocus();
  expect(focus).not.toHaveBeenCalled();
});

test("scheduled action restore does not focus behind an opened modal", () => {
  render(<Harness closeOnPointerDown />);
  closeFocusedPopupOnPointerDown();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  document.body.append(dialog);
  const focus = jest.spyOn(draft(), "focus");
  act(() => jest.advanceTimersByTime(20));
  expect(focus).not.toHaveBeenCalled();
  dialog.remove();
});

test("a Tab before the next frame invalidates a pending mouse restore", () => {
  render(<Harness closeOnPointerDown />);
  closeFocusedPopupOnPointerDown();
  fireEvent.keyDown(document.body, { key: "Tab" });
  const focus = jest.spyOn(draft(), "focus");
  act(() => jest.advanceTimersByTime(20));
  expect(focus).not.toHaveBeenCalled();
});

test("keyboard actions do not queue a mouse-style textarea restore", () => {
  render(<Harness />);
  draft().focus();
  fireEvent.keyDown(draft(), { key: "Tab" });
  const finish = screen.getByRole("button", { name: "Finish toolbar action" });
  act(() => finish.focus());
  fireEvent.keyDown(finish, { key: "Enter" });
  fireEvent.click(finish, { detail: 0 });
  const focus = jest.spyOn(draft(), "focus");
  act(() => jest.advanceTimersByTime(20));
  expect(focus).not.toHaveBeenCalled();
});

test("mobile action completion does not reopen the virtual keyboard", () => {
  render(<Harness mobile />);
  const focus = jest.spyOn(draft(), "focus");
  clickMouse(screen.getByRole("button", { name: "Finish toolbar action" }));
  act(() => jest.advanceTimersByTime(20));
  expect(focus).not.toHaveBeenCalled();
});

test("unmount cancels a queued action restore", () => {
  const { unmount } = render(<Harness closeOnPointerDown />);
  const input = closeFocusedPopupOnPointerDown();
  const focus = jest.spyOn(input, "focus");
  unmount();
  act(() => jest.advanceTimersByTime(20));
  expect(focus).not.toHaveBeenCalled();
});
