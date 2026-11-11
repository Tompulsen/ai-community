"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { prefersReducedMotion } from "../utils/motion";
import styles from "./smooth-panel-content.module.scss";

export function SmoothPanelContent(props: {
  enabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const body = bodyRef.current;
    if (
      !props.enabled ||
      !viewport?.animate ||
      !body ||
      typeof ResizeObserver === "undefined"
    )
      return;

    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let animation: Animation | undefined;
    let previousSize = "";
    const positions = new Map<HTMLElement, number>();
    const movements = new Map<HTMLElement, Animation>();

    const updatePositions = (animate: boolean) => {
      for (const element of positions.keys()) {
        if (body.contains(element)) continue;
        movements.get(element)?.cancel();
        movements.delete(element);
        positions.delete(element);
      }
      for (const element of body.querySelectorAll<HTMLElement>(
        "[data-panel-layout]",
      )) {
        let translation = 0;
        const movement = movements.get(element);
        if (movement) {
          const before = element.getBoundingClientRect().top;
          movement.cancel();
          const scale = body.getBoundingClientRect().width / body.offsetWidth;
          translation =
            (before - element.getBoundingClientRect().top) / (scale || 1);
          movements.delete(element);
        }
        const next = element.offsetTop;
        const offset = (positions.get(element) ?? next) - next + translation;
        positions.set(element, next);
        if (!animate || Math.abs(offset) < 1) continue;
        const current = element.animate(
          [
            { transform: `translateY(${offset}px)` },
            { transform: "translateY(0)" },
          ],
          { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
        movements.set(element, current);
        current.onfinish = () => {
          if (movements.get(element) === current) movements.delete(element);
        };
      }
    };

    const update = (force = false) => {
      if (
        viewport.clientWidth === 0 ||
        (!previousSize && body.offsetHeight === 0)
      )
        return;
      const computed = getComputedStyle(viewport);
      const size = [
        body.offsetHeight,
        viewport.clientWidth,
        computed.maxHeight,
        window.innerHeight,
        window.visualViewport?.height,
      ].join(":");
      if (!force && size === previousSize) return;
      const initialized = previousSize !== "";
      previousSize = size;
      const animate = initialized && !prefersReducedMotion();
      updatePositions(animate);
      const currentHeight = viewport.offsetHeight;
      animation?.cancel();
      animation = undefined;
      delete viewport.dataset.resizing;

      // Measure the final constrained size before animating this isolated panel.
      viewport.style.height = "auto";
      const nextHeight = viewport.offsetHeight;
      viewport.style.height = `${nextHeight}px`;
      if (!animate || Math.abs(nextHeight - currentHeight) < 1) return;

      viewport.dataset.resizing = "true";
      const current = viewport.animate(
        [{ height: `${currentHeight}px` }, { height: `${nextHeight}px` }],
        {
          duration: 220,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        },
      );
      animation = current;
      current.onfinish = () => {
        if (animation !== current) return;
        animation = undefined;
        delete viewport.dataset.resizing;
      };
    };

    update();
    const observer = new ResizeObserver(() => update());
    observer.observe(body);
    observer.observe(viewport);
    const resize = () => update(true);
    const motionObserver = new MutationObserver(resize);
    motionObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-motion"],
    });
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    media?.addEventListener?.("change", resize);
    return () => {
      observer.disconnect();
      motionObserver.disconnect();
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      media?.removeEventListener?.("change", resize);
      animation?.cancel();
      movements.forEach((movement) => movement.cancel());
      viewport.style.removeProperty("height");
      delete viewport.dataset.resizing;
    };
  }, [props.enabled]);

  return (
    <div
      ref={viewportRef}
      className={[props.className, props.enabled && styles.viewport]
        .filter(Boolean)
        .join(" ")}
    >
      {props.enabled ? (
        <div ref={bodyRef} className={styles.body}>
          {props.children}
        </div>
      ) : (
        props.children
      )}
    </div>
  );
}
