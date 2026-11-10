import { jest } from "@jest/globals";

jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    Chat: {
      ShortcutKey: {
        newChat: "New chat",
        focusInput: "Focus input",
        copyLastCode: "Copy last code",
        copyLastMessage: "Copy last reply",
        clearContext: "Clear context",
      },
    },
    Settings: { Title: "Settings" },
  },
}));

const { getChatShortcuts } = await import("../app/utils/chat-shortcuts");

test.each([false, true])(
  "edit shortcut help includes standard editing and five chat commands (Mac: %s)",
  (isMac) => {
    const shortcuts = getChatShortcuts(isMac);
    expect(shortcuts).toHaveLength(13);
    expect(shortcuts.map(({ id }) => id)).toEqual([
      "undo",
      "redo",
      "cut",
      "copy",
      "paste",
      "delete",
      "select-all",
      "new-chat",
      "focus-input",
      "copy-last-code",
      "copy-last-reply",
      "clear-context",
      "settings",
    ]);
    expect(shortcuts.some(({ id }) => String(id) === "shortcuts")).toBe(false);
    const modifier = isMac ? "⌘" : "Ctrl";
    expect(shortcuts.map(({ keys }) => keys)).toEqual([
      [modifier, "Z"],
      isMac ? [modifier, "Shift", "Z"] : [modifier, "Y"],
      [modifier, "X"],
      [modifier, "C"],
      [modifier, "V"],
      [isMac ? "⌫" : "Delete"],
      [modifier, "A"],
      [modifier, "Shift", "O"],
      ["Shift", "Esc"],
      [modifier, "Shift", ";"],
      [modifier, "Shift", "C"],
      [modifier, "Shift", "backspace"],
      [modifier, ","],
    ]);
    expect(shortcuts.map(({ label }) => label)).toEqual([
      "撤销",
      "重做",
      "剪切",
      "复制",
      "粘贴",
      "删除",
      "全选",
      "New chat",
      "Focus input",
      "Copy last code",
      "Copy last reply",
      "Clear context",
      "Settings",
    ]);
    expect(shortcuts.map(({ group }) => group)).toEqual([
      "history",
      "history",
      "clipboard",
      "clipboard",
      "clipboard",
      "clipboard",
      "selection",
      "navigation",
      "navigation",
      "copy",
      "copy",
      "context",
      "settings",
    ]);
  },
);
