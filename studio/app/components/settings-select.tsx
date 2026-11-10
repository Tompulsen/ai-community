import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import { ChoiceButton } from "./form-controls";
import { ChoiceGroup } from "./choice-group";
import { Modal, Select, useModalClose } from "./ui-lib";
import styles from "./settings-select.module.scss";

type SettingsSelectProps = {
  title: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  presentation?: "auto" | "segmented" | "select" | "dialog";
  description?: string;
  renderOptions?: () => ReactNode;
  renderTrigger?: (props: {
    onClick: () => void;
    expanded: boolean;
    controls: string;
    disabled: boolean;
  }) => ReactNode;
};

function SettingsSelectDialog(
  props: SettingsSelectProps & { dialogId: string; onClose: () => void },
) {
  const dialog = useRef<HTMLDivElement>(null);
  const { maskRef, requestClose } = useModalClose(props.onClose);
  const compact = !!props.renderOptions || props.options.length <= 6;

  useEffect(() => {
    dialog.current
      ?.querySelector<HTMLElement>("[aria-pressed=true], input[type=range]")
      ?.focus({ preventScroll: true });
  }, []);

  return createPortal(
    <div
      ref={maskRef}
      className={clsx("modal-mask", styles.mask)}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialog}
        id={props.dialogId}
        className={clsx(styles.dialog, {
          [styles.compact]: compact,
        })}
      >
        <Modal
          title={props.title}
          compact={compact}
          allowMaximize={!compact}
          onClose={() => requestClose()}
        >
          {props.renderOptions?.()}
          {props.description && (
            <p className={styles.description}>{props.description}</p>
          )}
          {!props.renderOptions && (
            <div className={styles.options}>
              {props.options.map((option) => (
                <ChoiceButton
                  key={option.value}
                  selected={option.value === props.value}
                  onClick={() =>
                    requestClose(() => props.onChange(option.value))
                  }
                >
                  {option.label}
                </ChoiceButton>
              ))}
            </div>
          )}
        </Modal>
      </div>
    </div>,
    document.body,
  );
}

export function SettingsSelect(props: SettingsSelectProps) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const useDialog =
    props.presentation === "dialog" ||
    !!props.renderOptions ||
    !!props.renderTrigger;
  const useSegments =
    !useDialog &&
    (props.presentation === "segmented" ||
      ((!props.presentation || props.presentation === "auto") &&
        props.options.length >= 2 &&
        props.options.length <= 3 &&
        props.options.every(
          (option) => Array.from(option.label).length <= 12,
        )));
  const visible = useDialog && open && !props.disabled;
  const selectedLabel = props.options.find(
    (option) => option.value === props.value,
  )?.label;

  if (useSegments) {
    return (
      <div className={clsx(styles.group, props.className)}>
        <ChoiceGroup
          id={props.id}
          label={props.title}
          value={props.value}
          options={props.options}
          disabled={props.disabled}
          onChange={props.onChange}
        />
      </div>
    );
  }

  if (!useDialog) {
    return (
      <Select
        id={props.id}
        className={clsx(styles.native, props.className)}
        aria-label={props.title}
        title={selectedLabel}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <>
      {props.renderTrigger ? (
        props.renderTrigger({
          onClick: () => setOpen(true),
          expanded: visible,
          controls: dialogId,
          disabled: !!props.disabled,
        })
      ) : (
        <button
          type="button"
          id={props.id}
          className={clsx(styles.trigger, props.className)}
          aria-label={props.title}
          title={selectedLabel}
          aria-haspopup="dialog"
          aria-expanded={visible}
          aria-controls={dialogId}
          disabled={props.disabled}
          onClick={() => setOpen(true)}
        >
          <span>{selectedLabel}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      )}
      {visible && (
        <SettingsSelectDialog
          {...props}
          dialogId={dialogId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
