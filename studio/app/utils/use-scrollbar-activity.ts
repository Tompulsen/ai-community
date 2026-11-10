"use client";

import { useEffect, type RefObject } from "react";

export function useScrollbarActivity(ref: RefObject<HTMLElement>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    let pointerId: number | undefined;
    const show = () => {
      clearTimeout(timer);
      element.dataset.scrollbarActive = "true";
      if (pointerId === undefined)
        timer = setTimeout(() => {
          delete element.dataset.scrollbarActive;
        }, 800);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.pointerType !== "mouse" ||
        event.button !== 0 ||
        pointerId !== undefined
      )
        return;
      const rect = element.getBoundingClientRect();
      const width = Math.max(8, element.offsetWidth - element.clientWidth);
      const onScrollbar =
        getComputedStyle(element).direction === "rtl"
          ? event.clientX <= rect.left + width
          : event.clientX >= rect.right - width;
      if (!onScrollbar) return;
      pointerId = event.pointerId;
      show();
    };
    const onPointerEnd = (event: Event) => {
      if (
        pointerId === undefined ||
        ("pointerId" in event && event.pointerId !== pointerId)
      )
        return;
      pointerId = undefined;
      show();
    };
    element.addEventListener("scroll", show, { passive: true });
    element.addEventListener("wheel", show, { passive: true });
    element.addEventListener("touchmove", show, { passive: true });
    element.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    window.addEventListener("blur", onPointerEnd);
    return () => {
      clearTimeout(timer);
      delete element.dataset.scrollbarActive;
      element.removeEventListener("scroll", show);
      element.removeEventListener("wheel", show);
      element.removeEventListener("touchmove", show);
      element.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("blur", onPointerEnd);
    };
  }, [ref]);
}
