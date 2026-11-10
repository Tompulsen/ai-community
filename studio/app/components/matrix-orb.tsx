"use client";

import React, { useEffect, useRef, useSyncExternalStore } from "react";
import { useAppConfig } from "../store/config";
import Locale from "../locales";

type MatrixOrbState = "idle" | "listening" | "thinking";

type MatrixOrbProps = React.ComponentProps<"div"> & {
  state?: MatrixOrbState;
  level?: number;
  size?: number;
  color?: string;
  dots?: number;
};

const TAU = Math.PI * 2;
const STATES: MatrixOrbState[] = ["idle", "listening", "thinking"];
const SCALE = { idle: 0.88, listening: 1, thinking: 0.92 };
const ORBITERS = [
  { radius: 0.62, speed: 2.2, phase: 0, spread: 0.42 },
  { radius: 0.4, speed: -1.7, phase: 2.1, spread: 0.36 },
  { radius: 0.8, speed: 1.15, phase: 4, spread: 0.34 },
];

function envelope(t: number) {
  const slow = 0.5 + 0.5 * Math.sin(t * 0.62 + 0.4);
  const fast = 0.5 + 0.5 * Math.sin(t * 1.9 + 1.1);
  return 0.22 + 0.78 * (0.45 + 0.55 * slow) * fast;
}

function intensityOf(
  state: MatrixOrbState,
  d: number,
  nx: number,
  ny: number,
  t: number,
  amplitude: number,
) {
  if (state === "listening") {
    const ripple = 0.5 + 0.5 * Math.sin(d * 4.2 - t * 3);
    return 0.32 + amplitude * (0.34 + 0.38 * ripple);
  }
  if (state === "thinking") {
    let heat = 0;
    for (const o of ORBITERS) {
      const a = t * o.speed + o.phase;
      const dx = nx - Math.cos(a) * o.radius;
      const dy = ny - Math.sin(a) * o.radius;
      heat += Math.exp(-(dx * dx + dy * dy) / (o.spread * o.spread));
    }
    return (0.26 + 0.8 * Math.min(1, heat)) * (0.7 + amplitude * 0.5);
  }
  return 0.62 + 0.12 * Math.sin(t * 1.05 - d * 2.4);
}

function subscribeToZoom(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function MatrixOrb({
  state = "thinking",
  level,
  size = 48,
  color,
  dots = 9,
  style,
  ...props
}: MatrixOrbProps) {
  const reduceMotion = useAppConfig((config) => config.reduceMotion);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  const redrawRef = useRef<(() => void) | null>(null);
  const dpr = useSyncExternalStore(
    subscribeToZoom,
    () => Math.min(window.devicePixelRatio || 1, 4),
    () => 1,
  );

  useEffect(() => {
    stateRef.current = state;
    levelRef.current = level;
    redrawRef.current?.();
  }, [state, level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const buffer = Math.round(size * dpr);
    canvas.width = canvas.height = buffer;
    ctx.scale(buffer / size, buffer / size);

    const grid = Math.max(3, Math.round(dots));
    const half = (grid - 1) / 2;
    const spacing = (size * 0.74) / (grid - 1);
    const maxRadius = spacing * 0.6;
    const center = size / 2;
    const weights = { idle: 0, listening: 0, thinking: 0 };
    weights[stateRef.current] = 1;

    const levelAt = (t: number) => {
      const value = levelRef.current;
      return value === undefined || !Number.isFinite(value)
        ? envelope(t)
        : Math.min(1, Math.max(0, value));
    };

    const draw = (t: number, amplitude: number, scale: number) => {
      ctx.clearRect(0, 0, size, size);
      for (let iy = 0; iy < grid; iy++) {
        for (let ix = 0; ix < grid; ix++) {
          const nx = (ix - half) / half;
          const ny = (iy - half) / half;
          const d = Math.hypot(nx, ny);
          if (d > 1.12) continue;
          let blended = 0;
          for (const s of STATES) {
            if (weights[s] < 0.001) continue;
            blended += weights[s] * intensityOf(s, d, nx, ny, t, amplitude);
          }
          const intensity = Math.min(1, Math.max(0, blended));
          const radius = maxRadius * Math.exp(-d * d * 1.7) * intensity * scale;
          if (radius * dpr < 0.5) continue;
          ctx.beginPath();
          ctx.arc(
            center + (ix - half) * spacing * scale,
            center + (iy - half) * spacing * scale,
            radius,
            0,
            TAU,
          );
          ctx.fill();
        }
      }
    };

    let t = 0;
    let amplitude = 0;
    let scale = SCALE[stateRef.current];
    let velocity = 0;
    let last = performance.now();
    let raf = 0;

    const drawCurrent = () => {
      draw(t, amplitude, scale);
    };
    const updateColor = () => {
      ctx.fillStyle =
        color || getComputedStyle(canvas).getPropertyValue("--primary").trim();
      drawCurrent();
    };
    // Theme classes and automatic dark mode can change without remounting.
    const observer = new MutationObserver(updateColor);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    const darkMode = window.matchMedia("(prefers-color-scheme: dark)");
    darkMode.addEventListener("change", updateColor);
    redrawRef.current = drawCurrent;
    updateColor();

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt * (reduceMotion ? 0.6 : 1);
      const current = stateRef.current;
      const target = levelAt(t);
      const rate = target > amplitude ? 0.22 : 0.08;
      amplitude += (target - amplitude) * (1 - Math.pow(1 - rate, dt * 60));
      const step = 1 - Math.pow(1 - 0.16, dt * 60);
      for (const s of STATES) {
        weights[s] += ((s === current ? 1 : 0) - weights[s]) * step;
      }
      velocity += (-180 * (scale - SCALE[current]) - 26 * velocity) * dt;
      scale += velocity * dt;
      draw(t, amplitude, scale);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      darkMode.removeEventListener("change", updateColor);
      redrawRef.current = null;
    };
  }, [size, color, dots, dpr, reduceMotion]);

  return (
    <div
      role="status"
      aria-label={Locale.UI.Loading}
      data-slot="matrix-orb"
      data-state={state}
      style={{ width: size, height: size, color: "var(--primary)", ...style }}
      {...props}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ display: "block", width: size, height: size }}
      />
    </div>
  );
}
