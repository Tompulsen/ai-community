"use client";

import { useEffect, useRef, useState } from "react";
import { Folder, FolderMinus, FolderPlus } from "lucide-react";
import { useChatStore } from "../store";
import type { ChatProject } from "../store/chat";
import {
  CHAT_PROJECT_NAME_MAX_LENGTH,
  chatProjectNameSchema,
} from "../utils/chat-projects";
import {
  getLocalScope,
  isLocalWorkspaceActive,
} from "../utils/local-workspace";
import { SelectionDialog } from "./selection-dialog";
import styles from "./chat-project-actions.module.scss";

const EMPTY_PROJECTS: readonly ChatProject[] = [];

export async function promptCreateChatProject(): Promise<string | undefined> {
  if (!isLocalWorkspaceActive()) return;
  const owner = getLocalScope();
  const { showPrompt, showToast } = await import("./ui-lib");
  if (!isLocalWorkspaceActive() || getLocalScope() !== owner) return;
  const value = await showPrompt("新建项目", "", 1);
  if (value === null || !isLocalWorkspaceActive() || getLocalScope() !== owner)
    return;
  const parsed = chatProjectNameSchema.safeParse(value);
  if (!parsed.success) {
    showToast(
      value.trim()
        ? `项目名称最多 ${CHAT_PROJECT_NAME_MAX_LENGTH} 个字符`
        : "请输入项目名称",
    );
    return;
  }
  return useChatStore.getState().createProject(parsed.data);
}

type ProjectSelection =
  | { kind: "move"; projectId?: string }
  | { kind: "create" };

export function MoveToProjectDialog({
  sessionIds,
  currentProjectId,
  onClose,
}: {
  sessionIds: string[];
  currentProjectId?: string;
  onClose: (moved: boolean) => void;
}) {
  const projects = useChatStore((state) => state.projects ?? EMPTY_PROJECTS);
  const owner = useRef(getLocalScope());
  const pending = useRef<ProjectSelection | null>(null);
  const completed = useRef(false);
  const [open, setOpen] = useState(true);
  const firstAvailable = projects.find(
    (project) => project.id !== currentProjectId,
  )?.id;

  useEffect(() => {
    const closeForWorkspace = () => {
      pending.current = null;
      setOpen(false);
    };
    window.addEventListener("local-workspace-switch", closeForWorkspace);
    return () =>
      window.removeEventListener("local-workspace-switch", closeForWorkspace);
  }, []);

  const finishClose = async () => {
    if (completed.current) return;
    completed.current = true;
    const selection = pending.current;
    if (
      !selection ||
      !isLocalWorkspaceActive() ||
      getLocalScope() !== owner.current
    ) {
      onClose(false);
      return;
    }
    const projectId =
      selection.kind === "create"
        ? await promptCreateChatProject()
        : selection.projectId;
    if (
      (selection.kind === "create" && !projectId) ||
      !isLocalWorkspaceActive() ||
      getLocalScope() !== owner.current
    ) {
      onClose(false);
      return;
    }
    const state = useChatStore.getState();
    const existingIds = [...new Set(sessionIds)].filter((id) =>
      state.sessions.some((session) => session.id === id),
    );
    const targetExists =
      projectId === undefined ||
      state.projects.some((project) => project.id === projectId);
    onClose(
      existingIds.length > 0 &&
        targetExists &&
        state.moveSessionsToProject(existingIds, projectId),
    );
  };

  const choose = (selection: ProjectSelection) => {
    pending.current = selection;
    setOpen(false);
  };

  return (
    <SelectionDialog
      title="移至项目"
      compact
      open={open}
      onClose={() => void finishClose()}
    >
      <div className={styles.list} role="group" aria-label="选择项目">
        {projects.length === 0 && <p className={styles.empty}>暂无项目</p>}
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            className={styles.option}
            data-project-target={project.id}
            data-autofocus={project.id === firstAvailable ? "" : undefined}
            aria-pressed={project.id === currentProjectId}
            disabled={project.id === currentProjectId}
            title={project.name}
            onClick={() => choose({ kind: "move", projectId: project.id })}
          >
            <Folder size={18} aria-hidden="true" />
            <span>{project.name}</span>
          </button>
        ))}
        {currentProjectId && (
          <button
            type="button"
            className={styles.option}
            data-project-target=""
            data-autofocus={!firstAvailable ? "" : undefined}
            onClick={() => choose({ kind: "move" })}
          >
            <FolderMinus size={18} aria-hidden="true" />
            <span>未归类对话</span>
          </button>
        )}
        <button
          type="button"
          className={styles.option}
          data-create-project
          data-autofocus={!firstAvailable && !currentProjectId ? "" : undefined}
          onClick={() => choose({ kind: "create" })}
        >
          <FolderPlus size={18} aria-hidden="true" />
          <span>新建项目</span>
        </button>
      </div>
      <div className={styles.footer}>
        <button type="button" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </SelectionDialog>
  );
}
