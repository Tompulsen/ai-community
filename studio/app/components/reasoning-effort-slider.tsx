import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  REASONING_EFFORT_OPTIONS,
  type ReasoningEffort,
} from "../utils/chat-params";
import styles from "./reasoning-effort-slider.module.scss";
import {
  REASONING_PARTICLES,
  drawEffortBackground,
  energyFor,
  fillBackgroundFor,
  speedFor,
  starBrightnessFor,
  starCountFor,
  starDelayFor,
  starDurationFor,
  starLayerOpacityFor,
} from "../utils/reasoning-effort-motion";

// Visual adaptation: github.com/Microqian2th/dsh-codex-effort-slider (MIT).
// License and copyright are preserved in THIRD_PARTY_NOTICES.md.
const levels = REASONING_EFFORT_OPTIONS.filter(
  (option) => option.value !== "auto",
);
const endInset = 22;

interface Drag {
  pointerId: number;
  value: ReasoningEffort;
  position: number;
  offset: number;
  element: HTMLInputElement;
}

function positionOf(value: ReasoningEffort) {
  if (value === "auto") return 2 / (levels.length - 1);
  const index = levels.findIndex((option) => option.value === value);
  return Math.max(0, index) / (levels.length - 1);
}

function pointerPosition(drag: Drag, clientX: number) {
  const rect = drag.element.getBoundingClientRect();
  const width = rect.width - endInset * 2;
  return width > 0
    ? Math.max(
        0,
        Math.min(1, (clientX - rect.left - endInset - drag.offset) / width),
      )
    : drag.position;
}

function releaseCapture(drag: Drag) {
  try {
    if (drag.element.hasPointerCapture?.(drag.pointerId))
      drag.element.releasePointerCapture(drag.pointerId);
  } catch {
    // Capture may already be released by a browser gesture or window change.
  }
}

