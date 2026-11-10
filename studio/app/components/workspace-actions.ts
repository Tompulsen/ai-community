"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

export type WorkspaceAction =
  | "search"
  | "export"
  | "regenerate-title"
  | "edit-messages"
  | "model"
  | "skills"
  | "chat-settings"
  | "focus-input"
  | "copy-last-code"
  | "copy-last-reply"
  | "clear-context"
  | "shortcuts";

const WORKSPACE_ACTION = "octopus-workspace-action";

export function dispatchWorkspaceAction(action: WorkspaceAction) {
  window.dispatchEvent(new CustomEvent(WORKSPACE_ACTION, { detail: action }));
}

export function getLastChatCode(container: ParentNode | null) {
  const code = container?.querySelectorAll<HTMLElement>("pre code");
  const lastCode = code?.[code.length - 1];
  return lastCode
    ? lastCode.innerText ?? lastCode.textContent ?? ""
    : undefined;
}

export function useWorkspaceActions(
  actions: Partial<Record<WorkspaceAction, () => void>>,
) {
  const latest = useRef(actions);
  useLayoutEffect(() => {
    latest.current = actions;
  });
  useEffect(() => {
    const onAction = (event: Event) => {
      const action = (event as CustomEvent<WorkspaceAction>).detail;
      latest.current[action]?.();
    };
    window.addEventListener(WORKSPACE_ACTION, onAction);
    return () => window.removeEventListener(WORKSPACE_ACTION, onAction);
  }, []);
}
