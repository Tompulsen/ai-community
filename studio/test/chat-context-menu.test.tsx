import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";
import type { ContextMenuState } from "../app/components/chat-context-menu";

jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    Chat: {
      Actions: {
        Copy: "Copy",
        Edit: "Edit",
        Retry: "Retry",
        Pin: "Pin",
        Delete: "Delete",
      },
    },
    Download: { Failed: "Download failed" },
  },
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showToast: jest.fn(),
}));
jest.unstable_mockModule("@/app/utils/image-download", () => ({
  downloadImage: jest.fn(),
}));
for (const icon of ["copy", "edit", "reload", "pin", "clear", "download"]) {
  jest.unstable_mockModule(`@/app/icons/${icon}.svg`, () => ({
    default: () => <svg aria-hidden="true" />,
  }));
}

const { ChatContextMenu, getMessageSelectionText } = await import(
  "../app/components/chat-context-menu"
);
const fullContent = "The complete answer.\n\nOnly this sentence is selected.";
const state: ContextMenuState = {
  x: 100,
  y: 100,
  content: fullContent,
  messageId: "message-one",
  isUser: false,
};

function renderMenu(snapshot: ContextMenuState = state) {
  const actions = {
    onClose: jest.fn(),
    onCopy: jest.fn(),
    onQuote: jest.fn(),
    onDelete: jest.fn(),
    onRetry: jest.fn(),
    onEdit: jest.fn(),
    onPin: jest.fn(),
  };
  render(<ChatContextMenu state={snapshot} {...actions} isStreaming={false} />);
  return actions;
}

afterEach(() => window.getSelection()?.removeAllRanges());

test("quotes the captured selection without replacing it with the full reply", () => {
  const actions = renderMenu({
    ...state,
    selectedText: "Only this sentence",
  });
  window.getSelection()?.removeAllRanges();
  fireEvent.click(screen.getByRole("button", { name: "引用选中文字" }));
  expect(actions.onQuote).toHaveBeenCalledWith("Only this sentence");
  expect(actions.onClose).toHaveBeenCalledTimes(1);
});

test.each([undefined, "", " \n\t "])(
  "does not offer an empty selection as a quote",
  (selectedText) => {
    renderMenu({ ...state, selectedText });
    expect(
      screen.queryByRole("button", { name: "引用选中文字" }),
    ).not.toBeInTheDocument();
  },
);

test("copy uses the captured selection even if clicking the menu clears the DOM selection", () => {
  const selected = { ...state, selectedText: "Only this sentence" };
  const actions = renderMenu(selected);
  window.getSelection()?.removeAllRanges();
  fireEvent.mouseDown(screen.getByText("Copy"));
  fireEvent.click(screen.getByText("Copy"));
  expect(actions.onCopy).toHaveBeenCalledWith(selected.selectedText);
  expect(actions.onClose).toHaveBeenCalledTimes(1);
});

test("copy without a selected-text snapshot still copies the complete message", () => {
  const actions = renderMenu();
  fireEvent.click(screen.getByText("Copy"));
  expect(actions.onCopy).toHaveBeenCalledWith(fullContent);
});

test("editing a selected user message keeps the complete source text", () => {
  const actions = renderMenu({
    ...state,
    isUser: true,
    selectedText: "Only this sentence",
  });
  fireEvent.click(screen.getByText("Edit"));
  expect(actions.onEdit).toHaveBeenCalledWith(fullContent);
  expect(actions.onCopy).not.toHaveBeenCalled();
});

test.each(["Retry", "Pin", "Delete"] as const)(
  "%s retains the original message ID",
  (name) => {
    const actions = renderMenu();
    fireEvent.click(screen.getByText(name));
    expect(
      { Retry: actions.onRetry, Pin: actions.onPin, Delete: actions.onDelete }[
        name
      ],
    ).toHaveBeenCalledWith(state.messageId);
  },
);

function select(start: Node, end = start, startOffset = 0, endOffset?: number) {
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset ?? end.textContent!.length);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

test("a selection across table cells and inline nodes captures the selected text", () => {
  const { container } = render(
    <article>
      <table>
        <tbody>
          <tr>
            <td>Host one</td>
            <td>
              Price <strong>15</strong>
            </td>
          </tr>
          <tr>
            <td>Host two</td>
            <td>Price 20</td>
          </tr>
        </tbody>
      </table>
    </article>,
  );
  const cells = container.querySelectorAll("td");
  const selection = select(cells[0].firstChild!, cells[3].firstChild!);
  expect(getMessageSelectionText(container)).toBe(selection.toString());
});

test("code selection preserves leading spaces and line breaks", () => {
  const excerpt = "  first();\n    second();\n";
  const { container } = render(<pre>{`${excerpt}last();`}</pre>);
  select(
    container.querySelector("pre")!.firstChild!,
    undefined,
    0,
    excerpt.length,
  );
  expect(getMessageSelectionText(container)).toBe(excerpt);
});

test("a whitespace-only code selection does not fall back to the full reply", () => {
  const { container } = render(<pre>{"    indent();"}</pre>);
  select(container.querySelector("pre")!.firstChild!, undefined, 0, 4);
  expect(getMessageSelectionText(container)).toBe("    ");
});

test("collapsed and absent selections produce no snapshot", () => {
  const { container } = render(<article>Answer</article>);
  const selection = select(container.firstChild!.firstChild!, undefined, 2, 2);
  expect(getMessageSelectionText(container)).toBeUndefined();
  selection.removeAllRanges();
  expect(getMessageSelectionText(container)).toBeUndefined();
  expect(getMessageSelectionText(null)).toBeUndefined();
});

test("a selection from another message is not copied by the current message", () => {
  const { container } = render(
    <>
      <article>First answer</article>
      <article>Second answer</article>
    </>,
  );
  const [first, second] = container.querySelectorAll("article");
  select(first.firstChild!);
  expect(getMessageSelectionText(second)).toBeUndefined();
});

test("a cross-message selection does not become either message's copy snapshot", () => {
  const { container } = render(
    <>
      <article>First answer</article>
      <article>Second answer</article>
    </>,
  );
  const [first, second] = container.querySelectorAll("article");
  select(first.firstChild!, second.firstChild!);
  expect(getMessageSelectionText(first)).toBeUndefined();
  expect(getMessageSelectionText(second)).toBeUndefined();
});
