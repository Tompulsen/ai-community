import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import Locale from "../locales";
import { IconButton } from "./button";
import { Modal, List, ListItem, useModalClose } from "./ui-lib";
import { useChatStore } from "../store";
import { createImeGuard } from "../utils/ime-input";
import ConfirmIcon from "../icons/confirm.svg";
import CancelIcon from "../icons/cancel.svg";
import styles from "./chat.module.scss";

export { DeleteImageButton } from "./delete-image-button";

const ContextPrompts = dynamic(
  async () => (await import("./mask-config")).ContextPrompts,
  { ssr: false, loading: () => null },
);

export function TypingTimer() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      setSeconds(elapsed);
    }, 500);
    return () => clearInterval(interval);
  }, []);
  const display =
    seconds < 60
      ? `${seconds.toFixed(1)}s`
      : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  return (
    <span className={styles["chat-typing-timer"]}>
      {Locale.Chat.Typing} {display}
    </span>
  );
}

export function ShortcutKeyModal(props: { onClose: () => void }) {
  const { maskRef, requestClose, onBackdropClick } = useModalClose(
    props.onClose,
  );
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const shortcuts = [
    {
      title: Locale.Chat.ShortcutKey.newChat,
      keys: isMac ? ["⌘", "Shift", "O"] : ["Ctrl", "Shift", "O"],
    },
    { title: Locale.Chat.ShortcutKey.focusInput, keys: ["Shift", "Esc"] },
    {
      title: Locale.Chat.ShortcutKey.copyLastCode,
      keys: isMac ? ["⌘", "Shift", ";"] : ["Ctrl", "Shift", ";"],
    },
    {
      title: Locale.Chat.ShortcutKey.copyLastMessage,
      keys: isMac ? ["⌘", "Shift", "C"] : ["Ctrl", "Shift", "C"],
    },
    {
      title: Locale.Chat.ShortcutKey.showShortcutKey,
      keys: isMac ? ["⌘", "/"] : ["Ctrl", "/"],
    },
    {
      title: Locale.Chat.ShortcutKey.clearContext,
      keys: isMac
        ? ["⌘", "Shift", "backspace"]
        : ["Ctrl", "Shift", "backspace"],
    },
  ];
  return (
    <div className="modal-mask" ref={maskRef} onClick={onBackdropClick}>
      <Modal
        title={Locale.Chat.ShortcutKey.Title}
        onClose={() => requestClose()}
        actions={[
          <IconButton
            type="primary"
            text={Locale.UI.Confirm}
            icon={<ConfirmIcon />}
            key="ok"
            onClick={() => requestClose()}
          />,
        ]}
      >
        <div className={styles["shortcut-key-container"]}>
          <div className={styles["shortcut-key-grid"]}>
            {shortcuts.map((shortcut, index) => (
              <div key={index} className={styles["shortcut-key-item"]}>
                <div className={styles["shortcut-key-title"]}>
                  {shortcut.title}
                </div>
                <div className={styles["shortcut-key-keys"]}>
                  {shortcut.keys.map((key, i) => (
                    <div key={i} className={styles["shortcut-key"]}>
                      <span>{key}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function EditMessageModal(props: { onClose: () => void }) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const [messages, setMessages] = useState(session.messages.slice());
  const { maskRef, requestClose } = useModalClose(props.onClose);
  return createPortal(
    <div className="modal-mask" ref={maskRef}>
      <Modal
        title={Locale.Chat.EditMessage.Title}
        onClose={() => requestClose()}
        actions={[
          <IconButton
            text={Locale.UI.Cancel}
            icon={<CancelIcon />}
            key="cancel"
            onClick={() => requestClose()}
          />,
          <IconButton
            type="primary"
            text={Locale.UI.Confirm}
            icon={<ConfirmIcon />}
            key="ok"
            onClick={() => {
              requestClose(() =>
                chatStore.updateTargetSession(
                  session,
                  (session) => (session.messages = messages),
                ),
              );
            }}
          />,
        ]}
      >
        <List>
          <ListItem
            title={Locale.Chat.EditMessage.Topic.Title}
            subTitle={Locale.Chat.EditMessage.Topic.SubTitle}
          >
            <input
              type="text"
              aria-label={Locale.Chat.EditMessage.Topic.Title}
              value={session.topic}
              onInput={(e) =>
                chatStore.updateTargetSession(
                  session,
                  (session) => (session.topic = e.currentTarget.value),
                )
              }
            />
          </ListItem>
        </List>
        <ContextPrompts
          context={messages}
          updateContext={(updater) => {
            const newMessages = messages.slice();
            updater(newMessages);
            setMessages(newMessages);
          }}
        />
      </Modal>
    </div>,
    document.body,
  );
}

export function EditInputModal(props: {
  initialValue: string;
  onConfirm: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(props.initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ime = useRef(createImeGuard());
  const { maskRef, requestClose } = useModalClose(props.onClose);

  const confirmInput = () => {
    requestClose(() => props.onConfirm(text));
  };

  useEffect(() => {
    // 自动聚焦并移动光标到末尾
    const ta = textareaRef.current;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, []);

  return createPortal(
    <div className="modal-mask" ref={maskRef}>
      <Modal
        title="编辑输入内容"
        onClose={() => requestClose()}
        actions={[
          <IconButton
            text={Locale.UI.Cancel}
            icon={<CancelIcon />}
            key="cancel"
            onClick={() => requestClose()}
          />,
          <IconButton
            type="primary"
            text={Locale.UI.Confirm}
            icon={<ConfirmIcon />}
            key="ok"
            onClick={confirmInput}
          />,
        ]}
      >
        <div className={styles["edit-input-modal"]}>
          <textarea
            ref={textareaRef}
            className={styles["edit-input-textarea"]}
            value={text}
            aria-label="编辑输入内容"
            onChange={(e) => setText(e.currentTarget.value)}
            onCompositionStart={() => ime.current.start()}
            onCompositionEnd={() => ime.current.end()}
            onKeyUp={(e) => ime.current.release(e.nativeEvent)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || (!e.ctrlKey && !e.metaKey) || e.altKey) {
                return;
              }
              if (ime.current.blocks(e.nativeEvent)) {
                if (!ime.current.isComposing(e.nativeEvent)) e.preventDefault();
                return;
              }
              e.preventDefault();
              e.stopPropagation();
              confirmInput();
            }}
            placeholder="在此编辑你的输入内容..."
            autoFocus
          />
        </div>
      </Modal>
    </div>,
    document.body,
  );
}
