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
  MessageSources,
  SourceCitation,
} from "../app/components/message-sources";
import type { MessageSource } from "../app/utils/message-sources";

const source: MessageSource = {
  number: 2,
  title: "Octopus documentation",
  url: "https://example.com/docs",
  snippet: "A real excerpt provided by the search tool.",
};

beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

test("clicking a numbered citation opens a safe source preview without navigating", () => {
  render(<SourceCitation source={source} />);
  const trigger = screen.getByRole("button", {
    name: "来源 2：Octopus documentation",
  });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(trigger);
  const preview = screen.getByRole("dialog", { name: "来源 2" });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(trigger).toHaveAttribute("aria-controls", preview.id);
  expect(within(preview).getByText(source.snippet!)).toBeVisible();
  const link = within(preview).getByRole("link", { name: "打开来源" });
  expect(link).toHaveAttribute("href", source.url);
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(preview.querySelector("img")).toBeNull();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("keyboard focus previews a source, Tab enters it and Escape restores focus without reopening", () => {
  render(<SourceCitation source={source} />);
  const trigger = screen.getByRole("button", { name: /来源 2/ });
  act(() => trigger.focus());
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(trigger).toHaveFocus();
  fireEvent.keyDown(trigger, { key: "Tab" });
  const link = screen.getByRole("link", { name: "打开来源" });
  expect(link).toHaveFocus();
  fireEvent.keyDown(link, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("the close button returns focus to the citation without opening it again", () => {
  render(<SourceCitation source={source} />);
  const trigger = screen.getByRole("button", { name: /来源 2/ });
  fireEvent.click(trigger);
  const close = screen.getByRole("button", { name: "关闭来源预览" });
  act(() => close.focus());
  fireEvent.click(close);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
});

test("mouse hover opens a preview and leaving it closes only after the pointer can cross the gap", async () => {
  jest.useFakeTimers();
  render(<SourceCitation source={source} />);
  const trigger = screen.getByRole("button", { name: /来源 2/ });
  const enter = new Event("pointerover", { bubbles: true });
  Object.defineProperty(enter, "pointerType", { value: "mouse" });
  fireEvent(trigger, enter);
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.pointerLeave(trigger);
  act(() => jest.advanceTimersByTime(100));
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.pointerEnter(screen.getByRole("dialog"));
  act(() => jest.advanceTimersByTime(200));
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.pointerLeave(screen.getByRole("dialog"));
  act(() => jest.advanceTimersByTime(200));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("source lists keep explicit numbers, safe links and no fabricated rows", () => {
  const { rerender } = render(<MessageSources sources={[]} />);
  expect(screen.queryByTestId("message-sources")).toBeNull();
  rerender(
    <MessageSources
      sources={[
        source,
        { number: 3, title: "Unsafe", url: "javascript:alert(1)" },
      ]}
    />,
  );
  const list = screen.getByTestId("message-sources");
  expect(list).not.toHaveAttribute("open");
  expect(within(list).getByText("来源 · 1")).toBeInTheDocument();
  fireEvent.click(list.querySelector("summary")!);
  expect(list).toHaveAttribute("open");
  const link = within(list).getByRole("link");
  expect(link).toHaveAttribute("href", source.url);
  expect(within(list).getByText("2")).toBeVisible();
  expect(within(list).queryByText("Unsafe")).toBeNull();
});

test("unsafe citations stay absent and source text cannot inject markup", () => {
  const { container, rerender } = render(
    <SourceCitation source={{ ...source, url: "data:text/html,hi" }} />,
  );
  expect(container).toBeEmptyDOMElement();
  rerender(
    <SourceCitation
      source={{ ...source, title: "<script>alert(1)</script>" }}
    />,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getByText("<script>alert(1)</script>")).toBeVisible();
});
