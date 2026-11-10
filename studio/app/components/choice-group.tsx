"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import { Check } from "lucide-react";
import styles from "./choice-group.module.scss";

export type ChoiceGroupOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  visual?: ReactNode;
};

export function ChoiceGroup({
  label,
  value,
  options,
  onChange,
  variant = "segmented",
  disabled = false,
  id,
  columns,
}: {
  label: string;
  value: string;
  options: ChoiceGroupOption[];
  onChange: (value: string) => void;
  variant?: "segmented" | "grid";
  disabled?: boolean;
  id?: string;
  columns?: number;
}) {
  const generatedId = useId();
  const groupId = id ?? `choice-${generatedId}`;
  const columnCount =
    columns !== undefined && Number.isFinite(columns)
      ? Math.max(1, Math.floor(columns))
      : variant === "grid"
      ? 3
      : Math.max(1, options.length);

  return (
    <fieldset
      id={groupId}
      role="radiogroup"
      aria-label={label}
      className={styles.group}
      data-variant={variant}
      disabled={disabled}
      style={{ "--choice-columns": columnCount } as CSSProperties}
    >
      <div className={styles.options}>
        {options.map((option, index) => (
          <label
            key={option.value}
            htmlFor={`${groupId}-${index}`}
            className={styles.choice}
          >
            <input
              id={`${groupId}-${index}`}
              className={styles.input}
              type="radio"
              name={`${groupId}-value`}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={(event) => {
                if (
                  !disabled &&
                  !option.disabled &&
                  event.currentTarget.checked
                )
                  onChange(option.value);
              }}
            />
            <span className={styles.option}>
              {variant === "grid" && (
                <Check size={12} className={styles.check} aria-hidden="true" />
              )}
              {option.visual && (
                <span className={styles.visual} aria-hidden="true">
                  {option.visual}
                </span>
              )}
              <span className={styles.label}>{option.label}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
