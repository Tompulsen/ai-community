import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

type AnchoredPanelOptions = {
  align?: "start" | "center" | "end";
  placement?: "auto" | "above" | "below";
  minimumTop?: (trigger: HTMLElement, viewportTop: number) => number;
  measureHeight?: (panel: HTMLDivElement) => number;
  maxHeight?: number;
  gap?: number;
};

export function useAnchoredPanel(
  open: boolean,
  triggerRef: RefObject<HTMLElement>,
  panelRef: RefObject<HTMLDivElement>,
  preferredWidth: number,
  options: AnchoredPanelOptions = {},
): CSSProperties {
  const [position, setPosition] = useState<CSSProperties>({
    visibility: "hidden",
  });
  const {
    align = "start",
    placement = "auto",
    minimumTop: getMinimumTop,
    measureHeight,
    maxHeight: heightLimit = 280,
    gap = 6,
  } = options;

  useLayoutEffect(() => {
    if (!open) return;

    let previousBounds: DOMRect | undefined;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;

      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const anchor = trigger.getBoundingClientRect();
      previousBounds = anchor;
      const margin = 12;
      const minimumTop = Math.max(
        viewportTop + margin,
        getMinimumTop?.(trigger, viewportTop) ?? viewportTop + margin,
      );
      const width = Math.min(
        Math.max(preferredWidth, anchor.width),
        viewportWidth - margin * 2,
      );
      const spaceAbove = Math.max(0, anchor.top - minimumTop - gap);
      const spaceBelow = Math.max(
        0,
        viewportTop + viewportHeight - anchor.bottom - margin - gap,
      );
      const contentHeight = measureHeight?.(panel) ?? panel.scrollHeight;
      const preferredHeight = Math.min(contentHeight, heightLimit);
      const above =
        placement === "above" ||
        (placement === "below"
          ? spaceBelow < preferredHeight && spaceAbove > spaceBelow
          : spaceAbove >= preferredHeight || spaceAbove >= spaceBelow);
      const maxHeight = Math.min(heightLimit, above ? spaceAbove : spaceBelow);
      const height = Math.min(contentHeight, maxHeight);
      const alignedLeft =
        align === "center"
          ? anchor.left + (anchor.width - width) / 2
          : align === "end"
          ? anchor.right - width
          : anchor.left;
      const left = Math.max(
        viewportLeft + margin,
        Math.min(alignedLeft, viewportLeft + viewportWidth - margin - width),
      );

      setPosition({
        left,
        ...(placement === "above"
          ? { top: "auto", bottom: window.innerHeight - anchor.top + gap }
          : {
              top: Math.max(
                minimumTop,
                Math.min(
                  above ? anchor.top - gap - height : anchor.bottom + gap,
                  viewportTop + viewportHeight - margin - height,
                ),
              ),
            }),
        width,
        maxHeight,
        visibility: "visible",
      });
    };

    updatePosition();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updatePosition);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    if (panelRef.current && placement !== "above")
      observer?.observe(panelRef.current);
    let frame: number | undefined;
    if (placement !== "auto") {
      // Ancestor layout can move a trigger without changing its own size.
      const followTrigger = () => {
        const bounds = triggerRef.current?.getBoundingClientRect();
        if (
          bounds &&
          (bounds.top !== previousBounds?.top ||
            bounds.left !== previousBounds?.left ||
            bounds.width !== previousBounds?.width ||
            bounds.height !== previousBounds?.height)
        )
          updatePosition();
        frame = requestAnimationFrame(followTrigger);
      };
      frame = requestAnimationFrame(followTrigger);
    }
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      observer?.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [
    open,
    triggerRef,
    panelRef,
    preferredWidth,
    align,
    placement,
    getMinimumTop,
    measureHeight,
    heightLimit,
    gap,
  ]);

  return {
    ...position,
    position: "fixed",
    right: "auto",
    bottom: position.bottom ?? "auto",
    minWidth: 0,
  };
}
