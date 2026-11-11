import Locale from "../locales";

export type ChatShortcutAction =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "delete"
  | "select-all"
  | "new-chat"
  | "focus-input"
  | "copy-last-code"
  | "copy-last-reply"
  | "clear-context"
  | "settings";

export function getChatShortcuts(isMac: boolean): {
  id: ChatShortcutAction;
  label: string;
  keys: string[];
  group: string;
}[] {
  const modifier = isMac ? "⌘" : "Ctrl";
  return [
    {
      id: "undo",
      label: "撤销",
      keys: [modifier, "Z"],
      group: "history",
    },
    {
      id: "redo",
      label: "重做",
      keys: isMac ? [modifier, "Shift", "Z"] : [modifier, "Y"],
      group: "history",
    },
    {
      id: "cut",
      label: "剪切",
      keys: [modifier, "X"],
      group: "clipboard",
    },
    {
      id: "copy",
      label: "复制",
      keys: [modifier, "C"],
      group: "clipboard",
    },
    {
      id: "paste",
      label: "粘贴",
      keys: [modifier, "V"],
      group: "clipboard",
    },
    {
      id: "delete",
      label: "删除",
      keys: [isMac ? "⌫" : "Delete"],
      group: "clipboard",
    },
    {
      id: "select-all",
      label: "全选",
      keys: [modifier, "A"],
      group: "selection",
    },
    {
      id: "new-chat",
      label: Locale.Chat.ShortcutKey.newChat,
      keys: [modifier, "Shift", "O"],
      group: "navigation",
    },
    {
      id: "focus-input",
      label: Locale.Chat.ShortcutKey.focusInput,
      keys: ["Shift", "Esc"],
      group: "navigation",
    },
    {
      id: "copy-last-code",
      label: Locale.Chat.ShortcutKey.copyLastCode,
      keys: [modifier, "Shift", ";"],
      group: "copy",
    },
    {
      id: "copy-last-reply",
      label: Locale.Chat.ShortcutKey.copyLastMessage,
      keys: [modifier, "Shift", "C"],
      group: "copy",
    },
    {
      id: "clear-context",
      label: Locale.Chat.ShortcutKey.clearContext,
      keys: [modifier, "Shift", "backspace"],
      group: "context",
    },
    {
      id: "settings",
      label: Locale.Settings.Title,
      keys: [modifier, ","],
      group: "settings",
    },
  ];
}
