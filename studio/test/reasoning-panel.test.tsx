import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";

jest.unstable_mockModule("@/app/components/markdown", () => ({
  MarkdownContent: ({ content }: { content: string }) => <p>{content}</p>,
}));
const { ReasoningPanel } = await import("../app/components/reasoning-panel");
afterEach(cleanup);

test("stays absent when no reasoning was returned", () => {
  const { container } = render(<ReasoningPanel streaming />);
  expect(container).toBeEmptyDOMElement();
});

test("opens during reasoning and respects a user collapse as new chunks arrive", () => {
  const { rerender } = render(
    <ReasoningPanel content="First step" streaming />,
  );
  const trigger = screen.getByRole("button", { name: /思考过程/ });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("First step")).toBeVisible();
  fireEvent.click(trigger);
  rerender(<ReasoningPanel content="First step and next step" streaming />);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  const hidden = document.getElementById(
    trigger.getAttribute("aria-controls")!,
  );
  expect(hidden).toHaveAttribute("aria-hidden", "true");
  expect(hidden).toHaveAttribute("inert");
  expect(screen.getByText("First step and next step")).toBeInTheDocument();
});

test("collapses when the final answer starts and can be reopened", () => {
  const { rerender } = render(
    <ReasoningPanel content="Checked sources" streaming />,
  );
  rerender(<ReasoningPanel content="Checked sources" streaming hasAnswer />);
  const trigger = screen.getByRole("button", { name: /思考过程/ });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText("已完成")).toBeVisible();
  fireEvent.click(trigger);
  expect(screen.getByText("Checked sources")).toBeVisible();
});
