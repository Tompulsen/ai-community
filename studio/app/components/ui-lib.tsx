/* eslint-disable @next/next/no-img-element */
import styles from "./ui-lib.module.scss";
import LoadingIcon from "../icons/three-dots.svg";
import CloseIcon from "../icons/close.svg";
import EyeIcon from "../icons/eye.svg";
import EyeOffIcon from "../icons/eye-off.svg";
import ConfirmIcon from "../icons/confirm.svg";
import CancelIcon from "../icons/cancel.svg";
import MaxIcon from "../icons/max.svg";
import MinIcon from "../icons/min.svg";

import Locale from "../locales";

import { createRoot } from "react-dom/client";
import React, {
  CSSProperties,
  HTMLProps,
  MouseEvent,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { IconButton } from "./button";
import { Avatar } from "./emoji";
import { ChoiceSelect } from "./choice-select";
import clsx from "clsx";
import { prefersReducedMotion } from "../utils/motion";

function watchReducedMotion(finish: () => void) {
  const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const update = () => {
    if (prefersReducedMotion()) finish();
  };
  const observer = new MutationObserver(update);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "data-motion"],
  });
  media?.addEventListener?.("change", update);
  return () => {
    observer.disconnect();
    media?.removeEventListener?.("change", update);
  };
}

export function Popover(props: {
  children: JSX.Element;
  content: JSX.Element;
  open?: boolean;
  onClose?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const motion = useRef<Animation>();
  const [present, setPresent] = useState(!!props.open);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.toggleAttribute("inert", !props.open);
    if (!props.open && panel.contains(document.activeElement))
      (document.activeElement as HTMLElement).blur();
    const previous = motion.current;
    const visible = getComputedStyle(panel);
    const from = { opacity: visible.opacity, transform: visible.transform };
    previous?.cancel();
    motion.current = undefined;
    if (props.open) {
      setPresent(true);
      if (!previous) return;
    }
    if (prefersReducedMotion() || !panel.animate) {
      setPresent(!!props.open);
      panel.style.opacity = props.open ? "1" : "0";
      panel.style.transform = "none";
      return;
    }
    const to = {
      opacity: props.open ? "1" : "0",
      transform: props.open ? "none" : "translateY(4px) scale(0.98)",
    };
    Object.assign(panel.style, to, { animation: "none" });
    const animation = panel.animate([from, to], {
      duration: props.open ? 180 : 140,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    });
    motion.current = animation;
    const finish = () => {
      if (motion.current !== animation) return;
      motion.current = undefined;
      animation.cancel();
      if (!props.open) setPresent(false);
    };
    animation.onfinish = finish;
    return watchReducedMotion(finish);
  }, [props.open]);
  useLayoutEffect(() => () => motion.current?.cancel(), []);

  return (
    <div className={styles.popover}>
      {props.children}
      {props.open && (
        <div className={styles["popover-mask"]} onClick={props.onClose}></div>
      )}
      {(props.open || present) && (
        <div
          ref={panelRef}
          aria-hidden={!props.open || undefined}
          className={styles["popover-content"]}
        >
          {props.content}
        </div>
      )}
    </div>
  );
}

export function Card(props: { children: JSX.Element[]; className?: string }) {
  return (
    <div className={clsx(styles.card, props.className)}>{props.children}</div>
  );
}

export function ListItem(props: {
  title?: string;
  subTitle?: string | JSX.Element;
  children?: JSX.Element | JSX.Element[];
  icon?: JSX.Element;
  className?: string;
  onClick?: (e: MouseEvent) => void;
  vertical?: boolean;
}) {
  return (
    <div
      className={clsx(
        styles["list-item"],
        {
          [styles["vertical"]]: props.vertical,
        },
        props.className,
      )}
      onClick={props.onClick}
    >
      <div className={styles["list-header"]}>
        {props.icon && <div className={styles["list-icon"]}>{props.icon}</div>}
        <div className={styles["list-item-title"]}>
          <div>{props.title}</div>
          {props.subTitle && (
            <div className={styles["list-item-sub-title"]}>
              {props.subTitle}
            </div>
          )}
        </div>
      </div>
      {props.children}
    </div>
  );
}

export function List(props: { children: React.ReactNode; id?: string }) {
  return (
    <div className={styles.list} id={props.id}>
      {props.children}
    </div>
  );
}

export function Loading() {
  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <LoadingIcon />
    </div>
  );
}

interface ModalProps {
  title: string;
  children?: any;
  actions?: React.ReactNode[];
  defaultMax?: boolean;
  compact?: boolean;
  allowMaximize?: boolean;
  footer?: React.ReactNode;
  onClose?: () => void;
}

