"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { createImeGuard } from "../utils/ime-input";
import { prefersReducedMotion } from "../utils/motion";
import { SmoothPanelContent } from "./smooth-panel-content";
import chatStyles from "./chat.module.scss";
import styles from "./selection-dialog.module.scss";

export function SelectionDialog({
  title,
  children,
  onClose,
  compact = false,
  smoothResize = false,
  id,
  open = true,
  headerActions,
  style,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  compact?: boolean;
  smoothResize?: boolean;
  id?: string;
  open?: boolean;
  headerActions?: ReactNode;
  style?: CSSProperties;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [present, setPresent] = useState(open);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const timeout = useRef<ReturnType<typeof setTimeout>>();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const ime = useRef(createImeGuard());

  const clearExit = useCallback(() => {
    clearTimeout(timeout.current);
    timeout.current = undefined;
  }, []);

  const finishClose = useCallback(() => {
    if (!closingRef.current) return;
    closingRef.current = false;
    clearExit();
    dialog.current?.close();
    setPresent(false);
    setClosing(false);
    onCloseRef.current();
  }, [clearExit]);

  const requestClose = useCallback(() => {
    if (!dialog.current?.open || closingRef.current) return;
    closingRef.current = true;
    if (prefersReducedMotion()) {
      finishClose();
      return;
    }
    setClosing(true);
    const mobile = window.matchMedia?.("(max-width: 600px)").matches;
    // Keep the native modal and focus scope alive through its exit animation.
    timeout.current = setTimeout(finishClose, mobile ? 260 : 220);
  }, [finishClose]);

  useEffect(() => {
    if (open) {
      clearExit();
      closingRef.current = false;
      setClosing(false);
      setPresent(true);
    } else {
      requestClose();
    }
  }, [open, clearExit, requestClose]);

  useEffect(
    () => () => {
      clearExit();
      closingRef.current = false;
    },
    [clearExit],
  );

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!present || !compact || !element) return;
    const viewport = window.visualViewport;
    const updateViewport = () => {
      const height = viewport?.height ?? window.innerHeight;
      const bottom = Math.max(
        0,
        window.innerHeight - (viewport?.offsetTop ?? 0) - height,
      );
      element.style.setProperty(
        "--selection-dialog-viewport-height",
        `${height}px`,
      );
      element.style.setProperty(
        "--selection-dialog-viewport-bottom",
        `${bottom}px`,
      );
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      element.style.removeProperty("--selection-dialog-viewport-height");
      element.style.removeProperty("--selection-dialog-viewport-bottom");
    };
  }, [compact, present]);

  useEffect(() => {
    const element = dialog.current;
    if (!present || !element) return;
    // Keep the original trigger when Strict Mode replays the effect.
    if (!element.open) {
      opener.current = document.activeElement as HTMLElement | null;
      element.showModal();
    }
    const trigger = opener.current;
    element
      .querySelector<HTMLElement>("[data-autofocus]")
      ?.focus({ preventScroll: true });
    return () => {
      queueMicrotask(() => {
        if (element.isConnected && element.open) return;
        const active = document.activeElement;
        if (
          trigger?.isConnected &&
          !document.querySelector("dialog[open]") &&
          (!active ||
            active === document.body ||
            !active.isConnected ||
            element.contains(active) ||
            active === trigger)
        ) {
          trigger.focus({ preventScroll: true });
        }
      });
    };
  }, [present]);

  if (!present) return null;

  return createPortal(
    <dialog
      ref={dialog}
      id={id}
      aria-label={title}
      aria-modal="true"
      style={style}
      data-closing={closing ? "true" : undefined}
      className={`${chatStyles["model-selector-container"]} ${styles.dialog} ${
        compact ? styles.compact : ""
      }`}
      onCancel={(event) => {
        event.preventDefault();
        if (!ime.current.isComposing({ key: "Escape" })) requestClose();
      }}
      onCompositionStart={() => ime.current.start()}
      onCompositionEnd={() => ime.current.end()}
      onAnimationEnd={(event) => {
        if (
          closingRef.current &&
          event.currentTarget.dataset.closing === "true" &&
          event.target === event.currentTarget &&
          !event.nativeEvent.pseudoElement
        ) {
          const exitAnimations = getComputedStyle(event.currentTarget)
            .animationName.split(",")
            .map((name) => name.trim());
          if (
            event.animationName &&
            exitAnimations.includes(event.animationName)
          ) {
            finishClose();
          }
        }
      }}
      onClickCapture={(event) => {
        if (!closingRef.current) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          if (!ime.current.isComposing(event.nativeEvent)) requestClose();
          return;
        }
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ),
        ).filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.closest("[hidden], [inert], [aria-hidden='true']") &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== "hidden",
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          requestClose();
        }
      }}
    >
      <div className={chatStyles["model-selector-header"]}>
        <span>{title}</span>
        {headerActions && (
          <div className={styles.headerActions}>{headerActions}</div>
        )}
        <button
          type="button"
          aria-label="关闭"
          className={chatStyles["model-selector-close"]}
          onClick={requestClose}
        >
          <X size={20} />
        </button>
      </div>
      {compact ? (
        <SmoothPanelContent enabled={smoothResize} className={styles.content}>
          {children}
        </SmoothPanelContent>
      ) : (
        children
      )}
    </dialog>,
    document.body,
  );
}
