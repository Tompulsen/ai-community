import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";
import { ConversationSearch } from "../app/components/conversation-search";
import type { ConversationSearchMatch } from "../app/utils/conversation-search";

afterEach(cleanup);
const matches: ConversationSearchMatch[] = [
  { messageId: "first", messageIndex: 0, start: 0, end: 3 },
  { messageId: "second", messageIndex: 1, start: 5, end: 8 },
];

function props() {
  return {
    open: true,
    query: "key",
    currentIndex: 0,
    matches,
    onChange: jest.fn<(query: string) => void>(),
    onNavigate: jest.fn<(direction: 1 | -1) => void>(),
    onClose: jest.fn<() => void>(),
  };
}

test("opens only when requested, focuses the search input and exposes current progress", () => {
  const handlers = props();
  const { rerender } = render(
    <ConversationSearch {...handlers} open={false} />,
  );
  expect(screen.queryByRole("search")).toBeNull();
  rerender(<ConversationSearch {...handlers} />);
  expect(screen.getByRole("searchbox", { name: "搜索当前对话" })).toHaveFocus();
  expect(screen.getByRole("status")).toHaveTextContent("1 / 2");
  expect(screen.getByRole("search")).toHaveAttribute(
    "aria-label",
    "当前对话搜索",
  );
});

test("query updates, direction buttons and Enter shortcuts call their controlled handlers", () => {
  const handlers = props();
  render(<ConversationSearch {...handlers} />);
  const input = screen.getByRole("searchbox");
  fireEvent.change(input, { target: { value: "章鱼" } });
  expect(handlers.onChange).toHaveBeenCalledWith("章鱼");
  fireEvent.click(screen.getByRole("button", { name: "上一个匹配" }));
  fireEvent.click(screen.getByRole("button", { name: "下一个匹配" }));
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(handlers.onNavigate.mock.calls).toEqual([[-1], [1], [1], [-1]]);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(handlers.onClose).toHaveBeenCalledTimes(1);
});

test("empty results announce 0 / 0 and disable navigation without disabling query or close", () => {
  const handlers = props();
  render(<ConversationSearch {...handlers} matches={[]} currentIndex={-1} />);
  expect(screen.getByRole("status")).toHaveTextContent("0 / 0");
  expect(screen.getByRole("button", { name: "上一个匹配" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "下一个匹配" })).toBeDisabled();
  const input = screen.getByRole("searchbox");
  expect(input).toBeEnabled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(handlers.onNavigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "关闭对话搜索" }));
  expect(handlers.onClose).toHaveBeenCalledTimes(1);
});

test("Enter on a toolbar button preserves its native command instead of using the input shortcut", () => {
  const handlers = props();
  render(<ConversationSearch {...handlers} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "上一个匹配" }), {
    key: "Enter",
  });
  fireEvent.keyDown(screen.getByRole("button", { name: "关闭对话搜索" }), {
    key: "Enter",
  });
  expect(handlers.onNavigate).not.toHaveBeenCalled();
  expect(handlers.onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "关闭对话搜索" }));
  expect(handlers.onClose).toHaveBeenCalledTimes(1);
});

test("Chinese composition and its confirmation Enter do not navigate or close the toolbar", () => {
  const handlers = props();
  render(<ConversationSearch {...handlers} />);
  const input = screen.getByRole("searchbox");
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(handlers.onNavigate).not.toHaveBeenCalled();
  expect(handlers.onClose).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(handlers.onNavigate).not.toHaveBeenCalled();
  fireEvent.keyUp(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(handlers.onNavigate).toHaveBeenCalledWith(1);
});
