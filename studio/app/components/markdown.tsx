import ReactMarkdown, { type Components } from "react-markdown";
import "katex/dist/katex.min.css";
import RemarkMath from "remark-math";
import RemarkBreaks from "remark-breaks";
import RehypeKatex from "rehype-katex";
import RemarkGfm from "remark-gfm";
import RehypeHighlight from "rehype-highlight";
import { useRef, useState, RefObject, useEffect, useMemo, useId } from "react";
import { copyToClipboard } from "../utils";
import Locale from "../locales";
import { MatrixOrb } from "./matrix-orb";
import {
  AlertCircle,
  Check,
  Copy,
  ChevronDown,
  ChevronUp,
  PanelRightOpen,
} from "lucide-react";
import { ChatPreviewContext } from "./chat-preview-context";
import { getMessageError } from "../utils/message-error";
import messageStyles from "./message-ui.module.scss";
import { useTypewriterText } from "./use-typewriter";
import { useStreamTailReveal } from "./use-stream-tail-reveal";
import { ChatImage } from "./chat-image";
import { ImageRequestTime } from "./image-request-time";
import { generatedImageUrls } from "../utils/image-response";
import {
  findMessageSource,
  type MessageSource,
} from "../utils/message-sources";
import { SourceCitation } from "./message-sources";

let mermaidInstance: any = null;
async function getMermaid() {
  if (!mermaidInstance) {
    const mod = await import("mermaid");
    mermaidInstance = mod.default;
  }
  return mermaidInstance;
}
import ReloadButtonIcon from "../icons/reload.svg";
import React from "react";
import { showImageModal, FullScreen } from "./ui-lib";
import { ArtifactsShareButton } from "./artifacts-share-button";
import { HTMLPreview, type HTMLPreviewHandler } from "./html-preview";
import { useChatStore } from "../store";
import { IconButton } from "./button";

import { useAppConfig } from "../store/config";
import clsx from "clsx";

const OutputActiveContext = React.createContext(false);
const MarkdownSourcesContext = React.createContext<readonly MessageSource[]>(
  [],
);
const MarkdownImageContext = React.createContext<{
  imageId?: string;
  imageRequestDurationMs?: number;
  singleImage?: boolean;
  onImageClick?: (src: string) => void;
}>({});

const markdownComponents: Components = {
  pre: PreCode,
  p: ({ node: _node, ...props }) => <p {...props} dir="auto" />,
  img: function MarkdownImage(props) {
    const context = React.useContext(MarkdownImageContext);
    if (!props.src) return null;
    return (
      <ChatImage
        src={props.src}
        alt={props.alt}
        requestDurationMs={
          props.alt === "Generated Image"
            ? context.imageRequestDurationMs
            : undefined
        }
        imageId={
          props.alt === "Generated Image" && context.singleImage
            ? context.imageId
            : undefined
        }
        onImageClick={context.onImageClick}
      />
    );
  },
  a: function MarkdownLink({ node: _node, ...props }) {
    const sources = React.useContext(MarkdownSourcesContext);
    const href = props.href || "";
    try {
      const protocol = new URL(href, "https://markdown.local/").protocol;
      if (!["http:", "https:", "mailto:", "tel:"].includes(protocol))
        return <span>{props.children}</span>;
    } catch {
      return <span>{props.children}</span>;
    }
    if (/\.(aac|mp3|opus|wav)$/.test(href)) {
      return (
        <figure>
          <audio controls src={href}></audio>
        </figure>
      );
    }
    if (/\.(3gp|3g2|webm|ogv|mpeg|mp4|avi)$/.test(href)) {
      return (
        <video
          className={messageStyles["video-result"]}
          controls
          playsInline
          preload="metadata"
        >
          <source src={href} />
        </video>
      );
    }
    const source = findMessageSource(sources, href);
    if (source) return <SourceCitation source={source} />;
    const isInternal = /^\/#/i.test(href);
    const target = isInternal ? "_self" : props.target ?? "_blank";
    return <a {...props} target={target} />;
  },
};

export function Mermaid(props: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (props.code && ref.current) {
      getMermaid()
        .then((m) =>
          m.run({
            nodes: [ref.current!],
            suppressErrors: true,
          }),
        )
        .catch((e) => {
          setHasError(true);
          console.error("[Mermaid] ", e.message);
        });
    }
  }, [props.code]);

  function viewSvgInNewWindow() {
    const svg = ref.current?.querySelector("svg");
    if (!svg) return;
    const text = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([text], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    showImageModal(url, undefined, undefined, undefined, () =>
      URL.revokeObjectURL(url),
    );
  }

  if (hasError) {
    return null;
  }

  return (
    <div
      className={clsx("no-dark", "mermaid")}
      style={{
        cursor: "pointer",
        overflow: "auto",
      }}
      ref={ref}
      onClick={() => viewSvgInNewWindow()}
    >
      {props.code}
    </div>
  );
}

