"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ExternalLink, X } from "lucide-react";
import type { MessageSource } from "../utils/message-sources";
import { safeToolUrl } from "../utils/tool-result";
import { useAnchoredPanel } from "../utils/use-anchored-panel";
import styles from "./message-sources.module.scss";

export function SourceCitation({ source }: { source: MessageSource }) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const pinned = useRef(false);
  const restoringFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const url = safeToolUrl(source.url);
  const position = useAnchoredPanel(open, triggerRef, panelRef, 320, {
    maxHeight: 320,
    gap: 8,
  });
  const clearClose = useCallback(() => clearTimeout(closeTimer.current), []);
  const close = useCallback(
    (restoreFocus = false) => {
      clearClose();
      pinned.current = false;
      setOpen(false);
      if (restoreFocus && document.activeElement !== triggerRef.current) {
        restoringFocus.current = true;
        triggerRef.current?.focus({ preventScroll: true });
        restoringFocus.current = false;
      }
    },
    [clearClose],
  );
  const scheduleClose = () => {
    clearClose();
    if (pinned.current) return;
    closeTimer.current = setTimeout(() => {
      const focused = document.activeElement;
      if (
        focused === triggerRef.current ||
        (focused instanceof Node && panelRef.current?.contains(focused))
      )
        return;
      setOpen(false);
    }, 160);
  };
  const handleBlur = (event: FocusEvent) => {
    if (
      event.relatedTarget instanceof Node &&
      (panelRef.current?.contains(event.relatedTarget) ||
        triggerRef.current?.contains(event.relatedTarget))
    )
      return;
    close();
  };

  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !triggerRef.current?.contains(event.target) &&
        !panelRef.current?.contains(event.target)
      )
        close();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        close(panelRef.current?.contains(document.activeElement) ?? false);
      } else if (
        event.key === "Tab" &&
        !event.shiftKey &&
        event.target === triggerRef.current
      ) {
        const link = panelRef.current?.querySelector("a");
        if (link) {
          event.preventDefault();
          link.focus({ preventScroll: true });
        }
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyDown);
    };
  }, [open, close]);

  if (!url) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.citation}
        aria-label={`来源 ${source.number}：${source.title}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-source-url={url}
        data-testid="source-citation"
        data-chat-scroll-isolation
        data-chat-scroll-pause
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse") return;
          clearClose();
          setOpen(true);
        }}
        onPointerLeave={scheduleClose}
        onFocus={() => {
          if (restoringFocus.current) return;
          clearClose();
          setOpen(true);
        }}
        onBlur={handleBlur}
        onClick={() => {
          clearClose();
          pinned.current = true;
          setOpen(true);
        }}
      >
        [{source.number}]
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            className={styles.preview}
            style={position}
            role="dialog"
            aria-label={`来源 ${source.number}`}
            aria-modal="false"
            data-chat-scroll-isolation
            onPointerEnter={clearClose}
            onPointerLeave={scheduleClose}
            onBlur={handleBlur}
          >
            <div className={styles["preview-heading"]}>
              <span>来源 {source.number}</span>
              <button
                type="button"
                className={styles.close}
                aria-label="关闭来源预览"
                title="关闭来源预览"
                onClick={() => close(true)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <SourceDescription source={{ ...source, url }} />
            <a
              className={styles["open-source"]}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              打开来源
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>,
          document.body,
        )}
    </>
  );
}

function SourceDescription({ source }: { source: MessageSource }) {
  return (
    <>
      <span className={styles.title}>{source.title}</span>
      <span className={styles.domain}>{new URL(source.url).hostname}</span>
      {source.snippet && (
        <span className={styles.snippet}>{source.snippet}</span>
      )}
    </>
  );
}

export function MessageSources({
  sources,
}: {
  sources: readonly MessageSource[];
}) {
  const safeSources = sources.filter(
    (source) =>
      safeToolUrl(source.url) &&
      Number.isInteger(source.number) &&
      source.number > 0,
  );
  if (!safeSources.length) return null;
  return (
    <details
      className={styles.sources}
      data-testid="message-sources"
      data-chat-scroll-isolation
    >
      <summary>
        <span>来源 · {safeSources.length}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <ol className={styles.list}>
        {safeSources.map((source) => (
          <li key={source.url}>
            <span className={styles.number}>{source.number}</span>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              <SourceDescription source={source} />
            </a>
            <ExternalLink size={14} aria-hidden="true" />
          </li>
        ))}
      </ol>
    </details>
  );
}
