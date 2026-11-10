import * as React from "react";

import styles from "./button.module.scss";
import { CSSProperties } from "react";
import clsx from "clsx";
import { LoaderCircle } from "lucide-react";

export type ButtonType = "primary" | "danger" | null;

export function IconButton(props: {
  onClick?: () => void;
  onPointerEnter?: React.PointerEventHandler<HTMLButtonElement>;
  onPointerDown?: React.PointerEventHandler<HTMLButtonElement>;
  onFocus?: React.FocusEventHandler<HTMLButtonElement>;
  icon?: JSX.Element;
  type?: ButtonType;
  text?: string;
  bordered?: boolean;
  shadow?: boolean;
  className?: string;
  title?: string;
  disabled?: boolean;
  busy?: boolean;
  busyText?: string;
  tabIndex?: number;
  autoFocus?: boolean;
  style?: CSSProperties;
  aria?: string;
}) {
  return (
    <button
      type="button"
      className={clsx(
        "clickable",
        styles["icon-button"],
        {
          [styles.border]: props.bordered,
          [styles.shadow]: props.shadow,
        },
        styles[props.type ?? ""],
        props.className,
      )}
      onClick={props.onClick}
      onPointerEnter={props.onPointerEnter}
      onPointerDown={props.onPointerDown}
      onFocus={props.onFocus}
      title={props.title}
      disabled={props.disabled || props.busy}
      role="button"
      tabIndex={props.tabIndex}
      autoFocus={props.autoFocus}
      style={props.style}
      aria-label={props.busy ? props.busyText || props.aria : props.aria}
      aria-busy={props.busy || undefined}
    >
      {(props.icon || props.busy) && (
        <div
          aria-hidden="true"
          className={clsx(styles["icon-button-icon"], {
            "no-dark": props.type === "primary",
          })}
        >
          {props.busy ? (
            <LoaderCircle size={16} className={styles["busy-icon"]} />
          ) : (
            props.icon
          )}
        </div>
      )}

      {props.text && (
        <div className={styles["icon-button-text"]} data-busy={!!props.busy}>
          <span>{props.text}</span>
          {props.busyText && <span>{props.busyText}</span>}
        </div>
      )}
    </button>
  );
}
