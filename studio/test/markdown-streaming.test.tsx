import React from "react";
import { act, render, screen, cleanup } from "@testing-library/react";
import { jest } from "@jest/globals";
import { create } from "zustand";

type MarkdownChatState = {
  session: {
    mask: { enableCodeFold?: boolean; enableArtifacts?: boolean };
  };
  tick: number;
  currentSession: () => MarkdownChatState["session"];
};
const useMarkdownChatStore = create<MarkdownChatState>((_set, get) => ({
  session: { mask: {} },
  tick: 0,
  currentSession: () => get().session,
}));
const useMarkdownConfig = create(() => ({
  enableCodeFold: true,
  enableArtifacts: true,
  fontSize: 14,
}));
const codeBlockSelections = jest.fn();

jest.unstable_mockModule("@/app/utils", () => ({
  copyToClipboard: jest.fn(),
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    Copy: { Success: "Copied" },
    Chat: {
      Actions: { Copy: "Copy" },
      CodeBlock: { Expand: "Expand", Collapse: "Collapse", Lines: String },
    },
    Export: { Artifacts: { Reload: "Reload" } },
  },
}));
jest.unstable_mockModule("@/app/icons/reload.svg", () => ({
  default: () => <svg />,
}));
jest.unstable_mockModule("@/app/store", () => ({
  useChatStore: <T,>(selector: (state: MarkdownChatState) => T) => {
    codeBlockSelections();
    return useMarkdownChatStore(selector);
  },
}));
jest.unstable_mockModule("@/app/store/config", () => ({
  useAppConfig: useMarkdownConfig,
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showImageModal: jest.fn(),
  FullScreen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.unstable_mockModule("@/app/components/artifacts-share-button", () => ({
  ArtifactsShareButton: () => null,
}));
jest.unstable_mockModule("@/app/components/html-preview", () => ({
  HTMLPreview: React.forwardRef(function Preview(_props, _ref) {
    return <div data-testid="html-preview" />;
  }),
}));
jest.unstable_mockModule("@/app/components/button", () => ({
  IconButton: () => null,
}));
jest.unstable_mockModule("@/app/components/matrix-orb", () => ({
  MatrixOrb: () => null,
}));
jest.unstable_mockModule("@/app/components/chat-image", () => ({
  ChatImage: ({ src, alt }: { src: string; alt?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

const { MarkdownContent } = await import("../app/components/markdown");

beforeEach(() => {
  useMarkdownChatStore.setState({ session: { mask: {} }, tick: 0 });
  useMarkdownConfig.setState({
    enableCodeFold: true,
    enableArtifacts: true,
    fontSize: 14,
  });
  codeBlockSelections.mockClear();
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

test("a four-image request time appears once below the entire grid", () => {
  const content = Array.from(
    { length: 4 },
    (_, index) =>
      `![Generated Image](/local-preview/media/image-${index + 1}.jpg)`,
  ).join("\n\n");
  render(<MarkdownContent content={content} imageRequestDurationMs={266000} />);
  const images = screen.getAllByRole("img");
  expect(images).toHaveLength(4);
  const grid = images[0].parentElement!;
  expect(images.every((image) => image.parentElement === grid)).toBe(true);
  const footer = screen.getByText("请求耗时 04:26");
  expect(grid.contains(footer)).toBe(false);
  expect(grid.nextElementSibling).toBe(footer);
});

test("retains paragraphs, links and images while the response grows", () => {
  const prefix = "First paragraph with [a source](https://example.com).\n\n";
  const image = "![reference](https://example.com/photo.png)\n\n";
  const { container, rerender } = render(
    <MarkdownContent content={prefix + image + "New text"} />,
  );
  const paragraph = container.querySelector("p");
  const link = screen.getByRole("link", { name: "a source" });
  const picture = screen.getByRole("img", { name: "reference" });

  rerender(
    <MarkdownContent content={prefix + image + "New text keeps arriving."} />,
  );
  expect(container.querySelector("p")).toBe(paragraph);
  expect(screen.getByRole("link", { name: "a source" })).toBe(link);
  expect(screen.getByRole("img", { name: "reference" })).toBe(picture);
  expect(screen.getByText("New text keeps arriving.")).toBeInTheDocument();
});

test("retains code blocks and highlighting as following text grows", () => {
  const code = "```js\nconst value = 42;\n```\n\n";
  const { container, rerender } = render(
    <MarkdownContent content={code + "Following text"} />,
  );
  const block = container.querySelector("pre");
  expect(
    container.querySelector("code.language-js .hljs-keyword"),
  ).not.toBeNull();
  rerender(<MarkdownContent content={code + "Following text grows."} />);
  expect(container.querySelector("pre")).toBe(block);
  expect(container.querySelector("code")?.textContent).toBe(
    "const value = 42;\n",
  );
});

test("renders unsupported image errors before touching the DOM", () => {
  render(<MarkdownContent content="Response: [Unsupported Image]" />);
  expect(screen.getByText("图片加载失败")).toBeInTheDocument();
  expect(screen.queryByText(/\[Unsupported Image\]/)).not.toBeInTheDocument();
});

test("unrelated chat and config updates do not rerender saved code blocks", () => {
  const { container } = render(
    <MarkdownContent content={"```js\nconst value = 42;\n```"} />,
  );
  const block = container.querySelector("pre");
  codeBlockSelections.mockClear();
  act(() => {
    useMarkdownChatStore.setState((state) => ({
      tick: state.tick + 1,
      session: { mask: { ...state.session.mask } },
    }));
    useMarkdownConfig.setState({ fontSize: 18 });
  });
  expect(codeBlockSelections).not.toHaveBeenCalled();
  expect(container.querySelector("pre")).toBe(block);
});

test("code blocks still react to both session and global feature settings", () => {
  const { container } = render(
    <MarkdownContent content={"```html\n<div>Preview</div>\n```"} />,
  );
  expect(screen.getByTestId("html-preview")).toBeInTheDocument();
  expect(container.querySelector("pre")).toHaveAttribute(
    "data-collapsed",
    "true",
  );
  act(() => {
    useMarkdownChatStore.setState({
      session: { mask: { enableCodeFold: false, enableArtifacts: false } },
    });
  });
  expect(container.querySelector("pre")).toHaveAttribute(
    "data-collapsed",
    "false",
  );
  expect(screen.queryByTestId("html-preview")).not.toBeInTheDocument();
  act(() => {
    useMarkdownConfig.setState({
      enableCodeFold: false,
      enableArtifacts: false,
    });
    useMarkdownChatStore.setState({ session: { mask: {} } });
  });
  expect(container.querySelector("pre")).toHaveAttribute(
    "data-collapsed",
    "false",
  );
  expect(screen.queryByTestId("html-preview")).not.toBeInTheDocument();
  act(() => {
    useMarkdownConfig.setState({
      enableCodeFold: true,
      enableArtifacts: true,
    });
  });
  expect(container.querySelector("pre")).toHaveAttribute(
    "data-collapsed",
    "true",
  );
  expect(screen.getByTestId("html-preview")).toBeInTheDocument();
});
