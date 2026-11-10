"use client";

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type RefObject,
} from "react";
import { prefersReducedMotion } from "../utils/motion";
import styles from "./collapsible-content.module.scss";

export function CollapsibleContent({
  open,
  id,
  className,
  triggerRef,
  onCollapsed,
  children,
}: {
  open: boolean;
  id?: string;
  className?: string;
  triggerRef?: RefObject<HTMLElement>;
  onCollapsed?: () => void;
  children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousOpen = useRef(open);
  const onCollapsedRef = useRef(onCollapsed);
  onCollapsedRef.current = onCollapsed;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const changed = previousOpen.current !== open;
    previousOpen.current = open;
    if (!viewport) return;
    const focusWasInside = viewport.contains(document.activeElement);
    viewport.toggleAttribute("inert", !open);
    if (!open && focusWasInside) {
      triggerRef?.current?.focus({ preventScroll: true });
    }
    if (open || !changed || !onCollapsedRef.current) return;

    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let timeout: ReturnType<typeof setTimeout>;
    let finished = false;
    const cleanup = () => {
      clearTimeout(timeout);
      viewport.removeEventListener("transitionend", onEnd);
      media?.removeEventListener?.("change", onMotionChange);
      observer.disconnect();
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      cleanup();
      onCollapsedRef.current?.();
    };
    const onEnd = (event: TransitionEvent) => {
      if (
        event.target === viewport &&
        event.propertyName === "grid-template-rows"
      )
        finish();
    };
    const onMotionChange = () => {
      if (prefersReducedMotion()) finish();
    };
    const observer = new MutationObserver(onMotionChange);
    viewport.addEventListener("transitionend", onEnd);
    media?.addEventListener?.("change", onMotionChange);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-motion"],
    });
    timeout = setTimeout(finish, 260);
    onMotionChange();
    return () => {
      finished = true;
      cleanup();
    };
  }, [open, triggerRef]);

  return (
    <div
      ref={viewportRef}
      id={id}
      className={styles.collapse}
      data-collapsible
      data-open={open}
      aria-hidden={!open || undefined}
    >
      <div className={styles.clip}>
        <div className={className}>{children}</div>
      </div>
    </div>
  );
}

export function SmoothDetails({
  summary,
  children,
  openOn = false,
  ...props
}: Omit<ComponentPropsWithoutRef<"details">, "open" | "onToggle"> & {
  summary: ReactNode;
  openOn?: boolean;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const contentId = useId();
  const [expanded, setExpanded] = useState(openOn);
  const [present, setPresent] = useState(openOn);
  const previousOpenOn = useRef(openOn);
  const reveal = useCallback(() => {
    const details = detailsRef.current;
    if (!details) return;
    details.open = true;
    // Establish the collapsed grid before the browser paints its open state.
    details.querySelector("[data-collapsible]")?.getBoundingClientRect();
    setPresent(true);
    setExpanded(true);
  }, []);

  useLayoutEffect(() => {
    const changed = previousOpenOn.current !== openOn;
    previousOpenOn.current = openOn;
    if (changed && openOn) reveal();
  }, [openOn, reveal]);

  return (
    <details
      {...props}
      ref={detailsRef}
      open={present}
      onToggle={(event) => {
        if (
          event.target !== event.currentTarget ||
          event.currentTarget.open === present
        )
          return;
        setPresent(event.currentTarget.open);
        setExpanded(event.currentTarget.open);
      }}
    >
      <summary
        ref={summaryRef}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={(event) => {
          event.preventDefault();
          if (expanded) setExpanded(false);
          else reveal();
        }}
      >
        {summary}
      </summary>
      <CollapsibleContent
        id={contentId}
        open={expanded}
        triggerRef={summaryRef}
        onCollapsed={() => setPresent(false)}
      >
        {children}
      </CollapsibleContent>
    </details>
  );
}