export function PreCode(props: { children?: React.ReactNode }) {
  const openPreview = React.useContext(ChatPreviewContext);
  const outputActive = React.useContext(OutputActiveContext);
  const ref = useRef<HTMLPreElement>(null);
  const codeId = useId();
  const [collapsed, setCollapsed] = useState(true);
  const [showToggle, setShowToggle] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const previewRef = useRef<HTMLPreviewHandler>(null);
  const [mermaidCode, setMermaidCode] = useState("");
  const [htmlCode, setHtmlCode] = useState("");
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  const language =
    React.Children.toArray(props.children)
      .filter(React.isValidElement)
      .map(
        (child) =>
          (child.props as { className?: string }).className?.match(
            /language-([\w+-]+)/,
          )?.[1],
      )
      .find(Boolean) ?? "text";
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const sessionCodeFold = useChatStore(
    (state) => state.currentSession().mask?.enableCodeFold !== false,
  );
  const sessionArtifacts = useChatStore(
    (state) => state.currentSession().mask?.enableArtifacts !== false,
  );
  const configCodeFold = useAppConfig((state) => state.enableCodeFold);
  const configArtifacts = useAppConfig((state) => state.enableArtifacts);
  const enableCodeFold = sessionCodeFold && configCodeFold;
  const enableArtifacts = sessionArtifacts && configArtifacts;

  useEffect(() => {
    if (outputActive || !ref.current) {
      setMermaidCode("");
      setHtmlCode("");
      return;
    }
    const mermaidDom = ref.current.querySelector("code.language-mermaid");
    setMermaidCode(mermaidDom?.textContent ?? "");
    if (!enableArtifacts) {
      setHtmlCode("");
      return;
    }
    const htmlDom = ref.current.querySelector("code.language-html");
    const refText = ref.current.querySelector("code")?.textContent;
    if (htmlDom) {
      setHtmlCode(htmlDom.textContent ?? "");
    } else if (
      /^\s*(?:<!doctype\b|<html\b|<svg\b|<\?xml\b)/i.test(refText ?? "")
    ) {
      setHtmlCode(refText ?? "");
    } else setHtmlCode("");
  }, [outputActive, enableArtifacts, props.children]);

  useEffect(() => {
    const pre = ref.current;
    const code = pre?.querySelector("code");
    if (!pre || !code) return;
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(pre).lineHeight);
      setShowToggle(code.scrollHeight > lineHeight * 14 + 29);
      setLineCount(
        (code.textContent || "").replace(/\n$/, "").split("\n").length,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(code);
    return () => observer.disconnect();
  }, [props.children]);

  const toggleCollapsed = () => {
    const pre = ref.current;
    const block = pre?.parentElement;
    const shrinking = !collapsed;
    setCollapsed(!collapsed);
    if (!shrinking || !pre || !block) return;
    pre.scrollTop = 0;
    // Keep the block header reachable when collapsing from a distant footer.
    requestAnimationFrame(() => {
      let parent = block.parentElement;
      while (parent) {
        if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
          const offset =
            block.getBoundingClientRect().top -
            parent.getBoundingClientRect().top -
            12;
          if (offset < 0) parent.scrollTop += offset;
          break;
        }
        parent = parent.parentElement;
      }
    });
  };

  //Wrap the paragraph for plain-text
  useEffect(() => {
    if (ref.current) {
      const codeElements = ref.current.querySelectorAll(
        "code",
      ) as NodeListOf<HTMLElement>;
      const wrapLanguages = [
        "",
        "md",
        "markdown",
        "text",
        "txt",
        "plaintext",
        "tex",
        "latex",
      ];
      codeElements.forEach((codeElement) => {
        let languageClass = codeElement.className.match(/language-(\w+)/);
        let name = languageClass ? languageClass[1] : "";
        if (wrapLanguages.includes(name)) {
          codeElement.style.whiteSpace = "pre-wrap";
        }
      });
    }
  }, []);

  return (
    <>
      <div className={messageStyles["code-block"]}>
        <div className={messageStyles["code-header"]}>
          <span>{language}</span>
          <button
            type="button"
            className={messageStyles.copy}
            title={copied ? Locale.Copy.Success : Locale.Chat.Actions.Copy}
            aria-label={copied ? Locale.Copy.Success : Locale.Chat.Actions.Copy}
            onClick={async () => {
              await copyToClipboard(
                ref.current?.querySelector("code")?.innerText ?? "",
              );
              setCopied(true);
              clearTimeout(copyTimer.current);
              copyTimer.current = setTimeout(() => setCopied(false), 1800);
            }}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
        <pre ref={ref} id={codeId} data-collapsed={enableCodeFold && collapsed}>
          {props.children}
        </pre>
        {enableCodeFold && showToggle && (
          <button
            type="button"
            className={messageStyles["code-fold-toggle"]}
            aria-controls={codeId}
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
          >
            <span>
              {collapsed
                ? Locale.Chat.CodeBlock.Expand
                : Locale.Chat.CodeBlock.Collapse}
              {" · "}
              {Locale.Chat.CodeBlock.Lines(lineCount)}
            </span>
            {collapsed ? (
              <ChevronDown size={15} aria-hidden="true" />
            ) : (
              <ChevronUp size={15} aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      {!outputActive && mermaidCode.length > 0 && (
        <Mermaid code={mermaidCode} key={mermaidCode} />
      )}
      {!outputActive && htmlCode.length > 0 && enableArtifacts && (
        <FullScreen
          className="no-dark html"
          actions={
            <>
              {openPreview && (
                <IconButton
                  icon={<PanelRightOpen size={18} />}
                  title="在侧栏预览"
                  aria="在侧栏预览"
                  onClick={() => openPreview(htmlCode)}
                />
              )}
              <IconButton
                icon={<ReloadButtonIcon />}
                title={Locale.Export.Artifacts.Reload}
                aria={Locale.Export.Artifacts.Reload}
                onClick={() => previewRef.current?.reload()}
              />
              <ArtifactsShareButton getCode={() => htmlCode} />
            </>
          }
        >
          <HTMLPreview
            ref={previewRef}
            code={htmlCode}
            autoHeight
            height={600}
          />
        </FullScreen>
      )}
    </>
  );
}

function escapeBrackets(text: string) {
  const pattern =
    /(```[\s\S]*?```|`.*?`)|\\\[([\s\S]*?[^\\])\\\]|\\\((.*?)\\\)/g;
  return text.replace(
    pattern,
    (match, codeBlock, squareBracket, roundBracket) => {
      if (codeBlock) {
        return codeBlock;
      } else if (squareBracket) {
        return `$$${squareBracket}$$`;
      } else if (roundBracket) {
        return `$${roundBracket}$`;
      }
      return match;
    },
  );
}

function tryWrapHtmlCode(text: string) {
  if (/^\s*(?:<svg\b|<\?xml\b|<!doctype\s+html\b|<html\b)/i.test(text)) {
    return "```html\n" + text + "\n```";
  }
  // try add wrap html code (fixed: html codeblock include 2 newline)
  // ignore embed codeblock
  if (text.includes("```")) {
    return text;
  }
  let result = text;
  if (text.includes("<!DOCTYPE html>")) {
    result = result.replace(
      /([`]*?)(\w*?)([\n\r]*?)(<!DOCTYPE html>)/g,
      (match, quoteStart, lang, newLine, doctype) => {
        return !quoteStart ? "\n```html\n" + doctype : match;
      },
    );
  }
  if (text.includes("</body>") && text.includes("</html>")) {
    result = result.replace(
      /(<\/body>)([\r\n\s]*?)(<\/html>)([\n\r]*)([`]*)([\n\r]*?)/g,
      (match, bodyEnd, space, htmlEnd, newLine, quoteEnd) => {
        return !quoteEnd ? bodyEnd + space + htmlEnd + "\n```\n" : match;
      },
    );
  }
  return result;
}

function MarkdownContentView(props: {
  content: string;
  sources?: readonly MessageSource[];
  imageId?: string;
  imageRequestDurationMs?: number;
  onImageClick?: (src: string) => void;
}) {
  const standaloneImage = useMemo(
    () =>
      /^!\[(Generated Image|生成预览)\]\(([^()\r\n]+)\)$/.exec(props.content),
    [props.content],
  );
  const generatedImages = useMemo(() => {
    const images = generatedImageUrls(props.content);
    return images.length > 1 ? images : null;
  }, [props.content]);
  const escapedContent = useMemo(() => {
    // Generated image payloads can be several MB; render without Markdown parsing.
    if (standaloneImage || generatedImages) return "";
    const raw = props.content;
    // 如果内容包含 "[Unsupported Image]"，说明上游返回了异常文本，替换为友好提示
    if (raw.includes("[Unsupported Image]")) {
      return "> ⚠️ **图片加载失败**\n>\n> 💡 图像数据异常，请尝试重新生成";
    }
    return tryWrapHtmlCode(escapeBrackets(raw));
  }, [props.content, standaloneImage, generatedImages]);
  const singleImage =
    !!standaloneImage ||
    (props.imageId !== undefined &&
      (props.content.match(/!\[/g)?.length ?? 0) === 1);
  const imageContext = useMemo(
    () => ({
      imageId: props.imageId,
      imageRequestDurationMs: props.imageRequestDurationMs,
      singleImage,
      onImageClick: props.onImageClick,
    }),
    [
      props.imageId,
      props.imageRequestDurationMs,
      singleImage,
      props.onImageClick,
    ],
  );

  if (generatedImages) {
    return (
      <div className={messageStyles["image-result"]}>
        <div className={messageStyles["generated-images"]}>
          {generatedImages.map((url, index) => (
            <ChatImage
              key={`${index}:${url}`}
              src={url}
              alt={`Generated Image ${index + 1}`}
              imageId={
                props.imageId
                  ? index === 0
                    ? props.imageId
                    : `${props.imageId}-${index}`
                  : undefined
              }
              onImageClick={props.onImageClick}
            />
          ))}
        </div>
        <ImageRequestTime durationMs={props.imageRequestDurationMs} />
      </div>
    );
  }

  if (standaloneImage) {
    return (
      <ChatImage
        src={standaloneImage[2]}
        alt={standaloneImage[1]}
        requestDurationMs={
          standaloneImage[1] === "Generated Image"
            ? props.imageRequestDurationMs
            : undefined
        }
        imageId={
          standaloneImage[1] === "Generated Image" ? props.imageId : undefined
        }
        onImageClick={props.onImageClick}
      />
    );
  }

  return (
    <MarkdownImageContext.Provider value={imageContext}>
      <MarkdownSourcesContext.Provider value={props.sources ?? []}>
        <ReactMarkdown
          remarkPlugins={[RemarkMath, RemarkGfm, RemarkBreaks]}
          rehypePlugins={[
            RehypeKatex,
            [
              RehypeHighlight,
              {
                detect: false,
                ignoreMissing: true,
              },
            ],
          ]}
          components={markdownComponents}
        >
          {escapedContent}
        </ReactMarkdown>
      </MarkdownSourcesContext.Provider>
    </MarkdownImageContext.Provider>
  );
}

export const MarkdownContent = React.memo(MarkdownContentView);

export function Markdown(
  props: {
    content: string;
    sources?: readonly MessageSource[];
    searchContent?: boolean;
    loading?: boolean;
    imageId?: string;
    imageRequestDurationMs?: number;
    streaming?: boolean;
    fontSize?: number;
    fontFamily?: string;
    parentRef?: RefObject<HTMLDivElement>;
    defaultShow?: boolean;
    onImageClick?: (src: string) => void;
    isError?: boolean;
    allowErrorDetails?: boolean;
  } & React.DOMAttributes<HTMLDivElement>,
) {
  const mdRef = useRef<HTMLDivElement>(null);
  const error = useMemo(
    () =>
      props.allowErrorDetails
        ? getMessageError(props.content, props.isError)
        : null,
    [props.content, props.isError, props.allowErrorDetails],
  );
  const instant =
    !!error ||
    !!props.isError ||
    /!\[|<img\b|data:image\/|blob:/i.test(props.content);
  const displayedContent = useTypewriterText(
    props.content,
    !!props.streaming,
    instant,
  );
  useStreamTailReveal(
    mdRef,
    displayedContent,
    !instant && (!!props.streaming || displayedContent !== props.content),
  );

  return (
    <div
      className="markdown-body"
      data-chat-search-content={props.searchContent || undefined}
      data-output-active={
        !!props.streaming || displayedContent !== props.content
      }
      style={{
        fontSize: `${props.fontSize ?? 14}px`,
        fontFamily: props.fontFamily || "inherit",
      }}
      ref={mdRef}
      onContextMenu={props.onContextMenu}
      onDoubleClickCapture={props.onDoubleClickCapture}
      dir="auto"
    >
      {props.loading ? (
        <MatrixOrb />
      ) : error ? (
        <div className={messageStyles.error}>
          <div className={messageStyles["error-heading"]}>
            <AlertCircle size={18} aria-hidden="true" />
            <span>{error.summary || Locale.Error.Title}</span>
          </div>
          <details>
            <summary>{Locale.Error.Details}</summary>
            <pre>{error.details}</pre>
          </details>
        </div>
      ) : (
        <OutputActiveContext.Provider
          value={!!props.streaming || displayedContent !== props.content}
        >
          <MarkdownContent
            content={displayedContent}
            sources={props.sources}
            imageId={props.imageId}
            imageRequestDurationMs={props.imageRequestDurationMs}
            onImageClick={props.onImageClick}
          />
        </OutputActiveContext.Provider>
      )}
    </div>
  );
}
