import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";
import type { MessageSource } from "../app/utils/message-sources";

jest.unstable_mockModule("@/app/utils", () => ({ copyToClipboard: jest.fn() }));
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
  useChatStore: (select: (state: unknown) => unknown) =>
    select({ currentSession: () => ({ mask: {} }) }),
}));
jest.unstable_mockModule("@/app/store/config", () => ({
  useAppConfig: (select: (state: unknown) => unknown) =>
    select({ enableCodeFold: true, enableArtifacts: true }),
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
const sources: MessageSource[] = [
  {
    number: 1,
    title: "Official docs",
    url: "https://example.com/docs",
    snippet: "Real source",
  },
  { number: 2, title: "Second source", url: "https://example.com/second" },
];

beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

test("only explicit known source URLs become numbered citations", () => {
  render(
    <MarkdownContent
      sources={sources}
      content="Answer [Documentation](https://example.com/docs), [Other](https://other.example) and a bare [1]."
    />,
  );
  expect(
    screen.getByRole("button", { name: "来源 1：Official docs" }),
  ).toHaveTextContent("[1]");
  expect(screen.getByRole("link", { name: "Other" })).toHaveAttribute(
    "href",
    "https://other.example",
  );
  expect(screen.getByText(/a bare \[1\]/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Documentation" })).toBeNull();
});

test("a numeric label maps by its explicit URL rather than by the label number", () => {
  render(
    <MarkdownContent
      sources={sources}
      content="Checked [99](https://example.com/second) and [1](https://unknown.example)."
    />,
  );
  expect(
    screen.getByRole("button", { name: "来源 2：Second source" }),
  ).toHaveTextContent("[2]");
  expect(screen.getByRole("link", { name: "1" })).toHaveAttribute(
    "href",
    "https://unknown.example",
  );
});

test("without sources links retain the existing behavior and media renders normally", () => {
  const { container } = render(
    <MarkdownContent
      content={
        "[Docs](https://example.com/docs)\n\n![Photo](https://example.com/photo.png)\n\n- [Audio](https://example.com/audio.mp3)\n- [Video](https://example.com/video.mp4)"
      }
    />,
  );
  expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute(
    "target",
    "_blank",
  );
  expect(screen.getByRole("img", { name: "Photo" })).toBeInTheDocument();
  expect(container.querySelector("audio")).toHaveAttribute(
    "src",
    "https://example.com/audio.mp3",
  );
  expect(container.querySelector("video source")).toHaveAttribute(
    "src",
    "https://example.com/video.mp4",
  );
  expect(screen.queryByTestId("source-citation")).toBeNull();
});

test("does not turn code samples, unsafe links or generated images into citations", () => {
  const { container, rerender } = render(
    <MarkdownContent
      sources={sources}
      content={
        "`[Docs](https://example.com/docs)` and [unsafe](javascript:alert(1))\n\n```js\nconst value = 42;\n```"
      }
    />,
  );
  expect(screen.queryByTestId("source-citation")).toBeNull();
  expect(
    container.querySelector("code.language-js .hljs-keyword"),
  ).not.toBeNull();
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  rerender(
    <MarkdownContent
      sources={sources}
      content="![Generated Image](https://example.com/docs)"
    />,
  );
  expect(
    screen.getByRole("img", { name: "Generated Image" }),
  ).toBeInTheDocument();
  expect(screen.queryByTestId("source-citation")).toBeNull();
});

test.each([
  "javascript:alert(1)",
  "javascript:void(0)",
  "data:text/html,test",
  "vbscript:msgbox(1)",
])("unsafe Markdown links stay readable without any anchor for %s", (href) => {
  const { container } = render(
    <MarkdownContent
      sources={sources}
      content={`Result [Unsafe source](${href}).`}
    />,
  );
  expect(screen.getByText("Unsafe source")).toBeVisible();
  expect(container.querySelector("a")).toBeNull();
  expect(screen.queryByTestId("source-citation")).toBeNull();
});

test.each([
  ["http", "http://example.com/docs"],
  ["https", "https://unknown.example/docs"],
  ["email", "mailto:hello@example.com"],
  ["phone", "tel:+123456789"],
  ["fragment", "#section"],
  ["relative", "../docs"],
  ["root relative", "/docs"],
])("normal %s Markdown links retain their destination", (label, href) => {
  render(<MarkdownContent content={`[${label}](${href})`} />);
  expect(screen.getByRole("link", { name: label })).toHaveAttribute(
    "href",
    href,
  );
});

test("known source citation retains its identity and preview while following text streams", () => {
  const prefix = "Evidence [docs](https://example.com/docs).\n\n";
  const { rerender } = render(
    <MarkdownContent sources={sources} content={prefix + "First"} />,
  );
  const citation = screen.getByTestId("source-citation");
  fireEvent.click(citation);
  expect(screen.getByRole("dialog", { name: "来源 1" })).toBeVisible();
  rerender(
    <MarkdownContent sources={sources} content={prefix + "First grows."} />,
  );
  expect(screen.getByTestId("source-citation")).toBe(citation);
  expect(screen.getByRole("dialog", { name: "来源 1" })).toBeVisible();
});