export function ReasoningEffortSlider(props: {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  compact?: boolean;
  onPreviewChange?: (value: ReasoningEffort | null) => void;
}) {
  const currentValue = useRef(props.value);
  const onChange = useRef(props.onChange);
  const onPreviewChange = useRef(props.onPreviewChange);
  const preview = useRef<ReasoningEffort | null>(null);
  currentValue.current = props.value;
  onChange.current = props.onChange;
  onPreviewChange.current = props.onPreviewChange;
  const dragRef = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<{
    value: ReasoningEffort;
    position: number;
  } | null>(null);
  const [pageVisible, setPageVisible] = useState(true);
  const dragging = draft !== null && draft.value === props.value;
  const automatic = !dragging && props.value === "auto";
  const position = dragging ? draft.position : positionOf(props.value);
  const index = Math.round(position * (levels.length - 1));
  const label = automatic ? "服务商默认" : levels[index].label;
  const energy = automatic ? 0 : energyFor(position);
  const energized = energy > 0;
  const starCount = automatic ? 0 : starCountFor(position);
  const starSpeed = speedFor(position);
  const field = useRef<HTMLCanvasElement>(null);
  const fieldPosition = useRef(position);
  const paintField = useRef<(() => void) | null>(null);
  fieldPosition.current = position;

  useEffect(() => {
    const canvas = field.current;
    if (!canvas) return;
    const paint = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const bitmapWidth = Math.round(width * dpr);
      const bitmapHeight = Math.round(height * dpr);
      if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
        canvas.width = bitmapWidth;
        canvas.height = bitmapHeight;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawEffortBackground(ctx, width, height, fieldPosition.current);
    };
    paintField.current = paint;
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(paint);
    observer?.observe(canvas);
    window.addEventListener("resize", paint);
    paint();
    return () => {
      paintField.current = null;
      observer?.disconnect();
      window.removeEventListener("resize", paint);
    };
  }, []);

  useEffect(() => {
    paintField.current?.();
  }, [position]);

  const publishPreview = useCallback((value: ReasoningEffort | null) => {
    if (preview.current === value) return;
    preview.current = value;
    onPreviewChange.current?.(value);
  }, []);

  const finish = useCallback(
    (pointerId: number, commit: boolean, clientX?: number) => {
      const drag = dragRef.current;
      if (!drag || pointerId !== drag.pointerId) return;
      const position =
        clientX === undefined ? drag.position : pointerPosition(drag, clientX);
      dragRef.current = null;
      setDraft(null);
      publishPreview(null);
      releaseCapture(drag);
      if (commit && drag.value === currentValue.current) {
        const value = levels[Math.round(position * (levels.length - 1))].value;
        if (value !== currentValue.current) onChange.current(value);
      }
    },
    [publishPreview],
  );
  const cancel = useCallback(() => {
    const drag = dragRef.current;
    if (drag) finish(drag.pointerId, false);
  }, [finish]);
  const selectLevel = (value: ReasoningEffort) => {
    cancel();
    if (value !== currentValue.current) onChange.current(value);
  };

  useEffect(() => {
    if (dragRef.current?.value !== props.value) cancel();
  }, [props.value, cancel]);

  useEffect(() => {
    const pointerUp = (event: PointerEvent) =>
      finish(event.pointerId, true, event.clientX);
    const pointerCancel = (event: PointerEvent) =>
      finish(event.pointerId, false);
    const visibilityChange = () => {
      setPageVisible(!document.hidden);
      if (document.hidden) cancel();
    };
    const windowBlur = () => {
      setPageVisible(false);
      cancel();
    };
    const windowFocus = () => setPageVisible(!document.hidden);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dragRef.current) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    visibilityChange();
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerCancel);
    window.addEventListener("blur", windowBlur);
    window.addEventListener("focus", windowFocus);
    window.addEventListener("keydown", escape, true);
    document.addEventListener("visibilitychange", visibilityChange);
    return () => {
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("blur", windowBlur);
      window.removeEventListener("focus", windowFocus);
      window.removeEventListener("keydown", escape, true);
      document.removeEventListener("visibilitychange", visibilityChange);
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag) releaseCapture(drag);
      publishPreview(null);
    };
  }, [cancel, finish, publishPreview]);

  const move = (event: ReactPointerEvent<HTMLInputElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.value !== currentValue.current) {
      cancel();
      return;
    }
    const next = pointerPosition(drag, event.clientX);
    if (next === drag.position) return;
    drag.position = next;
    setDraft({ value: drag.value, position: next });
    publishPreview(levels[Math.round(next * (levels.length - 1))].value);
  };

  return (
    <div
      className={styles.control}
      data-compact={!!props.compact}
      data-automatic={automatic}
      data-dragging={dragging}
      data-level={automatic ? "auto" : levels[index].value}
      data-energized={energized}
      data-page-visible={pageVisible}
      style={
        {
          "--effort-index": position * (levels.length - 1),
          "--effort-position": position,
          "--effort-steps": levels.length - 1,
          "--effort-energy": energy,
        } as CSSProperties
      }
    >
      {!props.compact && (
        <div className={styles.header}>
          <output className={styles.value} aria-live="polite">
            {label}
          </output>
          <button
            type="button"
            className={styles.automatic}
            aria-pressed={automatic}
            onClick={() => selectLevel("auto")}
          >
            自动
          </button>
        </div>
      )}
      <div className={styles.slider}>
        <div className={styles.rail} aria-hidden="true">
          <canvas
            ref={field}
            className={styles.fill}
            aria-hidden="true"
            style={{ background: fillBackgroundFor(position) }}
          />
          <span className={styles.energy}>
            <span className={styles.sweep} />
          </span>
          <span
            className={styles.stars}
            style={{ opacity: starLayerOpacityFor(position).toFixed(3) }}
          >
            {REASONING_PARTICLES.slice(0, starCount).map((particle, index) => {
              const brightness = starBrightnessFor(index);
              const duration = starDurationFor(index, starSpeed);
              const delay = starDelayFor(index, duration);
              return (
                <span
                  key={index}
                  className={styles.particle}
                  style={
                    {
                      top: `${particle.y}%`,
                      animationDuration: `${duration.toFixed(3)}s`,
                      animationDelay: `${delay.toFixed(3)}s`,
                      "--star-duration": `${duration}s`,
                      "--star-delay": `${delay}s`,
                    } as CSSProperties
                  }
                >
                  <span
                    className={styles.particleDot}
                    data-brightness={brightness.toFixed(3)}
                    style={
                      {
                        "--star-brightness": brightness.toFixed(3),
                      } as CSSProperties
                    }
                  />
                </span>
              );
            })}
          </span>
          <span className={styles.ticks}>
            {levels.map((option, tick) => (
              <span
                key={option.value}
                data-active={!automatic && tick <= index}
              />
            ))}
          </span>
        </div>
        <span className={styles.thumb} aria-hidden="true" />
        <input
          type="range"
          aria-label="推理强度"
          aria-valuetext={
            automatic ? "自动，使用服务商默认设置" : levels[index].label
          }
          min={0}
          max={levels.length - 1}
          step={1}
          value={index}
          onChange={(event) => {
            if (dragRef.current) return;
            const option = levels[Number(event.currentTarget.value)];
            if (option) selectLevel(option.value);
          }}
          onPointerDown={(event) => {
            if (
              event.button !== 0 ||
              event.isPrimary === false ||
              dragRef.current
            )
              return;
            const rect = event.currentTarget.getBoundingClientRect();
            if (rect.width <= endInset * 2) return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            const position = positionOf(currentValue.current);
            const center =
              rect.left + endInset + position * (rect.width - endInset * 2);
            const offset =
              Math.abs(event.clientX - center) <= (props.compact ? 11 : 14)
                ? event.clientX - center
                : 0;
            const drag: Drag = {
              pointerId: event.pointerId,
              value: currentValue.current,
              position,
              offset,
              element: event.currentTarget,
            };
            drag.position = pointerPosition(drag, event.clientX);
            dragRef.current = drag;
            setDraft({ value: drag.value, position: drag.position });
            publishPreview(
              levels[Math.round(drag.position * (levels.length - 1))].value,
            );
            try {
              event.currentTarget.setPointerCapture?.(event.pointerId);
            } catch {
              // Window pointerup remains a fallback when capture is unavailable.
            }
          }}
          onPointerMove={move}
          onPointerUp={(event) => finish(event.pointerId, true, event.clientX)}
          onPointerCancel={(event) => finish(event.pointerId, false)}
          onLostPointerCapture={(event) => finish(event.pointerId, false)}
          onBlur={cancel}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            const key = event.key;
            const current = Math.round(
              positionOf(currentValue.current) * (levels.length - 1),
            );
            const next =
              key === "Home"
                ? 0
                : key === "End"
                ? levels.length - 1
                : ["ArrowLeft", "ArrowDown", "PageDown"].includes(key)
                ? Math.max(0, current - 1)
                : ["ArrowRight", "ArrowUp", "PageUp"].includes(key)
                ? Math.min(levels.length - 1, current + 1)
                : null;
            if (next === null) return;
            event.preventDefault();
            selectLevel(levels[next].value);
          }}
        />
      </div>
      {!props.compact && (
        <div className={styles.labels}>
          {levels.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={!automatic && levels[index].value === option.value}
              onClick={() => selectLevel(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
