"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { RotateCw, X } from "lucide-react";
import { createImeGuard } from "../utils/ime-input";
import styles from "./message-editor.module.scss";

export function MessageEditor({
  initialValue,
  disabled = false,
  allowEmpty = false,
  onCancel,
  onSave,
}: {
  initialValue: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  onCancel: () => void;
  onSave: (text: string) => Promise<boolean | void>;
}) {
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const ime = useRef(createImeGuard());
  const errorId = useId();

  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.setSelectionRange(initialValue.length, initialValue.length);
    input.current?.form?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }, [initialValue]);

  return (
    <form
      className={styles.editor}
      aria-label="编辑消息"
      aria-busy={pending}
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current || disabled || (!allowEmpty && !value.trim()))
          return;
        submitting.current = true;
        setPending(true);
        setError("");
        try {
          if ((await onSave(value)) === false)
            setError("当前无法保存，请确认会话空闲后重试。");
        } catch (failure) {
          setError(
            failure instanceof Error ? failure.message : "保存失败，请重试。",
          );
        } finally {
          submitting.current = false;
          setPending(false);
        }
      }}
    >
      <textarea
        ref={input}
        className={styles.input}
        aria-label="消息内容"
        value={value}
        rows={4}
        disabled={disabled || pending}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setValue(event.currentTarget.value);
          setError("");
        }}
        onCompositionStart={() => ime.current.start()}
        onCompositionEnd={() => ime.current.end()}
        onKeyUp={(event) => ime.current.release(event.nativeEvent)}
        onKeyDown={(event) => {
          if (ime.current.blocks(event.nativeEvent)) {
            if (
              event.key === "Enter" &&
              !ime.current.isComposing(event.nativeEvent)
            )
              event.preventDefault();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!submitting.current) onCancel();
          } else if (
            event.key === "Enter" &&
            (event.ctrlKey || event.metaKey) &&
            !event.altKey
          ) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          aria-label="取消"
        >
          <X size={16} aria-hidden="true" />
          取消
        </button>
        <button
          type="submit"
          className={styles.save}
          disabled={disabled || pending || (!allowEmpty && !value.trim())}
          aria-label="保存并重新生成"
        >
          <RotateCw size={16} aria-hidden="true" />
          {pending ? "正在保存" : "保存并重新生成"}
        </button>
      </div>
    </form>
  );
}
