"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "../utils/use-anchored-panel";
import { isSelectMenuWithin } from "../utils/select-interaction";
import { SmoothPanelContent } from "./smooth-panel-content";
import styles from "./composer-parameter-popover.module.scss";

function measurePopoverHeight(panel: HTMLDivElement) {
  const content = panel.querySelector<HTMLDivElement>(`.${styles.content}`);
  return content ? content.scrollHeight + 2 : panel.scrollHeight;
}

function focusPopover(panel: HTMLDivElement, initialFocus?: string) {
  const requested = initialFocus
    ? panel.querySelector<HTMLElement>(initialFocus)
    : null;
  const target =
    requested ??
    panel.querySelector<HTMLElement>(
      'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex="0"]',
    );
  (target ?? panel).focus({ preventScroll: true });
}

export function ComposerParameterPopover(props: {
  id: string;
  label: string;
  open: boolean;
  triggerRef: RefObject<HTMLElement>;
  anchorRef?: RefObject<HTMLElement>;
  align?: "start" | "center" | "end";
  width?: number;
  compact?: boolean;
  smoothResize?: boolean;
  onClose: (reason: "escape" | "outside") => void;
  children: ReactNode;
  initialFocus?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);
  const closeRequested = useRef(false);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  const [anchor, setAnchor] = useState({ side: "above", offset: 32 });
  const position = useAnchoredPanel(
    props.open,
    props.anchorRef ?? props.triggerRef,
    panelRef,
    props.width ?? (props.compact ? 272 : 320),
    {
      align: props.align ?? "end",
      placement: props.smoothResize ? "above" : "auto",
      gap: 8,
      maxHeight: 480,
      measureHeight: measurePopoverHeight,
    },
  );

  useLayoutEffect(() => {
    if (props.open) {
      closeRequested.current = false;
      // Keyboard activation enters the panel; pointer activation keeps it quiet.
      focusOnOpen.current =
        props.triggerRef.current?.matches(":focus-visible") ?? true;
    }
  }, [props.open, props.triggerRef]);

  useLayoutEffect(() => {
    const trigger = (props.anchorRef ?? props.triggerRef).current;
    if (!props.open || !trigger || position.visibility !== "visible") return;
    const bounds = trigger.getBoundingClientRect();
    const left = Number(position.left);
    const width = Number(position.width);
    const side = Number(position.top) >= bounds.bottom ? "below" : "above";
    const offset = Math.max(
      20,
      Math.min(width - 20, bounds.left + bounds.width / 2 - left),
    );
    setAnchor((current) =>
      current.side === side && current.offset === offset
        ? current
        : { side, offset },
    );
  }, [
    props.open,
    props.triggerRef,
    props.anchorRef,
    position.left,
    position.top,
    position.width,
    position.visibility,
  ]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (
      !props.open ||
      !panel ||
      !focusOnOpen.current ||
      position.visibility !== "visible"
    )
      return;
    focusPopover(panel, props.initialFocus);
  }, [props.open, props.initialFocus, position.visibility]);

  useEffect(() => {
    if (!props.open) return;
    const requestClose = (reason: "escape" | "outside") => {
      if (closeRequested.current) return;
      closeRequested.current = true;
      onClose.current(reason);
    };
    const outside = (event: PointerEvent | FocusEvent) => {
      // Radix Select blocks outside pointer events; let its menu dismiss first.
      if (
        panelRef.current?.querySelector(
          '[data-select-trigger][aria-expanded="true"]',
        )
      )
        return;
      const target = event.target;
      if (
        target instanceof Node &&
        !props.triggerRef.current?.contains(target) &&
        !props.anchorRef?.current?.contains(target) &&
        !panelRef.current?.contains(target) &&
        !isSelectMenuWithin(target, panelRef.current)
      )
        requestClose("outside");
    };
    const keyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Tab" &&
        !event.shiftKey &&
        !event.defaultPrevented &&
        event.target instanceof Node &&
        props.triggerRef.current?.contains(event.target) &&
        panelRef.current &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        focusPopover(panelRef.current, props.initialFocus);
        return;
      }
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        document.querySelector("dialog[open]")
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      requestClose("escape");
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", keyDown);
    };
  }, [props.open, props.triggerRef, props.anchorRef, props.initialFocus]);

  if (!props.open) return null;

  return createPortal(
    <div
      ref={panelRef}
      id={props.id}
      role="dialog"
      aria-label={props.label}
      aria-modal="false"
      tabIndex={-1}
      data-side={anchor.side}
      data-compact={props.compact || undefined}
      className={styles.panel}
      style={
        {
          ...position,
          "--parameter-popover-max-height": `${position.maxHeight ?? 480}px`,
          "--parameter-popover-arrow-left": `${anchor.offset}px`,
        } as CSSProperties
      }
    >
      <SmoothPanelContent
        enabled={props.smoothResize}
        className={styles.content}
      >
        {props.children}
      </SmoothPanelContent>
    </div>,
    document.body,
  );
}
