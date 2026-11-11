"use client";

import { useEffect, useId, useRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { createImeGuard } from "../utils/ime-input";
import type { ConversationSearchMatch } from "../utils/conversation-search";
import styles from "./conversation-search.module.scss";

export function ConversationSearch({
  open,
  query,
  currentIndex,
  matches,
  onChange,
  onNavigate,
  onClose,
  onFocus,
}: {
  open: boolean;
  query: string;
  currentIndex: number;
  matches: readonly ConversationSearchMatch[];
  onChange: (query: string) => void;
  onNavigate: (direction: 1 | -1) => void;
  onClose: () => void;
  onFocus?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const ime = useRef(createImeGuard());
  const countId = useId();
  useEffect(() => {
    if (!open) return;
    ime.current = createImeGuard();
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [open]);

  if (!open) return null;
  const count =
    matches.length > 0 && currentIndex >= 0 && currentIndex < matches.length
      ? currentIndex + 1
      : 0;

  return (
    <div
      role="search"
      aria-label="当前对话搜索"
      className={styles.toolbar}
      data-testid="conversation-search"
      onCompositionStart={() => ime.current.start()}
      onCompositionEnd={() => ime.current.end()}
      onKeyUp={(event) => ime.current.release(event.nativeEvent)}
      onKeyDown={(event) => {
        if (ime.current.blocks(event.nativeEvent)) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        } else if (event.key === "Enter" && event.target === inputRef.current) {
          event.preventDefault();
          event.stopPropagation();
          if (matches.length > 0) onNavigate(event.shiftKey ? -1 : 1);
        }
      }}
    >
      <div className={styles.field}>
        <Search size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          aria-label="搜索当前对话"
          aria-describedby={countId}
          placeholder="搜索当前对话"
          autoComplete="off"
          spellCheck={false}
          onFocus={onFocus}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </div>
      <div className={styles.controls}>
        <span
          id={countId}
          className={styles.count}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {count} / {matches.length}
        </span>
        <button
          type="button"
          className={styles.button}
          aria-label="上一个匹配"
          title="上一个匹配"
          disabled={matches.length === 0}
          onClick={() => onNavigate(-1)}
        >
          <ChevronUp size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.button}
          aria-label="下一个匹配"
          title="下一个匹配"
          disabled={matches.length === 0}
          onClick={() => onNavigate(1)}
        >
          <ChevronDown size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.button}
          aria-label="关闭对话搜索"
          title="关闭对话搜索"
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
