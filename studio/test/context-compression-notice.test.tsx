import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { ContextCompressionNotice } from "../app/components/context-compression-notice";

afterEach(cleanup);

test("only a completed compression adds a quiet status without controls", () => {
  const { rerender, container } = render(<ContextCompressionNotice />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(container).toBeEmptyDOMElement();
  rerender(<ContextCompressionNotice compressed />);
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent("上下文已自动压缩");
  expect(status.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(status).toHaveAttribute("data-context-compressed");
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();
});

test("existing compression records remain visible across subsequent renders", () => {
  const { rerender } = render(<ContextCompressionNotice compressed />);
  const status = screen.getByRole("status");
  rerender(<ContextCompressionNotice compressed />);
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toBe(status);
});

test("running compression changes into the completed record in the same status row", () => {
  const { rerender } = render(<ContextCompressionNotice compressing />);
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent("上下文正在压缩");
  expect(status).toHaveTextContent("可能需要几分钟");
  expect(status).toHaveAttribute("data-context-compressing");
  expect(status).not.toHaveAttribute("data-context-compressed");
  expect(status.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  rerender(<ContextCompressionNotice compressed />);
  expect(screen.getByRole("status")).toBe(status);
  expect(status).toHaveTextContent("上下文已自动压缩");
  expect(status).not.toHaveTextContent("可能需要几分钟");
  expect(status).not.toHaveAttribute("data-context-compressing");
  expect(status).toHaveAttribute("data-context-compressed");
});

test("an interrupted compression disappears without reporting success", () => {
  const { rerender } = render(<ContextCompressionNotice compressing />);
  rerender(<ContextCompressionNotice />);
  expect(screen.queryByRole("status")).toBeNull();
});
