"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import clsx from "clsx";
import styles from "./chat-split-pane.module.scss";
import { ChatPreviewContext } from "./chat-preview-context";

export function ChatSplitPane({
  children,
  preview,
  onClose,
  onOpen,
  className,
}: {
  children: ReactNode;
  preview?: ReactNode;
  onClose: () => void;
  onOpen?: (code: string) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const divider = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ pointer: number; ratio: number }>();
  const [ratio, setRatio] = useState(50);
  const [dragging, setDragging] = useState(false);

  const finish = useCallback((cancel = false) => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = undefined;
    if (cancel) setRatio(current.ratio);
    setDragging(false);
    if (divider.current?.hasPointerCapture(current.pointer))
      divider.current.releasePointerCapture(current.pointer);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const cancel = () => finish(true);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("blur", cancel);
    };
  }, [dragging, finish]);

  useEffect(() => {
    if (!preview) {
      finish(true);
      setRatio(50);
    }
  }, [preview, finish]);

  useEffect(
    () => () => {
      const current = gesture.current;
      gesture.current = undefined;
      if (current && divider.current?.hasPointerCapture(current.pointer))
        divider.current.releasePointerCapture(current.pointer);
    },
    [],
  );

  return (
    <div
      ref={container}
      className={clsx(className, styles.split, preview && styles.open)}
      data-dragging={dragging || undefined}
      style={
        {
          "--chat-share": `${ratio}fr`,
          "--preview-share": `${100 - ratio}fr`,
        } as CSSProperties
      }
    >
      <div className={styles.content}>
        <ChatPreviewContext.Provider value={onOpen}>
          {children}
        </ChatPreviewContext.Provider>
      </div>
      {preview && (
        <>
          <div
            ref={divider}
            className={styles.divider}
            role="separator"
            aria-label="调整聊天与预览宽度"
            aria-orientation="vertical"
            aria-valuemin={20}
            aria-valuemax={80}
            aria-valuenow={ratio}
            tabIndex={0}
            onPointerDown={(event) => {
              if (event.button !== 0 || gesture.current) return;
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              gesture.current = { pointer: event.pointerId, ratio };
              setDragging(true);
            }}
            onPointerMove={(event) => {
              if (gesture.current?.pointer !== event.pointerId) return;
              const rect = container.current?.getBoundingClientRect();
              if (!rect || rect.width <= 10) return;
              const next =
                ((event.clientX - rect.left - 5) / (rect.width - 10)) * 100;
              if (next > 80) {
                finish();
                onClose();
              } else {
                setRatio(Math.max(20, next));
              }
            }}
            onPointerUp={(event) => {
              if (gesture.current?.pointer === event.pointerId) finish();
            }}
            onPointerCancel={(event) => {
              if (gesture.current?.pointer === event.pointerId) finish(true);
            }}
            onLostPointerCapture={() => finish(true)}
            onDoubleClick={() => {
              finish();
              setRatio(50);
            }}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowLeft"
                  ? Math.max(20, ratio - 2)
                  : event.key === "ArrowRight"
                  ? Math.min(80, ratio + 2)
                  : event.key === "Home"
                  ? 20
                  : event.key === "End"
                  ? 80
                  : event.key === "Enter"
                  ? 50
                  : undefined;
              if (next !== undefined) {
                event.preventDefault();
                setRatio(next);
              }
            }}
          />
          <section className={styles.preview} aria-label="侧栏预览">
            <div className={styles.header}>
              <span>预览</span>
              <button
                type="button"
                title="关闭预览"
                aria-label="关闭预览"
                onClick={onClose}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className={styles.canvas}>{preview}</div>
            {dragging && (
              <div
                className={styles.mask}
                data-testid="preview-drag-mask"
                aria-hidden="true"
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
