import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Locale from "../locales";
import clsx from "clsx";
import CopyIcon from "../icons/copy.svg";
import EditIcon from "../icons/edit.svg";
import ReloadIcon from "../icons/reload.svg";
import PinIcon from "../icons/pin.svg";
import DeleteIcon from "../icons/clear.svg";
import DownloadIcon from "../icons/download.svg";
import { Quote } from "lucide-react";
import { downloadImage } from "../utils/image-download";
import { showToast } from "./ui-lib";
import styles from "./chat.module.scss";
import menuStyles from "./chat-context-menu.module.scss";
export { getMessageSelectionText } from "../utils/message-selection";

export interface ContextMenuState {
  x: number;
  y: number;
  content: string;
  selectedText?: string;
  messageId: string;
  isUser: boolean;
  imageSrc?: string;
}

export function ChatContextMenu(props: {
  state: ContextMenuState;
  onClose: () => void;
  onCopy: (content: string) => void;
  onQuote?: (text: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onEdit: (content: string) => void;
  onPin: (id: string) => void;
  isStreaming: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        propsRef.current.onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") propsRef.current.onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const adjustedX = Math.min(props.state.x, window.innerWidth - 200);
  const adjustedY = Math.min(props.state.y, window.innerHeight - 300);
  return createPortal(
    <div
      ref={menuRef}
      className={styles["chat-context-menu"]}
      style={{ left: adjustedX, top: adjustedY }}
    >
      {props.state.imageSrc && (
        <div
          className={styles["chat-context-menu-item"]}
          onClick={() => {
            void downloadImage(props.state.imageSrc!).catch(() =>
              showToast(Locale.Download.Failed),
            );
            props.onClose();
          }}
        >
          <DownloadIcon />
          <span>下载图片</span>
        </div>
      )}
      {props.onQuote && props.state.selectedText?.trim() && (
        <button
          type="button"
          className={clsx(styles["chat-context-menu-item"], menuStyles.action)}
          aria-label="引用选中文字"
          onClick={() => {
            props.onQuote?.(props.state.selectedText!);
            props.onClose();
          }}
        >
          <Quote size={16} aria-hidden="true" />
          <span>引用</span>
        </button>
      )}
      <div
        className={styles["chat-context-menu-item"]}
        onClick={() => {
          props.onCopy(props.state.selectedText ?? props.state.content);
          props.onClose();
        }}
      >
        <CopyIcon />
        <span>{Locale.Chat.Actions.Copy}</span>
      </div>
      {props.state.isUser && (
        <div
          className={styles["chat-context-menu-item"]}
          onClick={() => {
            props.onEdit(props.state.content);
            props.onClose();
          }}
        >
          <EditIcon />
          <span>{Locale.Chat.Actions.Edit}</span>
        </div>
      )}
      {!props.state.isUser && !props.isStreaming && (
        <div
          className={styles["chat-context-menu-item"]}
          onClick={() => {
            props.onRetry(props.state.messageId);
            props.onClose();
          }}
        >
          <ReloadIcon />
          <span>{Locale.Chat.Actions.Retry}</span>
        </div>
      )}
      <div
        className={styles["chat-context-menu-item"]}
        onClick={() => {
          props.onPin(props.state.messageId);
          props.onClose();
        }}
      >
        <PinIcon />
        <span>{Locale.Chat.Actions.Pin}</span>
      </div>
      <div className={styles["chat-context-menu-divider"]} />
      <div
        className={clsx(styles["chat-context-menu-item"], styles["danger"])}
        onClick={() => {
          props.onDelete(props.state.messageId);
          props.onClose();
        }}
      >
        <DeleteIcon />
        <span>{Locale.Chat.Actions.Delete}</span>
      </div>
    </div>,
    document.body,
  );
}
