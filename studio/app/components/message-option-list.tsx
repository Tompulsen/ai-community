"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, LoaderCircle, Send, X } from "lucide-react";
import type {
  MessageInteractionOption,
  MessageInteractionOptions,
  MessageInteractionReceipt,
} from "../utils/message-interactions";
import styles from "./message-option-list.module.scss";

type MessageOptionListProps = {
  definition: MessageInteractionOptions;
  selectedIds?: readonly string[];
  receipt?: MessageInteractionReceipt;
  disabled?: boolean;
  onSubmit: (selectedIds: string[]) => Promise<boolean>;
};

function normalizeSelection(
  options: readonly MessageInteractionOption[],
  ids: readonly string[] | undefined,
  max: number,
) {
  const selected = new Set(ids);
  return options
    .filter((option) => selected.has(option.id))
    .slice(0, max)
    .map((option) => option.id);
}

export function MessageOptionList(props: MessageOptionListProps) {
  if (!props.definition.options.length) return null;
  return <OptionList key={props.definition.id} {...props} />;
}

function OptionList({
  definition,
  selectedIds,
  receipt,
  disabled = false,
  onSubmit,
}: MessageOptionListProps) {
  const options = definition.options.slice(0, 8);
  const single = definition.selection === "single";
  const max = single
    ? 1
    : Math.max(
        0,
        Math.min(
          options.length,
          Math.floor(definition.maxSelections ?? options.length),
        ),
      );
  const min = Math.max(
    0,
    Math.min(max, Math.floor(definition.minSelections ?? 1)),
  );
  const seed = normalizeSelection(options, selectedIds, max);
  const seedKey = JSON.stringify([
    definition.selection,
    options.map((option) => option.id),
    min,
    max,
    seed,
  ]);
  const seedRef = useRef(seed);
  seedRef.current = seed;
  const [selected, setSelected] = useState(seed);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [localReceipt, setLocalReceipt] = useState<MessageInteractionReceipt>();
  const mounted = useRef(true);
  const request = useRef<object>();
  const id = useId();
  const questionId = `${id}-question`;
  const limitsId = `${id}-limits`;
  const errorId = `${id}-error`;
  useEffect(() => {
    setSelected(seedRef.current);
    setLocalReceipt(undefined);
    setFailed(false);
  }, [seedKey]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current = undefined;
    };
  }, []);

  const activeReceipt = receipt ?? localReceipt;
  const currentSelection = normalizeSelection(options, selected, max);
  const selectedOptions = options.filter(
    (option) => activeReceipt?.selectedIds.includes(option.id),
  );
  const locked = disabled || pending || !!activeReceipt;
  const valid =
    currentSelection.length >= min && currentSelection.length <= max;
  const description = single
    ? min === 0
      ? "单选，可不选"
      : "单选"
    : min === max
    ? `多选，共 ${max} 项`
    : `多选，${min} 到 ${max} 项`;

  const submit = async () => {
    if (locked || request.current || !valid) return;
    const submitted = currentSelection.slice();
    const currentRequest = {};
    request.current = currentRequest;
    setPending(true);
    setFailed(false);
    try {
      const success = await onSubmit(submitted);
      if (success && mounted.current && request.current === currentRequest) {
        setLocalReceipt({ selectedIds: submitted });
      }
    } catch {
      if (mounted.current && request.current === currentRequest) {
        setFailed(true);
      }
    } finally {
      if (mounted.current && request.current === currentRequest) {
        request.current = undefined;
        setPending(false);
      }
    }
  };

  return (
    <div className={styles.interaction} data-testid="message-option-list">
      {activeReceipt ? (
        <fieldset className={styles.group}>
          <legend id={questionId} className={styles.question}>
            {definition.question}
          </legend>
          <div className={styles.receiptHeading} role="status">
            <Check size={16} aria-hidden="true" />
            已提交选择
          </div>
          {selectedOptions.length ? (
            <ul className={styles.receipt}>
              {selectedOptions.map((option) => (
                <li key={option.id}>
                  <Check size={16} aria-hidden="true" />
                  <div className={styles.copy}>
                    <span className={styles.label}>{option.label}</span>
                    {option.description && (
                      <span className={styles.description}>
                        {option.description}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.description}>未选择任何选项</div>
          )}
        </fieldset>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset
            className={styles.group}
            role={single ? "radiogroup" : undefined}
            disabled={locked}
            aria-describedby={failed ? `${limitsId} ${errorId}` : limitsId}
            aria-busy={pending}
          >
            <legend id={questionId} className={styles.question}>
              {definition.question}
            </legend>
            <p id={limitsId} className={styles.limits}>
              {description}
            </p>
            <div className={styles.options}>
              {options.map((option, index) => {
                const checked = currentSelection.includes(option.id);
                const atLimit = !single && !checked && selected.length >= max;
                const labelId = `${id}-label-${index}`;
                const descriptionId = `${id}-description-${index}`;
                return (
                  <label
                    key={option.id}
                    className={styles.option}
                    data-selected={checked}
                    data-disabled={locked || atLimit}
                  >
                    <input
                      className={styles.input}
                      type={single ? "radio" : "checkbox"}
                      name={`${id}-selection`}
                      value={option.id}
                      checked={checked}
                      disabled={locked || atLimit}
                      aria-labelledby={labelId}
                      aria-describedby={
                        option.description ? descriptionId : undefined
                      }
                      onChange={(event) => {
                        if (locked || atLimit) return;
                        const checked = event.currentTarget.checked;
                        setSelected((previous) =>
                          single
                            ? [option.id]
                            : checked
                            ? [...previous, option.id]
                            : previous.filter((value) => value !== option.id),
                        );
                        setFailed(false);
                      }}
                    />
                    <span className={styles.copy}>
                      <span id={labelId} className={styles.label}>
                        {option.label}
                      </span>
                      {option.description && (
                        <span id={descriptionId} className={styles.description}>
                          {option.description}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {failed && (
            <div id={errorId} className={styles.error} role="alert">
              选择暂未提交，请重试。
            </div>
          )}
          <div className={styles.actions}>
            {min === 0 && currentSelection.length > 0 && (
              <button
                type="button"
                className={styles.clear}
                disabled={locked}
                onClick={() => {
                  if (locked) return;
                  setSelected([]);
                  setFailed(false);
                }}
              >
                <X size={16} aria-hidden="true" />
                清除选择
              </button>
            )}
            <button
              type="submit"
              className={styles.submit}
              disabled={locked || !valid}
            >
              {pending ? (
                <LoaderCircle
                  size={16}
                  className={styles.spinner}
                  aria-hidden="true"
                />
              ) : (
                <Send size={16} aria-hidden="true" />
              )}
              {pending ? "提交中" : "提交选择"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
