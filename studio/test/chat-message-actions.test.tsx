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
import {
  ChatMessageActions,
  type ChatMessageAction,
} from "../app/components/chat-action";

const mediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
const showDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query === "(max-width: 600px)",
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
      this.querySelector<HTMLButtonElement>("button")?.focus();
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{ width: 44, height: 44 }] as unknown as DOMRectList);
});

afterEach(() => {
  cleanup();
  act(() => jest.runOnlyPendingTimers());
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

function actions(): ChatMessageAction[] {
  return [
    ["retry", "重试"],
    ["reuse", "复用输入"],
    ["delete", "删除"],
    ["pin", "固定"],
    ["copy", "复制"],
    ["speech", "朗读"],
  ].map(([id, text]) => ({
    id,
    text,
    icon: <svg />,
    onClick: jest.fn(),
    destructive: id === "delete",
  }));
}

test("mobile keeps copy, retry and more visible without exposing destructive actions", () => {
  const choices = actions();
  render(<ChatMessageActions actions={choices} compact />);

  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["复制", "重试", "更多"]);
  expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "复制" }));
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(
    choices.find((action) => action.id === "copy")!.onClick,
  ).toHaveBeenCalledTimes(1);
  expect(
    choices.find((action) => action.id === "retry")!.onClick,
  ).toHaveBeenCalledTimes(1);
});

test("desktop retains the existing action order", () => {
  const choices = actions();
  render(<ChatMessageActions actions={choices} compact={false} />);

  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(choices.map((action) => action.text));
  expect(screen.queryByRole("button", { name: "更多消息操作" })).toBeNull();
});

test("more opens a focus-scoped sheet and runs a selected action once after exit", async () => {
  const choices = actions();
  render(<ChatMessageActions actions={choices} compact />);
  const trigger = screen.getByRole("button", { name: "更多消息操作" });
  trigger.focus();
  fireEvent.click(trigger);

  const dialog = screen.getByRole("dialog", { name: "消息操作" });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(trigger).toHaveAttribute("aria-controls", dialog.id);
  expect(
    within(dialog).getByRole("button", { name: "复用输入" }),
  ).toHaveFocus();
  expect(within(dialog).queryByRole("button", { name: "复制" })).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "重试" })).toBeNull();

  const remove = choices.find((action) => action.id === "delete")!.onClick;
  fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
  expect(dialog).toHaveAttribute("data-closing", "true");
  expect(remove).not.toHaveBeenCalled();

  await act(async () => jest.advanceTimersByTime(260));
  act(() => jest.runAllTicks());
  expect(remove).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
});

test("Escape dismisses more without running an action and restores its trigger", async () => {
  const choices = actions();
  render(<ChatMessageActions actions={choices} compact />);
  const trigger = screen.getByRole("button", { name: "更多消息操作" });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  await act(async () => jest.advanceTimersByTime(260));
  act(() => jest.runAllTicks());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
  expect(
    choices.every(
      (action) => jest.mocked(action.onClick).mock.calls.length === 0,
    ),
  ).toBe(true);
});

test("sheet keyboard focus wraps in both directions", () => {
  render(<ChatMessageActions actions={actions()} compact />);
  fireEvent.click(screen.getByRole("button", { name: "更多消息操作" }));
  const dialog = screen.getByRole("dialog");
  const first = within(dialog).getByRole("button", { name: "关闭" });
  const last = within(dialog).getByRole("button", { name: "朗读" });

  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(last).toHaveFocus();
});

test("an active speech stop action stays available on mobile", () => {
  const choices = actions().map((action) =>
    action.id === "speech"
      ? {
          ...action,
          text: "停止朗读",
          selected: true,
          keepVisible: true,
        }
      : action,
  );
  render(<ChatMessageActions actions={choices} compact />);

  const stop = screen.getByRole("button", { name: "停止朗读" });
  expect(stop).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(stop);
  expect(
    choices.find((action) => action.id === "speech")!.onClick,
  ).toHaveBeenCalledTimes(1);
});
