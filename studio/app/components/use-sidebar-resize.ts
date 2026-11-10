import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  NARROW_SIDEBAR_WIDTH,
} from "../constant";
import { prefersReducedMotion } from "../utils/motion";

const SNAP_POINT = (NARROW_SIDEBAR_WIDTH + MIN_SIDEBAR_WIDTH) / 2;
const clampWidth = (width: number) =>
  Math.max(NARROW_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, width));

export function useSidebarResize(options: {
  width: number;
  isMobile: boolean;
  onWidthChange: (width: number) => void;
}) {
  const current = useRef(options);
  current.current = options;
  const [previewNarrow, setPreviewNarrow] = useState<boolean | null>(null);
  const host = useRef<HTMLElement | null>(null);
  const frame = useRef<number>();
  const releasePointer = useRef<() => void>();
  const pendingWidth = useRef<number>();
  const settleTarget = useRef<number>();
  const expandedWidth = useRef(
    options.width >= MIN_SIDEBAR_WIDTH ? options.width : DEFAULT_SIDEBAR_WIDTH,
  );

  const cancelFrame = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
  }, []);
  const clearPreview = useCallback(() => {
    host.current?.style.removeProperty("--sidebar-live-width");
    if (host.current) {
      delete host.current.dataset.sidebarResizing;
      delete host.current.dataset.sidebarSettling;
    }
    host.current = null;
    pendingWidth.current = undefined;
    settleTarget.current = undefined;
    setPreviewNarrow(null);
  }, []);
  const deferClearPreview = useCallback(() => {
    cancelFrame();
    // Let the final width paint while native reading anchoring is still enabled.
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        clearPreview();
      });
    });
  }, [cancelFrame, clearPreview]);
  const reset = useCallback(() => {
    releasePointer.current?.();
    releasePointer.current = undefined;
    cancelFrame();
    clearPreview();
  }, [cancelFrame, clearPreview]);

  useLayoutEffect(() => {
    if (options.width >= MIN_SIDEBAR_WIDTH)
      expandedWidth.current = options.width;
    if (options.isMobile) reset();
    else if (pendingWidth.current === options.width) deferClearPreview();
  }, [options.width, options.isMobile, deferClearPreview, reset]);
  useLayoutEffect(() => reset, [reset]);

  const writeWidth = (width: number) => {
    host.current?.style.setProperty("--sidebar-live-width", `${width}px`);
    setPreviewNarrow(width < MIN_SIDEBAR_WIDTH);
  };
  const settle = (target: number) => {
    cancelFrame();
    const element = host.current;
    if (!element) return;
    // Later actions follow the latest target while persistence waits for settling.
    settleTarget.current = target;
    if (target >= MIN_SIDEBAR_WIDTH) expandedWidth.current = target;
    delete element.dataset.sidebarResizing;
    element.dataset.sidebarSettling = "true";
    const from = parseFloat(
      element.style.getPropertyValue("--sidebar-live-width"),
    );
    const finish = () => {
      frame.current = undefined;
      writeWidth(target);
      pendingWidth.current = target;
      if (current.current.width === target) deferClearPreview();
      else current.current.onWidthChange(target);
    };
    if (prefersReducedMotion() || Math.abs(from - target) < 0.5) {
      finish();
      return;
    }
    const start = performance.now();
    const tick = (time: number) => {
      const progress = Math.min(1, Math.max(0, (time - start) / 280));
      if (prefersReducedMotion() || progress === 1) {
        finish();
        return;
      }
      const eased = 1 - Math.pow(1 - progress, 3);
      writeWidth(from + (target - from) * eased);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  const prepare = (handle: HTMLElement) => {
    const sidebar = handle.parentElement;
    if (!sidebar?.parentElement) return;
    // Read the visible width before interrupting a previous snap.
    const width = sidebar.getBoundingClientRect().width;
    releasePointer.current?.();
    releasePointer.current = undefined;
    cancelFrame();
    host.current = sidebar.parentElement;
    pendingWidth.current = undefined;
    writeWidth(width);
    return width;
  };
  const toggleWidth = () =>
    (settleTarget.current ?? current.current.width) < MIN_SIDEBAR_WIDTH
      ? expandedWidth.current
      : NARROW_SIDEBAR_WIDTH;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      current.current.isMobile ||
      event.button !== 0 ||
      event.isPrimary === false
    )
      return;
    const handle = event.currentTarget;
    const startWidth = prepare(handle);
    if (startWidth === undefined) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    host.current!.dataset.sidebarResizing = "true";
    delete host.current!.dataset.sidebarSettling;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    let nextWidth = startWidth;
    let distance = 0;
    const update = (e: globalThis.PointerEvent) => {
      const delta = e.clientX - startX;
      distance = Math.max(distance, Math.abs(delta));
      nextWidth = clampWidth(startWidth + delta);
    };
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      update(e);
      if (frame.current === undefined) {
        frame.current = requestAnimationFrame(() => {
          frame.current = undefined;
          writeWidth(nextWidth);
        });
      }
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      handle.removeEventListener("lostpointercapture", cancel);
      if (handle.hasPointerCapture?.(pointerId))
        handle.releasePointerCapture(pointerId);
    };
    const cancel = (e: Event) => {
      if ("pointerId" in e && e.pointerId !== pointerId) return;
      cleanup();
      releasePointer.current = undefined;
      settle(current.current.width);
    };
    const end = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      update(e);
      cleanup();
      releasePointer.current = undefined;
      cancelFrame();
      writeWidth(nextWidth);
      const target =
        distance <= 4
          ? toggleWidth()
          : nextWidth < SNAP_POINT
          ? NARROW_SIDEBAR_WIDTH
          : Math.max(MIN_SIDEBAR_WIDTH, nextWidth);
      settle(target);
    };
    handle.setPointerCapture?.(pointerId);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    handle.addEventListener("lostpointercapture", cancel);
    releasePointer.current = cleanup;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (current.current.isMobile) return;
    const width = settleTarget.current ?? current.current.width;
    let target: number;
    switch (event.key) {
      case "Enter":
      case " ":
        target = toggleWidth();
        break;
      case "ArrowRight":
        target = Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, width + 24),
        );
        break;
      case "ArrowLeft":
        target =
          width <= MIN_SIDEBAR_WIDTH
            ? NARROW_SIDEBAR_WIDTH
            : Math.max(MIN_SIDEBAR_WIDTH, width - 24);
        break;
      case "Home":
        target = NARROW_SIDEBAR_WIDTH;
        break;
      case "End":
        target = MAX_SIDEBAR_WIDTH;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (prepare(event.currentTarget) !== undefined) settle(target);
  };

  return {
    onPointerDown,
    onKeyDown,
    shouldNarrow:
      !options.isMobile && (previewNarrow ?? options.width < MIN_SIDEBAR_WIDTH),
  };
}
