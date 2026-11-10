import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  cleanup,
} from "@testing-library/react";
import { jest } from "@jest/globals";

for (const icon of [
  "three-dots",
  "close",
  "eye",
  "eye-off",
  "down",
  "confirm",
  "cancel",
  "clear",
  "max",
  "min",
]) {
  jest.unstable_mockModule(`@/app/icons/${icon}.svg`, () => ({
    default: () => <svg />,
  }));
}
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    UI: { Confirm: "Confirm", Cancel: "Cancel", Close: "Close" },
    Chat: {
      Actions: {
        FullScreen: "Full Screen",
        ExitFullScreen: "Exit Full Screen",
      },
      ShortcutKey: { Title: "Shortcuts" },
      EditMessage: {
        Title: "Edit Messages",
        Topic: { Title: "Topic", SubTitle: "Conversation name" },
      },
    },
  },
}));
jest.unstable_mockModule("@/app/components/emoji", () => ({
  Avatar: () => null,
}));
jest.unstable_mockModule("@/app/components/mask-config", () => ({
  ContextPrompts: () => null,
}));
const updateTargetSession = jest.fn();
const session = { topic: "Topic", messages: [{ content: "Original" }] };
jest.unstable_mockModule("@/app/store", () => ({
  useChatStore: () => ({
    currentSession: () => session,
    updateTargetSession,
  }),
}));
const { EditMessageModal, ShortcutKeyModal } = await import(
  "../app/components/chat-modals"
);

beforeEach(() => {
  jest.useFakeTimers();
  updateTargetSession.mockClear();
});
afterEach(() => {
  cleanup();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

test("shortcut modal shares a single completion across repeated close actions", () => {
  const close = jest.fn();
  render(<ShortcutKeyModal onClose={close} />);
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  expect(document.querySelector(".modal-mask")).toHaveClass("modal-closing");
  fireEvent.animationEnd(document.querySelector(".modal-mask")!);
  expect(close).toHaveBeenCalledTimes(1);
  act(() => jest.advanceTimersByTime(180));
  expect(close).toHaveBeenCalledTimes(1);
});

test("shortcut backdrop closes after its exit while clicks inside stay open", () => {
  const close = jest.fn();
  render(<ShortcutKeyModal onClose={close} />);
  const mask = document.querySelector<HTMLElement>(".modal-mask")!;
  const dialog = screen.getByRole("dialog", { name: "Shortcuts" });

  fireEvent.click(dialog);
  fireEvent.click(screen.getByText("Shortcuts"));
  expect(mask).not.toHaveClass("modal-closing");
  expect(close).not.toHaveBeenCalled();

  fireEvent.click(mask);
  fireEvent.click(mask);
  expect(mask).toHaveClass("modal-closing");
  expect(close).not.toHaveBeenCalled();
  fireEvent.animationEnd(dialog);
  expect(close).not.toHaveBeenCalled();
  fireEvent.animationEnd(mask);
  expect(close).toHaveBeenCalledTimes(1);
  act(() => jest.advanceTimersByTime(180));
  expect(close).toHaveBeenCalledTimes(1);
});

test.each(["Confirm", "Cancel"])(
  "message editor commits only its first %s choice after the exit",
  (choice) => {
    const close = jest.fn();
    render(<EditMessageModal onClose={close} />);
    expect(screen.getByRole("textbox", { name: "Topic" })).toHaveValue("Topic");
    fireEvent.click(screen.getByRole("button", { name: choice }));
    fireEvent.click(
      screen.getByRole("button", {
        name: choice === "Confirm" ? "Cancel" : "Confirm",
      }),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(updateTargetSession).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(180));
    expect(close).toHaveBeenCalledTimes(1);
    expect(updateTargetSession).toHaveBeenCalledTimes(
      choice === "Confirm" ? 1 : 0,
    );
    if (choice === "Confirm") {
      expect(updateTargetSession).toHaveBeenCalledWith(
        session,
        expect.any(Function),
      );
    }
  },
);
