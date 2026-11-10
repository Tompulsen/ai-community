import { useCallback, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../utils/motion";

const segmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

const STREAM_CATCH_UP_MS = 250;
const FINISH_CATCH_UP_MS = 320;

function takeCharacters(text: string, count: number) {
  if (!segmenter) return Array.from(text).slice(0, count).join("");
  let result = "";
  for (const { segment } of segmenter.segment(text)) {
    result += segment;
    if (--count <= 0) break;
  }
  return result;
}

/** Pace the visible text independently of network completion and persistence. */
export function useTypewriterText(
  content: string,
  streaming: boolean,
  instant = false,
) {
  // Opening saved history (including a running conversation) must not replay it.
  const [displayed, setDisplayed] = useState(content);
  const visible = useRef(content);
  const target = useRef(content);
  const wasStreaming = useRef(streaming);
  const activeStreaming = useRef(streaming);
  const frame = useRef<number | null>(null);
  const lastTime = useRef(0);
  const credit = useRef(0);
  const finishDeadline = useRef<number | null>(null);
  const reducedMotion = useRef(false);

  const cancel = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  const flush = useCallback(() => {
    cancel();
    visible.current = target.current;
    setDisplayed(target.current);
    credit.current = 0;
    finishDeadline.current = null;
    wasStreaming.current = activeStreaming.current;
  }, [cancel]);

  const schedule = useCallback(() => {
    if (frame.current !== null || visible.current === target.current) return;
    lastTime.current = performance.now();
    const advance = (time: number) => {
      frame.current = null;
      if (document.hidden || reducedMotion.current) {
        flush();
        return;
      }
      if (finishDeadline.current !== null && time >= finishDeadline.current) {
        flush();
        return;
      }
      const elapsed = time - lastTime.current;
      if (elapsed >= 24) {
        lastTime.current = time;
        let remaining = target.current.slice(visible.current.length);
        // The transport may split a UTF-16 pair between incremental updates.
        const lastCode = remaining.charCodeAt(remaining.length - 1);
        if (
          activeStreaming.current &&
          lastCode >= 0xd800 &&
          lastCode <= 0xdbff
        ) {
          remaining = remaining.slice(0, -1);
        }
        // Keep a short visible buffer even when tokens arrive faster than typing.
        const catchUpMs =
          finishDeadline.current === null
            ? STREAM_CATCH_UP_MS
            : Math.max(32, finishDeadline.current - time);
        const rate = Math.max(72, (remaining.length * 1000) / catchUpMs);
        credit.current += (Math.min(elapsed, 64) * rate) / 1000;
        const count = Math.min(
          activeStreaming.current ? 512 : remaining.length,
          Math.floor(credit.current),
        );
        if (count > 0) {
          credit.current -= count;
          visible.current += takeCharacters(remaining, count);
          setDisplayed(visible.current);
        }
      }
      if (visible.current !== target.current) {
        frame.current = requestAnimationFrame(advance);
      } else {
        credit.current = 0;
        wasStreaming.current = activeStreaming.current;
      }
    };
    frame.current = requestAnimationFrame(advance);
  }, [flush]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = () => {
      reducedMotion.current = prefersReducedMotion();
      if (reducedMotion.current) flush();
    };
    onMotionChange();
    const observer = new MutationObserver(onMotionChange);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-motion"],
    });
    // Hidden tabs still receive/persist the full response; do not replay it.
    document.addEventListener("visibilitychange", flush);
    media.addEventListener("change", onMotionChange);
    return () => {
      cancel();
      observer.disconnect();
      document.removeEventListener("visibilitychange", flush);
      media.removeEventListener("change", onMotionChange);
    };
  }, [cancel, flush]);

  useEffect(() => {
    target.current = content;
    activeStreaming.current = streaming;
    const shouldAnimate = streaming || wasStreaming.current;
    wasStreaming.current = streaming || visible.current !== content;
    if (
      !shouldAnimate ||
      instant ||
      document.hidden ||
      reducedMotion.current ||
      !content.startsWith(visible.current)
    ) {
      flush();
      wasStreaming.current = streaming;
      return;
    }
    if (streaming) {
      finishDeadline.current = null;
    } else if (finishDeadline.current === null && visible.current !== content) {
      finishDeadline.current = performance.now() + FINISH_CATCH_UP_MS;
    }
    schedule();
  }, [content, streaming, instant, flush, schedule]);

  return instant ? content : displayed;
}
