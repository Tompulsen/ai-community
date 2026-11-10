"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Quote, X } from "lucide-react";
import { createMessageQuote, type MessageQuote } from "../utils/message-quote";
import { getMessageSelectionText } from "./chat-context-menu";
import styles from "./message-quote.module.scss";

export function MessageQuoteView({
  quote,
  onRemove,
}: {
  quote: MessageQuote;
  onRemove?: () => void;
}) {
  const label =
    quote.role === "assistant"
      ? "AI 回复"
      : quote.role === "user"
      ? "你的消息"
      : "系统消息";
  return (
    <div
      className={styles.quote}
      data-testid={onRemove ? "composer-quote" : "message-quote"}
      data-chat-scroll-isolation
    >
      <div className={styles.heading}>
        <span className={styles.label}>
          <Quote size={14} aria-hidden="true" />
          引用 · {label}
        </span>
        {onRemove && (
          <button
            type="button"
            className={styles.remove}
            aria-label="取消引用"
            title="取消引用"
            onClick={onRemove}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className={styles.excerpt}>{quote.text}</div>
    </div>
  );
}

type SelectionQuote = {
  quote: MessageQuote;
  left: number;
  top: number;
};

function selectionElement(node: Node | null) {
  return node instanceof Element ? node : node?.parentElement ?? null;
}

const EDITABLE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

export function MessageQuoteSelection({
  containerRef,
  onQuote,
  disabled = false,
  mobile = false,
}: {
  containerRef: RefObject<HTMLDivElement>;
  onQuote: (quote: MessageQuote) => void;
  disabled?: boolean;
  mobile?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<SelectionQuote | null>(null);
  const snapshotRef = useRef<SelectionQuote | null>(null);
  const pendingFrame = useRef<number>();
  const onQuoteRef = useRef(onQuote);
  onQuoteRef.current = onQuote;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || disabled) {
      snapshotRef.current = null;
      setSnapshot(null);
      return;
    }
    let active = true;
    const update = () => {
      pendingFrame.current = undefined;
      if (!active) return;
      let next: SelectionQuote | null = null;
      const selection = document.getSelection();
      const range =
        selection?.rangeCount && !selection.isCollapsed
          ? selection.getRangeAt(0)
          : undefined;
      const start = selectionElement(range?.startContainer ?? null);
      const end = selectionElement(range?.endContainer ?? null);
      const message = start?.closest<HTMLElement>("[data-quotable-message]");
      const role = message?.dataset.messageRole;
      if (
        range &&
        message &&
        container.contains(message) &&
        end?.closest("[data-quotable-message]") === message &&
        !start?.closest(EDITABLE) &&
        !end?.closest(EDITABLE) &&
        !document.activeElement?.closest(EDITABLE) &&
        message.dataset.messageId &&
        (role === "user" || role === "assistant")
      ) {
        const text = getMessageSelectionText(message);
        const quote = text
          ? createMessageQuote({ id: message.dataset.messageId, role }, text)
          : undefined;
        const bounds = range.getBoundingClientRect();
        const body = container.getBoundingClientRect();
        const viewport = window.visualViewport;
        const viewportLeft = viewport?.offsetLeft ?? 0;
        const viewportTop = viewport?.offsetTop ?? 0;
        const left = Math.max(body.left, viewportLeft + 8);
        const top = Math.max(body.top, viewportTop + 8);
        const right = Math.min(
          body.right,
          viewportLeft + (viewport?.width ?? window.innerWidth) - 8,
        );
        const bottom = Math.min(
          body.bottom,
          viewportTop + (viewport?.height ?? window.innerHeight) - 8,
        );
        const width = 88;
        const height = 44;
        if (
          quote &&
          bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.right > left &&
          bounds.left < right &&
          bounds.bottom > top &&
          bounds.top < bottom &&
          right - left >= width &&
          bottom - top >= height
        ) {
          const above = bounds.top - height - 8;
          const below = bounds.bottom + 8;
          const preferred =
            mobile && below + height <= bottom
              ? below
              : above >= top
              ? above
              : below;
          next = {
            quote,
            left: Math.max(left, Math.min(bounds.left, right - width)),
            top: Math.max(top, Math.min(preferred, bottom - height)),
          };
        }
      }
      snapshotRef.current = next;
      setSnapshot((previous) =>
        previous?.quote.messageId === next?.quote.messageId &&
        previous?.quote.role === next?.quote.role &&
        previous?.quote.text === next?.quote.text &&
        previous?.left === next?.left &&
        previous?.top === next?.top
          ? previous
          : next,
      );
    };
    const schedule = () => {
      if (pendingFrame.current === undefined)
        pendingFrame.current = requestAnimationFrame(update);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        document.getSelection()?.removeAllRanges();
        snapshotRef.current = null;
        setSnapshot(null);
        return;
      }
      schedule();
    };
    document.addEventListener("selectionchange", schedule);
    document.addEventListener("keyup", keyUp);
    document.addEventListener("pointerup", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    schedule();
    return () => {
      active = false;
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("keyup", keyUp);
      document.removeEventListener("pointerup", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      if (pendingFrame.current !== undefined)
        cancelAnimationFrame(pendingFrame.current);
      pendingFrame.current = undefined;
    };
  }, [containerRef, disabled, mobile]);

  if (disabled || !snapshot) return null;
  return createPortal(
    <button
      type="button"
      className={styles.selection}
      style={{ left: snapshot.left, top: snapshot.top }}
      aria-label="引用选中文字"
      data-chat-scroll-isolation
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        const captured = snapshotRef.current?.quote ?? snapshot.quote;
        document.getSelection()?.removeAllRanges();
        snapshotRef.current = null;
        setSnapshot(null);
        onQuoteRef.current(captured);
      }}
    >
      <Quote size={16} aria-hidden="true" />
      <span>引用</span>
    </button>,
    document.body,
  );
}
