"use client";

import {
  useId,
  useRef,
  useState,
  type KeyboardEventHandler,
  type PointerEventHandler,
} from "react";
import { MoreHorizontal, Quote } from "lucide-react";
import clsx from "clsx";
import { SelectionDialog } from "./selection-dialog";
import { getMessageSelectionText } from "../utils/message-selection";
import styles from "./chat.module.scss";

type ChatActionProps = {
  text: string;
  icon: JSX.Element;
  onClick: () => void;
  title?: string;
  showLabel?: boolean;
  selected?: boolean;
  expanded?: boolean;
  controls?: string;
  disabled?: boolean;
  busy?: boolean;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  onPointerCancel?: PointerEventHandler<HTMLButtonElement>;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
};

export function ChatAction(props: ChatActionProps) {
  return (
    <button
      type="button"
      className={clsx(styles["chat-input-action"], {
        [styles["chat-input-action-labeled"]]: props.showLabel,
      })}
      title={props.title || props.text}
      aria-label={props.title || props.text}
      aria-pressed={props.selected}
      aria-expanded={props.expanded}
      aria-controls={props.controls}
      aria-haspopup={props.controls ? "dialog" : undefined}
      disabled={props.disabled}
      aria-busy={props.busy || undefined}
      onClick={props.onClick}
      onPointerDown={props.onPointerDown}
      onPointerCancel={props.onPointerCancel}
      onKeyDown={props.onKeyDown}
    >
      <span className={styles["icon"]} aria-hidden="true">
        {props.icon}
      </span>
      <span className={styles["text"]}>{props.text}</span>
    </button>
  );
}

export type ChatMessageAction = ChatActionProps & {
  id: string;
  keepVisible?: boolean;
  destructive?: boolean;
};

export function ChatActionMenu({
  id,
  title,
  open,
  onClose,
  actions,
}: {
  id: string;
  title: string;
  open: boolean;
  onClose: () => void;
  actions: ChatMessageAction[];
}) {
  const pendingAction = useRef<(() => void) | null>(null);

  return (
    <SelectionDialog
      id={id}
      title={title}
      compact
      open={open}
      onClose={() => {
        onClose();
        // Release the sheet's focus scope before opening another dialog.
        const action = pendingAction.current;
        pendingAction.current = null;
        action?.();
      }}
    >
      <div className={styles["chat-message-actions-menu"]}>
        {actions.map((action, index) => (
          <button
            key={action.id}
            type="button"
            className={clsx(styles["chat-message-menu-action"], {
              [styles["danger"]]: action.destructive,
            })}
            aria-label={action.title || action.text}
            aria-pressed={action.selected}
            aria-busy={action.busy || undefined}
            disabled={action.disabled}
            data-autofocus={index === 0 ? "" : undefined}
            onClick={() => {
              pendingAction.current = action.onClick;
              onClose();
            }}
          >
            <span aria-hidden="true">{action.icon}</span>
            <span>{action.text}</span>
          </button>
        ))}
      </div>
    </SelectionDialog>
  );
}

export function ChatMessageActions({
  actions,
  compact,
  onQuoteSelection,
}: {
  actions: ChatMessageAction[];
  compact: boolean;
  onQuoteSelection?: (text: string) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [quotedSelection, setQuotedSelection] = useState<string>();
  const actionsRef = useRef<HTMLDivElement>(null);
  const pointerSelection = useRef<{ text?: string } | null>(null);
  const menuId = useId();
  const readSelection = () => {
    if (!onQuoteSelection) return;
    const message = actionsRef.current?.closest("[data-quotable-message]");
    const selection = message?.ownerDocument.getSelection();
    if (
      !selection?.rangeCount ||
      message?.ownerDocument.activeElement?.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
      )
    )
      return;
    for (let index = 0; index < selection.rangeCount; index++) {
      const range = selection.getRangeAt(index);
      for (const node of [range.startContainer, range.endContainer]) {
        const element = node instanceof Element ? node : node.parentElement;
        if (
          element?.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
          )
        )
          return;
      }
    }
    const text = getMessageSelectionText(message ?? null);
    return text?.trim() ? text : undefined;
  };
  const closeMore = () => {
    setMoreOpen(false);
    setQuotedSelection(undefined);
    pointerSelection.current = null;
  };
  const isPrimary = (action: ChatMessageAction) =>
    action.id === "copy" || action.id === "retry" || action.keepVisible;
  const visibleActions = compact
    ? [
        ...["copy", "retry"].flatMap((id) =>
          actions.filter((action) => action.id === id),
        ),
        ...actions.filter(
          (action) =>
            action.keepVisible && action.id !== "copy" && action.id !== "retry",
        ),
      ]
    : actions;
  const menuActions = [
    ...(quotedSelection && onQuoteSelection
      ? [
          {
            id: "quote-selection",
            text: "引用选中文字",
            icon: <Quote size={16} />,
            onClick: () => onQuoteSelection(quotedSelection),
          },
        ]
      : []),
    ...actions.filter((action) => !isPrimary(action)),
  ];

  return (
    <>
      <div
        ref={actionsRef}
        className={clsx(styles["chat-input-actions"], {
          [styles["chat-message-actions-compact"]]: compact,
        })}
      >
        {visibleActions.map(({ id, ...action }) => (
          <ChatAction key={id} {...action} />
        ))}
        {compact && menuActions.length > 0 && (
          <ChatAction
            text="更多"
            title="更多消息操作"
            icon={<MoreHorizontal size={16} />}
            expanded={moreOpen}
            controls={menuId}
            onPointerDown={() => {
              pointerSelection.current = { text: readSelection() };
            }}
            onPointerCancel={() => {
              pointerSelection.current = null;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ")
                pointerSelection.current = null;
            }}
            onClick={() => {
              const captured = pointerSelection.current;
              pointerSelection.current = null;
              setQuotedSelection(captured ? captured.text : readSelection());
              setMoreOpen(true);
            }}
          />
        )}
      </div>
      <ChatActionMenu
        id={menuId}
        title="消息操作"
        open={compact && moreOpen}
        onClose={closeMore}
        actions={menuActions}
      />
    </>
  );
}