function afterModalExit(mask: HTMLElement | null, onClose: () => void) {
  if (!mask || prefersReducedMotion()) {
    onClose();
    return () => {};
  }

  let finished = false;
  const cleanup = () => {
    clearTimeout(timeout);
    mask.removeEventListener("animationend", onAnimationEnd);
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
    onClose();
  };
  const onAnimationEnd = (event: AnimationEvent) => {
    if (event.target === mask) finish();
  };
  mask.addEventListener("animationend", onAnimationEnd);
  mask.classList.add("modal-closing");
  const timeout = setTimeout(finish, 180);

  return () => {
    finished = true;
    cleanup();
  };
}

export function useModalClose(onClose: () => void) {
  const maskRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pendingRef = useRef(false);
  const cleanupRef = useRef<(() => void) | undefined>();

  useEffect(() => () => cleanupRef.current?.(), []);

  const requestClose = useCallback((onConfirm?: () => void) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    cleanupRef.current = afterModalExit(maskRef.current, () => {
      try {
        onConfirm?.();
      } finally {
        onCloseRef.current();
      }
    });
  }, []);

  const onBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) requestClose();
    },
    [requestClose],
  );

  return { maskRef, requestClose, onBackdropClick };
}

export function Modal(props: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  // Capture before React commits any descendant autoFocus.
  const openerRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    const opener = openerRef.current;
    const getTopModal = () => {
      const modals = document.querySelectorAll<HTMLElement>(
        "[data-modal-dialog]",
      );
      return modals[modals.length - 1];
    };
    const isTopModal = () =>
      !document.querySelector("dialog[open]") && getTopModal() === modal;

    if (isTopModal() && !modal.contains(document.activeElement)) {
      modal.focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key !== "Escape" && e.key !== "Tab") ||
        e.defaultPrevented ||
        e.isComposing ||
        !isTopModal()
      ) {
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }

      const controls = Array.from(
        modal.querySelectorAll<HTMLElement>(
          "button, a[href], input, select, textarea, [tabindex], [contenteditable]",
        ),
      ).filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.matches(":disabled") &&
          !element.closest("[hidden], [inert], [aria-hidden='true']") &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== "hidden",
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (
        !controls.includes(document.activeElement as HTMLElement) ||
        (e.shiftKey && document.activeElement === first) ||
        (!e.shiftKey && document.activeElement === last)
      ) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus({ preventScroll: true });
        if (!first) modal.focus({ preventScroll: true });
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      queueMicrotask(() => {
        if (
          modal.isConnected ||
          document.querySelector("dialog[open]") ||
          (document.activeElement !== document.body &&
            document.activeElement !== document.documentElement)
        ) {
          return;
        }
        const topModal = getTopModal();
        if (topModal) {
          (opener?.isConnected && topModal.contains(opener)
            ? opener
            : topModal
          ).focus({ preventScroll: true });
        } else if (opener?.isConnected) {
          opener.focus({ preventScroll: true });
        }
      });
    };
  }, []);

  const [isMax, setMax] = useState(!!props.defaultMax);
  const allowMaximize = props.allowMaximize ?? !props.compact;
  const maximized = allowMaximize && isMax;
  const resizeFrom = useRef<{ width: string; height: string }>();
  const toggleMaximize = () => {
    if (modalRef.current) {
      const visible = getComputedStyle(modalRef.current);
      resizeFrom.current = { width: visible.width, height: visible.height };
    }
    setMax((value) => !value);
  };
  useLayoutEffect(() => {
    const modal = modalRef.current;
    const from = resizeFrom.current;
    resizeFrom.current = undefined;
    if (!modal || !from || !modal.animate || prefersReducedMotion()) return;
    const target = getComputedStyle(modal);
    const to = { width: target.width, height: target.height };
    modal.dataset.modalResizing = "true";
    const animation = modal.animate([from, to], {
      duration: 220,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    });
    const finish = () => {
      animation.cancel();
      delete modal.dataset.modalResizing;
    };
    animation.onfinish = finish;
    const stopWatching = watchReducedMotion(finish);
    return () => {
      stopWatching();
      finish();
    };
  }, [maximized]);
  const actions = React.Children.toArray(props.actions);
  const hasFooter =
    React.Children.toArray(props.footer).length > 0 || actions.length > 0;

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      data-modal-dialog
      tabIndex={-1}
      className={clsx(styles["modal-container"], {
        [styles["modal-container-max"]]: maximized,
        [styles["modal-container-compact"]]: props.compact && !maximized,
      })}
    >
      <div className={styles["modal-header"]}>
        <div className={styles["modal-title"]}>{props.title}</div>

        <div className={styles["modal-header-actions"]}>
          {allowMaximize && (
            <button
              type="button"
              className={styles["modal-header-action"]}
              aria-label={
                maximized
                  ? Locale.Chat.Actions.ExitFullScreen
                  : Locale.Chat.Actions.FullScreen
              }
              title={
                maximized
                  ? Locale.Chat.Actions.ExitFullScreen
                  : Locale.Chat.Actions.FullScreen
              }
              aria-pressed={maximized}
              onClick={toggleMaximize}
            >
              {maximized ? <MinIcon /> : <MaxIcon />}
            </button>
          )}
          <button
            type="button"
            className={styles["modal-header-action"]}
            aria-label={Locale.UI.Close}
            title={Locale.UI.Close}
            onClick={props.onClose}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className={styles["modal-content"]}>{props.children}</div>

      {hasFooter && (
        <div className={styles["modal-footer"]}>
          {props.footer}
          {actions.length > 0 && (
            <div className={styles["modal-actions"]}>
              {actions.map((action, i) => (
                <div key={i} className={styles["modal-action"]}>
                  {action}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function showModal(props: ModalProps, closeOnBackdrop = true) {
  const div = document.createElement("div");
  div.className = "modal-mask";
  document.body.appendChild(div);

  const root = createRoot(div);
  let closed = false;
  const closeModal = (onConfirm?: () => void) => {
    if (closed) return;
    closed = true;
    afterModalExit(div, () => {
      try {
        onConfirm?.();
      } finally {
        try {
          props.onClose?.();
        } finally {
          root.unmount();
          div.remove();
        }
      }
    });
  };

  div.onclick = (e) => {
    if (closeOnBackdrop && e.target === div) {
      closeModal();
    }
  };

  root.render(<Modal {...props} onClose={() => closeModal()}></Modal>);
  return closeModal;
}

export type ToastProps = {
  content: string;
  placement?: "top" | "bottom";
  action?: {
    text: string;
    onClick: () => void;
  };
  onClose?: () => void;
};

export function Toast(props: ToastProps) {
  return (
    <div
      className={styles["toast-container"]}
      data-placement={props.placement}
      role="status"
      aria-atomic="true"
    >
      <div className={styles["toast-content"]}>
        <span>{props.content}</span>
        {props.action && (
          <button
            onClick={() => {
              props.action?.onClick?.();
              props.onClose?.();
            }}
            className={styles["toast-action"]}
          >
            {props.action.text}
          </button>
        )}
      </div>
    </div>
  );
}

export function showToast(
  content: string,
  action?: ToastProps["action"],
  delay = 3000,
) {
  const div = document.createElement("div");
  div.className = styles.show;
  document.body.appendChild(div);

  const root = createRoot(div);
  const close = () => {
    div.classList.add(styles.hide);

    setTimeout(() => {
      root.unmount();
      div.remove();
    }, 300);
  };

  setTimeout(() => {
    close();
  }, delay);

  root.render(<Toast content={content} action={action} onClose={close} />);
}

export type InputProps = React.HTMLProps<HTMLTextAreaElement> & {
  autoHeight?: boolean;
  rows?: number;
};

export function Input(props: InputProps) {
  return (
    <textarea
      {...props}
      className={clsx(styles["input"], props.className)}
    ></textarea>
  );
}

export function PasswordInput(
  props: HTMLProps<HTMLInputElement> & { aria?: string },
) {
  const [visible, setVisible] = useState(false);
  function changeVisibility() {
    setVisible(!visible);
  }

  return (
    <div className={"password-input-container"}>
      <IconButton
        aria={props.aria}
        icon={visible ? <EyeIcon /> : <EyeOffIcon />}
        onClick={changeVisibility}
        className={"password-eye"}
      />
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={"password-input"}
      />
    </div>
  );
}

export const Select = ChoiceSelect;

export function showConfirm(content: any) {
  return new Promise<boolean>((resolve) => {
    let result = false;
    const closeModal = showModal(
      {
        title: Locale.UI.Confirm,
        actions: [
          <IconButton
            key="cancel"
            text={Locale.UI.Cancel}
            onClick={() => closeModal()}
            icon={<CancelIcon />}
            tabIndex={0}
            bordered
            shadow
          ></IconButton>,
          <IconButton
            key="confirm"
            text={Locale.UI.Confirm}
            type="primary"
            onClick={() => closeModal(() => (result = true))}
            icon={<ConfirmIcon />}
            tabIndex={0}
            autoFocus
            bordered
            shadow
          ></IconButton>,
        ],
        onClose: () => resolve(result),
        children: content,
      },
      false,
    );
  });
}

function PromptInput(props: {
  value: string;
  label?: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  const [input, setInput] = useState(props.value);
  const onInput = (value: string) => {
    props.onChange(value);
    setInput(value);
  };

  return (
    <textarea
      className={styles["modal-input"]}
      aria-label={props.label}
      autoFocus
      value={input}
      onInput={(e) => onInput(e.currentTarget.value)}
      rows={props.rows ?? 3}
    ></textarea>
  );
}

export function showPrompt(content: any, value = "", rows = 3) {
  return new Promise<string | null>((resolve) => {
    let userInput = value;
    let result: string | null = null;
    const closeModal = showModal(
      {
        title: content,
        actions: [
          <IconButton
            key="cancel"
            text={Locale.UI.Cancel}
            onClick={() => closeModal()}
            icon={<CancelIcon />}
            bordered
            shadow
            tabIndex={0}
          ></IconButton>,
          <IconButton
            key="confirm"
            text={Locale.UI.Confirm}
            type="primary"
            onClick={() => {
              const confirmedInput = userInput;
              closeModal(() => (result = confirmedInput));
            }}
            icon={<ConfirmIcon />}
            bordered
            shadow
            tabIndex={0}
          ></IconButton>,
        ],
        onClose: () => resolve(result),
        children: (
          <PromptInput
            onChange={(val) => (userInput = val)}
            value={value}
            label={typeof content === "string" ? content : undefined}
            rows={rows}
          ></PromptInput>
        ),
      },
      false,
    );
  });
}

export function showImageModal(
  img: string,
  defaultMax?: boolean,
  style?: CSSProperties,
  boxStyle?: CSSProperties,
  onClose?: () => void,
) {
  showModal({
    title: Locale.Export.Image.Modal,
    defaultMax: defaultMax,
    onClose,
    children: (
      <div style={{ display: "flex", justifyContent: "center", ...boxStyle }}>
        <img
          src={img}
          alt="preview"
          style={
            style ?? {
              maxWidth: "100%",
            }
          }
        ></img>
      </div>
    ),
  });
}

export function Selector<T>(props: {
  className?: string;
  mobilePlacement?: "center" | "bottom";
  items: Array<{
    title: string;
    subTitle?: string;
    value: T;
    disable?: boolean;
  }>;
  defaultSelectedValue?: T[] | T;
  onSelection?: (selection: T[]) => void;
  onClose?: () => void;
  multiple?: boolean;
}) {
  const [selectedValues, setSelectedValues] = useState<T[]>(
    Array.isArray(props.defaultSelectedValue)
      ? props.defaultSelectedValue
      : props.defaultSelectedValue !== undefined
      ? [props.defaultSelectedValue]
      : [],
  );

  const handleSelection = (e: MouseEvent, value: T) => {
    if (props.multiple) {
      e.stopPropagation();
      const newSelectedValues = selectedValues.includes(value)
        ? selectedValues.filter((v) => v !== value)
        : [...selectedValues, value];
      setSelectedValues(newSelectedValues);
      props.onSelection?.(newSelectedValues);
    } else {
      setSelectedValues([value]);
      props.onSelection?.([value]);
      props.onClose?.();
    }
  };

  return (
    <div
      className={clsx(styles["selector"], props.className, {
        [styles["selector-centered"]]: props.mobilePlacement === "center",
      })}
      onClick={() => props.onClose?.()}
    >
      <div className={styles["selector-content"]}>
        <List>
          {props.items.map((item, i) => {
            const selected = selectedValues.includes(item.value);
            return (
              <ListItem
                className={clsx(styles["selector-item"], {
                  [styles["selector-item-disabled"]]: item.disable,
                })}
                key={i}
                title={item.title}
                subTitle={item.subTitle}
                icon={<Avatar model={item.value as string} />}
                onClick={(e) => {
                  if (item.disable) {
                    e.stopPropagation();
                  } else {
                    handleSelection(e, item.value);
                  }
                }}
              >
                <span
                  className={styles["selector-selection-indicator"]}
                  data-selected={selected}
                  aria-hidden="true"
                />
              </ListItem>
            );
          })}
        </List>
      </div>
    </div>
  );
}
export function FullScreen({
  children,
  actions,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { actions?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      ref.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);
  useEffect(() => {
    const handleScreenChange = (e: any) => {
      if (e.target === ref.current) {
        setFullScreen(!!document.fullscreenElement);
      }
    };
    document.addEventListener("fullscreenchange", handleScreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleScreenChange);
    };
  }, []);
  return (
    <div ref={ref} className={clsx(styles["preview"], className)} {...rest}>
      <div className={styles["preview-toolbar"]}>
        <span className={styles["preview-label"]}>
          {Locale.Export.Steps.Preview}
        </span>
        <div className={styles["preview-actions"]}>
          {actions}
          <IconButton
            icon={fullScreen ? <MinIcon /> : <MaxIcon />}
            title={
              fullScreen
                ? Locale.Chat.Actions.ExitFullScreen
                : Locale.Chat.Actions.FullScreen
            }
            aria={
              fullScreen
                ? Locale.Chat.Actions.ExitFullScreen
                : Locale.Chat.Actions.FullScreen
            }
            onClick={toggleFullscreen}
          />
        </div>
      </div>
      {children}
    </div>
  );
}
