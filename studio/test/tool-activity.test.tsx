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
import type { ChatMessageTool } from "../app/store/chat";

const copy = jest.fn<(value: string) => Promise<void>>().mockResolvedValue();
jest.unstable_mockModule("@/app/utils", () => ({ copyToClipboard: copy }));
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    Chat: {
      Activity: {
        thinking: "正在思考",
        researching: "正在搜索",
        writing: "正在撰写",
        done: "已完成",
        error: "执行失败",
        Sources: (count: number) => `${count} 个来源`,
      },
    },
  },
}));
jest.unstable_mockModule("@/app/components/ai-status", () => ({
  AiStatus: ({ state, label }: { state: string; label: string }) => (
    <span role="status" data-state={state}>
      {label}
    </span>
  ),
}));
const { ToolActivity } = await import("../app/components/tool-activity");

afterEach(() => {
  cleanup();
  copy.mockClear();
});

function call(overrides: Partial<ChatMessageTool> = {}): ChatMessageTool {
  return {
    id: "call-1",
    function: {
      name: "calculator",
      arguments:
        '{"query":"old","count":2,"exact":true,"options":{"unit":"c"}}',
    },
    isError: false,
    content: '{"answer":42}',
    ...overrides,
  };
}

function expand() {
  const card = screen.getByTestId("tool-result-card");
  card.setAttribute("open", "");
  fireEvent(card, new Event("toggle"));
  return card;
}

test("shows execution state, structured result and a copyable original output", async () => {
  render(<ToolActivity tool={call()} />);
  expect(screen.getByRole("status")).toHaveAttribute("data-state", "done");
  expand();
  const result = screen.getByRole("region", { name: "工具结果" });
  expect(within(result).getByText("answer")).toBeInTheDocument();
  expect(within(result).getByText("42")).toBeInTheDocument();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "复制工具结果" })),
  );
  expect(copy).toHaveBeenCalledWith('{"answer":42}');
  expect(
    screen.getByRole("button", { name: "结果已复制" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "调整参数" })).toBeNull();
});

test("keeps unsafe source links and raw HTML inert", () => {
  render(
    <ToolActivity
      tool={call({
        function: { name: "web_search", arguments: '{"query":"Octopus"}' },
        content: JSON.stringify({
          results: [
            {
              title: "Docs",
              url: "https://example.com/docs",
              snippet: "Excerpt",
            },
            { title: "Bad", url: "javascript:alert(1)" },
            { title: "Credentials", url: "https://user:secret@example.com" },
          ],
        }),
      })}
    />,
  );
  expand();
  const links = screen.getAllByRole("link");
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute("href", "https://example.com/docs");
  expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
  cleanup();
  const { container } = render(
    <ToolActivity tool={call({ content: "<script>alert(1)</script>" })} />,
  );
  expand();
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
});

test("a provided execution handler receives edited values with their original types", async () => {
  const rerun = jest.fn<() => Promise<void>>().mockResolvedValue();
  const tool = call();
  render(<ToolActivity tool={tool} onRerun={rerun} />);
  expand();
  fireEvent.click(screen.getByRole("button", { name: "调整参数" }));
  fireEvent.change(screen.getByLabelText("query"), {
    target: { value: "new" },
  });
  fireEvent.change(screen.getByLabelText("count"), { target: { value: "3" } });
  fireEvent.click(screen.getByLabelText("exact"));
  fireEvent.change(screen.getByLabelText("options"), {
    target: { value: '{"unit":"f"}' },
  });
  await act(async () =>
    fireEvent.submit(screen.getByRole("form", { name: "调整工具参数" })),
  );
  expect(rerun).toHaveBeenCalledWith(tool, {
    query: "new",
    count: 3,
    exact: false,
    options: { unit: "f" },
  });
  expect(screen.queryByRole("form")).toBeNull();
});

test("invalid JSON stays in the form and never invokes the execution handler", async () => {
  const rerun = jest.fn<() => Promise<void>>().mockResolvedValue();
  render(<ToolActivity tool={call()} onRerun={rerun} />);
  expand();
  fireEvent.click(screen.getByRole("button", { name: "调整参数" }));
  fireEvent.change(screen.getByLabelText("options"), {
    target: { value: "{" },
  });
  await act(async () => fireEvent.submit(screen.getByRole("form")));
  expect(rerun).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("有效的 JSON");
  expect(screen.getByLabelText("options")).toHaveValue("{");
});

test("keeps an edited form pending across tool argument updates and preserves async errors", async () => {
  let reject!: (error: Error) => void;
  const request = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  const rerun = jest.fn<() => Promise<void>>().mockReturnValue(request);
  const { rerender } = render(<ToolActivity tool={call()} onRerun={rerun} />);
  expand();
  fireEvent.click(screen.getByRole("button", { name: "调整参数" }));
  fireEvent.change(screen.getByLabelText("query"), {
    target: { value: "new" },
  });
  fireEvent.submit(screen.getByRole("form"));
  expect(screen.getByRole("button", { name: "正在执行" })).toBeDisabled();
  rerender(
    <ToolActivity
      tool={call({
        function: {
          name: "calculator",
          arguments:
            '{"query":"new","count":2,"exact":true,"options":{"unit":"c"}}',
        },
        isError: undefined,
      })}
      onRerun={rerun}
      disabled
    />,
  );
  expect(screen.getByRole("button", { name: "正在执行" })).toBeDisabled();
  expect(screen.getByLabelText("query")).toHaveValue("new");
  await act(async () => reject(new Error("Connection interrupted")));
  expect(screen.getByRole("alert")).toHaveTextContent("Connection interrupted");
  expect(screen.getByRole("form")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "正在执行" })).toBeNull();
  expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
});

test("running and disabled calls cannot open a parameter form", () => {
  const rerun = jest.fn<() => Promise<void>>().mockResolvedValue();
  const { rerender } = render(
    <ToolActivity tool={call({ isError: undefined })} onRerun={rerun} />,
  );
  expand();
  expect(screen.queryByRole("button", { name: "调整参数" })).toBeNull();
  rerender(<ToolActivity tool={call()} onRerun={rerun} disabled />);
  expect(screen.getByRole("button", { name: "调整参数" })).toBeDisabled();
});

test("errors are visible and trusted named renderers receive parsed result data", () => {
  const tool = call({ isError: true, errorMsg: "Lookup unavailable" });
  const renderer = jest
    .fn<() => React.ReactNode>()
    .mockReturnValue(<output>Custom result</output>);
  render(<ToolActivity tool={tool} renderers={{ calculator: renderer }} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Lookup unavailable");
  expect(screen.getByText("Custom result")).toBeInTheDocument();
  expect(renderer).toHaveBeenCalledWith({
    tool,
    result: { answer: 42 },
    onRerun: undefined,
  });
});
