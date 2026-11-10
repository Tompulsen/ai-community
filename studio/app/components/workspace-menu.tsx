"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import type {
  ChatShortcutAction,
  getChatShortcuts,
} from "../utils/chat-shortcuts";
import { useAnchoredPanel } from "../utils/use-anchored-panel";
import styles from "./workspace-navigation.module.scss";

export type WorkspaceMenuItem = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  onIntent?: (activation: boolean) => void;
  disabled?: boolean;
  destructive?: boolean;
};

const WORKSPACE_MENU_WIDTH = 216;

function focusableItems(panel: HTMLElement) {
  return Array.from(
    panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
  ).filter(
    (button) =>
      !button.closest("[hidden],[inert]") &&
      button.getClientRects().length > 0 &&
      getComputedStyle(button).visibility !== "hidden",
  );
}

export function focusMenuEdge(id: string, edge: "first" | "last") {
  const panel = document.getElementById(id);
  const controls = panel ? focusableItems(panel) : [];
  ((edge === "last" ? controls.at(-1) : controls[0]) ?? panel)?.focus();
}

export function WorkspaceMenu({
  id,
  label,
  open,
  items,
  trigger,
  keyboard,
  onClose,
  onSwitch,
  shortcuts,
  onEdit,
  onEditIntent,
  editDisabled,
  align = "start",
}: {
  id: string;
  label: string;
  open: boolean;
  items: WorkspaceMenuItem[];
  trigger: RefObject<HTMLButtonElement>;
  keyboard: RefObject<"first" | "last" | null>;
  onClose: (restoreFocus?: boolean) => void;
  onSwitch?: (direction: -1 | 1) => void;
  shortcuts?: ReturnType<typeof getChatShortcuts>;
  onEdit?: (action: ChatShortcutAction) => void;
  onEditIntent?: (action: ChatShortcutAction, activation: boolean) => void;
  editDisabled?: (action: ChatShortcutAction) => boolean;
  align?: "start" | "center" | "end";
}) {
  const [present, setPresent] = useState(open);
  const panel = useRef<HTMLDivElement>(null);
  const shortcutLayout = shortcuts !== undefined;
  const position = useAnchoredPanel(
    open,
    trigger,
    panel,
    WORKSPACE_MENU_WIDTH,
    { align, placement: "below", gap: 4, maxHeight: 480 },
  );
  const callbacks = useRef({ onClose, onSwitch });
  callbacks.current = { onClose, onSwitch };

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    if (!present) return;
    const timeout = window.setTimeout(() => setPresent(false), 220);
    return () => window.clearTimeout(timeout);
  }, [open, present]);

  useLayoutEffect(() => {
    if (!open || position.visibility !== "visible" || !panel.current) return;
    if (keyboard.current) {
      const controls = focusableItems(panel.current);
      (
        (keyboard.current === "last" ? controls.at(-1) : controls[0]) ??
        panel.current
      )?.focus({ preventScroll: true });
    }
  }, [open, position.visibility, keyboard]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent | FocusEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        callbacks.current.onClose();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        callbacks.current.onClose(true);
        return;
      }
      if (!panel.current?.contains(document.activeElement)) return;
      if (event.key === "Tab") {
        callbacks.current.onClose(true);
      } else if (["ArrowLeft", "ArrowRight"].includes(event.key) && onSwitch) {
        event.preventDefault();
        callbacks.current.onSwitch?.(event.key === "ArrowLeft" ? -1 : 1);
      } else if (
        ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) &&
        panel.current
      ) {
        event.preventDefault();
        const controls = focusableItems(panel.current);
        const current = controls.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
            ? controls.length - 1
            : (current +
                (event.key === "ArrowDown" ? 1 : -1) +
                controls.length) %
              controls.length;
        controls[next]?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", keyDown);
    };
  }, [open, trigger, onSwitch]);

  if ((!open && !present) || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panel}
      id={id}
      role="menu"
      aria-label={label}
      aria-hidden={!open}
      data-open={open}
      className={clsx(styles.menu, {
        [styles.shortcutMenu]: shortcutLayout,
      })}
      style={{
        width: WORKSPACE_MENU_WIDTH,
        ...position,
        visibility: open ? position.visibility : undefined,
      }}
    >
      {shortcuts
        ? shortcuts.map((shortcut, index) => (
            <button
              key={shortcut.id}
              type="button"
              role="menuitem"
              tabIndex={open ? 0 : -1}
              disabled={editDisabled?.(shortcut.id)}
              data-workspace-edit-action={shortcut.id}
              className={styles.shortcutRow}
              data-group-start={
                (index > 0 && shortcut.group !== shortcuts[index - 1].group) ||
                undefined
              }
              onMouseDown={(event) => event.preventDefault()}
              onPointerEnter={() => onEditIntent?.(shortcut.id, false)}
              onFocus={() => onEditIntent?.(shortcut.id, false)}
              onPointerDown={() => onEditIntent?.(shortcut.id, true)}
              onClick={() => {
                onEditIntent?.(shortcut.id, true);
                onClose(false);
                onEdit?.(shortcut.id);
              }}
            >
              <span className={styles.shortcutLabel}>{shortcut.label}</span>
              <span className={styles.shortcutKeys}>
                {shortcut.keys.join("+")}
              </span>
            </button>
          ))
        : items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              data-workspace-action={item.id}
              data-destructive={item.destructive || undefined}
              tabIndex={open ? 0 : -1}
              disabled={item.disabled}
              onPointerEnter={() => item.onIntent?.(false)}
              onFocus={() => item.onIntent?.(false)}
              onPointerDown={() => item.onIntent?.(true)}
              onClick={() => {
                item.onIntent?.(true);
                onClose(true);
                queueMicrotask(item.onSelect);
              }}
            >
              <span aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
    </div>,
    document.body,
  );
}
