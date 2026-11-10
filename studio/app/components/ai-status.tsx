"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, Globe2, PencilLine, Sparkles } from "lucide-react";
import Locale from "../locales";
import styles from "./message-ui.module.scss";
import { MatrixOrb } from "./matrix-orb";

export function AiStatus({
  state = "thinking",
  label,
  timer = true,
}: {
  state?: "thinking" | "researching" | "writing" | "done" | "error";
  label?: string;
  timer?: boolean;
}) {
  const [seconds, setSeconds] = useState(0);
  const active = state !== "done" && state !== "error";
  useEffect(() => {
    if (!active || !timer) return;
    const start = Date.now();
    const interval = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => window.clearInterval(interval);
  }, [active, timer]);
  const Icon = {
    thinking: Sparkles,
    researching: Globe2,
    writing: PencilLine,
    done: Check,
    error: AlertCircle,
  }[state];
  return (
    <span
      className={styles.status}
      data-state={state}
      data-active={active}
      role="status"
    >
      <span className={styles["status-symbol"]} key={state}>
        {state === "thinking" ? (
          <MatrixOrb size={32} aria-hidden="true" />
        ) : (
          <Icon
            size={18}
            aria-hidden="true"
            className={styles["status-icon"]}
          />
        )}
      </span>
      <span className={styles["status-label"]}>
        <span key={state}>{label ?? Locale.Chat.Activity[state]}</span>
      </span>
      {timer && active && (
        <span
          className={styles.elapsed}
          aria-hidden="true"
          style={{ minInlineSize: "7ch", textAlign: "center" }}
        >
          {seconds < 60
            ? `${seconds}s`
            : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}
        </span>
      )}
    </span>
  );
}
