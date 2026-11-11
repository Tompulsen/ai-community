"use client";

import { useId, useRef, useState } from "react";
import { BrainCircuit, Check, ChevronDown } from "lucide-react";
import { MarkdownContent } from "./markdown";
import { CollapsibleContent } from "./collapsible-content";
import styles from "./reasoning-panel.module.scss";

export function ReasoningPanel({
  content,
  streaming = false,
  hasAnswer = false,
  interrupted = false,
}: {
  content?: string;
  streaming?: boolean;
  hasAnswer?: boolean;
  interrupted?: boolean;
}) {
  const contentId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  if (!content) return null;
  const active = streaming && !hasAnswer;
  const open = expanded ?? active;
  const Icon = active ? BrainCircuit : Check;

  return (
    <section
      className={styles.panel}
      data-active={active}
      data-chat-scroll-isolation
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setExpanded(!open)}
      >
        <Icon size={16} aria-hidden="true" className={styles.icon} />
        <span className={styles.title}>思考过程</span>
        <span className={styles.state} role="status">
          {active ? "思考中" : interrupted ? "已停止" : "已完成"}
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={styles.chevron}
          data-open={open}
        />
      </button>
      <CollapsibleContent
        id={contentId}
        open={open}
        className={styles.content}
        triggerRef={triggerRef}
      >
        <div className="markdown-body" dir="auto">
          <MarkdownContent content={content} />
        </div>
      </CollapsibleContent>
    </section>
  );
}
