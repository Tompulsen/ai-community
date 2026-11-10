"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "./toast.module.scss";

interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "warning" | "info";
  duration: number;
}

let toastId = 0;
let addToastFn:
  | ((message: string, type?: ToastItem["type"], duration?: number) => void)
  | null = null;

export function showToast(
  message: string,
  type: ToastItem["type"] = "info",
  duration = 3000,
) {
  addToastFn?.(message, type, duration);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback(
    (message: string, type: ToastItem["type"] = "info", duration = 3000) => {
      const id = ++toastId;
      setToasts((prev) => [...prev, { id, message, type, duration }]);
    },
    [],
  );

  useEffect(() => {
    addToastFn = addToast;
    return () => {
      addToastFn = null;
    };
  }, [addToast]);

  useEffect(() => {
    if (toasts.length === 0) return;

    const timer = setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, toasts[0].duration);

    return () => clearTimeout(timer);
  }, [toasts]);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className={styles["toast-container"]}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles["toast"]} ${styles[`toast-${toast.type}`]}`}
          onClick={() => removeToast(toast.id)}
        >
          <span className={styles["toast-icon"]}>
            {toast.type === "success" && "✓"}
            {toast.type === "error" && "✕"}
            {toast.type === "warning" && "⚠"}
            {toast.type === "info" && "ℹ"}
          </span>
          <span className={styles["toast-message"]}>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
