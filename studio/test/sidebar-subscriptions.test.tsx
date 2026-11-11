import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";
import { create } from "zustand";
import type { useSidebarResize } from "../app/components/use-sidebar-resize";

type ConfigState = {
  sidebarWidth: number;
  modelConfig: { temperature: number };
  update: (updater: (state: ConfigState) => void) => void;
};
const update = jest.fn<(updater: (state: ConfigState) => void) => void>(
  (updater) => {
    const next = { ...useAppConfig.getState() };
    updater(next);
    useAppConfig.setState(next);
  },
);
const useAppConfig = create<ConfigState>(() => ({
  sidebarWidth: 260,
  modelConfig: { temperature: 0.4 },
  update,
}));
const originalNext = jest.fn<(delta: number) => void>();
const useChatStore = create(() => ({
  nextSession: originalNext,
  streamedBody: "",
}));
jest.unstable_mockModule("@/app/store", () => ({
  useAppConfig,
  useChatStore,
}));
let mobile = false;
jest.unstable_mockModule("@/app/utils", () => ({
  useMobileScreen: () => mobile,
  isIOS: () => false,
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: { SearchChat: { Page: { Title: "Search chats" } } },
}));
jest.unstable_mockModule("@/app/mcp/availability", () => ({
  isMcpAvailable: jest.fn<() => Promise<boolean>>().mockResolvedValue(false),
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  Selector: () => null,
}));
let resizeOptions: Parameters<typeof useSidebarResize>[0];
const resizeHandlers = {
  onPointerDown: jest.fn(),
  onKeyDown: jest.fn(),
  shouldNarrow: false,
};
jest.unstable_mockModule("@/app/components/use-sidebar-resize", () => ({
  useSidebarResize: (options: Parameters<typeof useSidebarResize>[0]) => {
    resizeOptions = options;
    return resizeHandlers;
  },
}));
const { useHotKey, useDragSideBar } = await import("../app/components/sidebar");

let renders = 0;
function Harness({ revision: _revision = 0 }: { revision?: number }) {
  renders++;
  useHotKey();
  const resize = useDragSideBar();
  return <output data-testid="width">{resize.width}</output>;
}

beforeEach(() => {
  mobile = false;
  renders = 0;
  originalNext.mockClear();
  update.mockClear();
  useChatStore.setState({ nextSession: originalNext, streamedBody: "" });
  useAppConfig.setState({
    sidebarWidth: 260,
    modelConfig: { temperature: 0.4 },
  });
});

test("streaming and unrelated config changes do not render sidebar hooks", () => {
  render(<Harness />);
  const initialRenders = renders;
  act(() => {
    useChatStore.setState({ streamedBody: "A streamed update" });
    useAppConfig.setState({ modelConfig: { temperature: 0.9 } });
  });
  expect(renders).toBe(initialRenders);
  expect(screen.getByTestId("width")).toHaveTextContent("260");
});

test("keyboard navigation uses the latest action without subscribing to chat", () => {
  const result = render(<Harness />);
  const initialRenders = renders;
  const next = jest.fn<(delta: number) => void>();
  act(() => useChatStore.setState({ nextSession: next }));
  expect(renders).toBe(initialRenders);
  fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });
  fireEvent.keyDown(window, { key: "ArrowDown", ctrlKey: true });
  expect(next.mock.calls).toEqual([[-1], [1]]);
  expect(originalNext).not.toHaveBeenCalled();
  result.unmount();
  fireEvent.keyDown(window, { key: "ArrowDown", ctrlKey: true });
  expect(next).toHaveBeenCalledTimes(2);
});

test("width updates stay reactive and keep the resize callback stable", () => {
  const result = render(<Harness />);
  const onWidthChange = resizeOptions.onWidthChange;
  act(() => onWidthChange(320));
  expect(update).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("width")).toHaveTextContent("320");
  expect(
    document.documentElement.style.getPropertyValue("--sidebar-width"),
  ).toBe("320px");
  expect(resizeOptions.onWidthChange).toBe(onWidthChange);
  mobile = true;
  result.rerender(<Harness revision={1} />);
  expect(resizeOptions.isMobile).toBe(true);
  expect(
    document.documentElement.style.getPropertyValue("--sidebar-width"),
  ).toBe("100vw");
});
