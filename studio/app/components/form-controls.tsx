import {
  ButtonHTMLAttributes,
  ComponentProps,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import clsx from "clsx";
import { IconButton } from "./button";
import styles from "./form-controls.module.scss";

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  type?: "text" | "number" | "password" | "search" | "email" | "url";
  fullWidth?: boolean;
};

export function TextField({
  className,
  fullWidth,
  type = "text",
  ...props
}: TextFieldProps) {
  return (
    <input
      {...props}
      type={type}
      className={clsx(styles.field, { [styles.full]: fullWidth }, className)}
    />
  );
}

export function TextAreaField({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(styles.multiline, className)} />;
}

export function Checkbox({
  className,
  variant,
  role,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  variant?: "checkbox" | "switch";
}) {
  const isSwitch = variant === "switch" || role === "switch";
  return (
    <input
      {...props}
      type="checkbox"
      role={role ?? (isSwitch ? "switch" : undefined)}
      className={clsx(
        styles.checkbox,
        { [styles.switch]: isSwitch },
        className,
      )}
    />
  );
}

export function FieldButton({
  className,
  constrained,
  ...props
}: ComponentProps<typeof IconButton> & { constrained?: boolean }) {
  return (
    <IconButton
      {...props}
      bordered
      className={clsx(
        styles.button,
        { [styles.constrained]: constrained },
        className,
      )}
    />
  );
}

export function ChoiceButton({
  selected,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return (
    <button
      {...props}
      type="button"
      aria-pressed={selected}
      className={clsx(styles.choice, className)}
    />
  );
}
