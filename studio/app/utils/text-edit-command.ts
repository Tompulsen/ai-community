import { copyToClipboard } from "../utils";
import type { ChatShortcutAction } from "./chat-shortcuts";

export type TextEditCommand = Extract<
  ChatShortcutAction,
  "undo" | "redo" | "cut" | "copy" | "paste" | "delete" | "select-all"
>;

export type TextEditTarget =
  | {
      kind: "input";
      element: HTMLInputElement | HTMLTextAreaElement;
      value: string;
      start: number;
      end: number;
      direction: "forward" | "backward" | "none";
      undo?: boolean;
      redo?: boolean;
    }
  | { kind: "selection"; range: Range; text: string };

export function isTextEditCommand(
  action: ChatShortcutAction,
): action is TextEditCommand {
  return [
    "undo",
    "redo",
    "cut",
    "copy",
    "paste",
    "delete",
    "select-all",
  ].includes(action);
}

export function captureTextEditTarget(
  element: Element | null = document.activeElement,
): TextEditTarget | null {
  if (
    (element instanceof HTMLTextAreaElement ||
      element instanceof HTMLInputElement) &&
    !element.disabled &&
    element.selectionStart !== null &&
    element.selectionEnd !== null
  ) {
    const canUndo = (command: string) =>
      document.activeElement === element &&
      typeof document.queryCommandEnabled === "function"
        ? document.queryCommandEnabled(command)
        : undefined;
    return {
      kind: "input",
      element,
      value: element.value,
      start: element.selectionStart,
      end: element.selectionEnd,
      direction: element.selectionDirection ?? "none",
      undo: canUndo("undo"),
      redo: canUndo("redo"),
    };
  }
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!range.commonAncestorContainer.isConnected) return null;
  return {
    kind: "selection",
    range: range.cloneRange(),
    text: selection.toString(),
  };
}

function currentTarget(target: TextEditTarget) {
  return target.kind === "input"
    ? target.element.isConnected &&
        !target.element.disabled &&
        target.element.value === target.value
    : target.range.commonAncestorContainer.isConnected &&
        target.range.toString() === target.text;
}

function selectedText(target: TextEditTarget) {
  return target.kind === "input"
    ? target.value.slice(target.start, target.end)
    : target.text;
}

export function canRunTextEditCommand(
  command: TextEditCommand,
  target: TextEditTarget | null,
  isMac = false,
) {
  if (!target || !currentTarget(target)) return false;
  const password =
    target.kind === "input" &&
    target.element instanceof HTMLInputElement &&
    target.element.type === "password";
  if (command === "copy") return !password && selectedText(target).length > 0;
  if (target.kind !== "input") return false;
  if (command === "select-all") return target.value.length > 0;
  if (target.element.readOnly) return false;
  if (command === "cut") return !password && target.end > target.start;
  if (command === "paste")
    return typeof navigator.clipboard?.readText === "function";
  if (command === "delete")
    return (
      target.end > target.start ||
      (isMac ? target.start > 0 : target.end < target.value.length)
    );
  return target[command] !== false;
}

function restoreTarget(target: TextEditTarget) {
  if (!currentTarget(target)) return false;
  if (target.kind === "input") {
    target.element.focus({ preventScroll: true });
    if (document.activeElement !== target.element || !currentTarget(target))
      return false;
    target.element.setSelectionRange(
      target.start,
      target.end,
      target.direction,
    );
  } else {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(target.range);
  }
  return true;
}

function nativeEdit(
  target: Extract<TextEditTarget, { kind: "input" }>,
  command: string,
  value?: string,
) {
  if (!restoreTarget(target) || typeof document.execCommand !== "function")
    return false;
  const input = target.element;
  let receivedInput = false;
  const onInput = () => {
    receivedInput = true;
  };
  input.addEventListener("input", onInput);
  try {
    // Native commands retain the input's existing undo history.
    const success = document.execCommand(command, false, value);
    if (input.value !== target.value && !receivedInput)
      input.dispatchEvent(new Event("input", { bubbles: true }));
    return success || input.value !== target.value;
  } catch {
    return false;
  } finally {
    input.removeEventListener("input", onInput);
  }
}

export async function runTextEditCommand(
  command: TextEditCommand,
  target: TextEditTarget | null,
  isCurrent: () => boolean,
  isMac = false,
): Promise<"success" | "unavailable" | "paste-failed"> {
  if (
    !target ||
    !isCurrent() ||
    !canRunTextEditCommand(command, target, isMac) ||
    !restoreTarget(target)
  )
    return "unavailable";
  if (command === "copy")
    return (await copyToClipboard(selectedText(target)))
      ? "success"
      : "unavailable";
  if (target.kind !== "input") return "unavailable";
  const stillEditing = () =>
    isCurrent() &&
    currentTarget(target) &&
    document.activeElement === target.element &&
    !target.element.readOnly &&
    target.element.selectionStart === target.start &&
    target.element.selectionEnd === target.end;
  if (command === "select-all") {
    target.element.select();
    return "success";
  }
  if (command === "cut") {
    const copied = await copyToClipboard(selectedText(target));
    return copied && stillEditing() && nativeEdit(target, "delete")
      ? "success"
      : "unavailable";
  }
  if (command === "paste") {
    try {
      const text = await navigator.clipboard.readText();
      return text && stillEditing() && nativeEdit(target, "insertText", text)
        ? "success"
        : "unavailable";
    } catch {
      return "paste-failed";
    }
  }
  const nativeCommand =
    command === "delete" && target.start === target.end && !isMac
      ? "forwardDelete"
      : command;
  return nativeEdit(target, nativeCommand) ? "success" : "unavailable";
}
