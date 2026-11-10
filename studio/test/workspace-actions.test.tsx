import React from "react";
import { cleanup, render } from "@testing-library/react";
import { jest } from "@jest/globals";
import {
  dispatchWorkspaceAction,
  getLastChatCode,
  useWorkspaceActions,
  type WorkspaceAction,
} from "../app/components/workspace-actions";

afterEach(cleanup);

function ActionListener({
  actions,
}: {
  actions: Partial<Record<WorkspaceAction, () => void>>;
}) {
  useWorkspaceActions(actions);
  return null;
}

test.each([
  "focus-input",
  "copy-last-code",
  "copy-last-reply",
] satisfies WorkspaceAction[])(
  "workspace %s reaches the current callback and detaches on unmount",
  (action) => {
    const previous = jest.fn();
    const current = jest.fn();
    const unrelated = jest.fn();
    const { rerender, unmount } = render(
      <ActionListener actions={{ [action]: previous, search: unrelated }} />,
    );
    dispatchWorkspaceAction(action);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(unrelated).not.toHaveBeenCalled();

    rerender(
      <ActionListener actions={{ [action]: current, search: unrelated }} />,
    );
    dispatchWorkspaceAction(action);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(current).toHaveBeenCalledTimes(1);

    unmount();
    dispatchWorkspaceAction(action);
    expect(current).toHaveBeenCalledTimes(1);
  },
);

test("last chat code preserves code whitespace and excludes controls and other chats", () => {
  const { container } = render(
    <>
      <div data-testid="current-chat">
        <pre>
          <code>first block</code>
        </pre>
        <div>
          <button>Copy</button>
          <pre data-collapsed>
            <code>
              <span>{"const text = "}</span>
              <span>{'"current";\n  return text;\n'}</span>
            </code>
          </pre>
          <button>Expand code</button>
        </div>
        <p>
          <code>later inline code</code>
        </p>
      </div>
      <div data-testid="other-chat">
        <pre>
          <code>unrelated block</code>
        </pre>
      </div>
    </>,
  );
  expect(
    getLastChatCode(container.querySelector('[data-testid="current-chat"]')),
  ).toBe('const text = "current";\n  return text;\n');
});

test("copying a code block from an empty or unmounted chat is a safe no-op", () => {
  expect(getLastChatCode(null)).toBeUndefined();
  expect(getLastChatCode(document.createElement("div"))).toBeUndefined();
});
