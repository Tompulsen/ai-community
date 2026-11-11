import type { DropResult } from "@hello-pangea/dnd";

import { useChatStore } from "../store";
import {
  getLocalScope,
  isLocalWorkspaceActive,
  type LocalScope,
} from "../utils/local-workspace";

const PROJECT_PREFIX = "chat-list:project:";

export function chatProjectDropId(projectId?: string) {
  return projectId ? `${PROJECT_PREFIX}${projectId}` : "chat-list:unassigned";
}

export function projectIdFromDropId(id: string): string | undefined | null {
  if (id === "chat-list:unassigned") return undefined;
  if (id.startsWith(PROJECT_PREFIX) && id.length > PROJECT_PREFIX.length)
    return id.slice(PROJECT_PREFIX.length);
  return null;
}

export function applyChatProjectDrop(
  result: DropResult,
  owner: LocalScope | undefined,
): boolean {
  if (
    !owner ||
    !isLocalWorkspaceActive() ||
    getLocalScope() !== owner ||
    result.reason !== "DROP" ||
    !result.destination
  )
    return false;

  const sourceProjectId = projectIdFromDropId(result.source.droppableId);
  const projectId = projectIdFromDropId(result.destination.droppableId);
  const state = useChatStore.getState();
  const session = state.sessions.find((item) => item.id === result.draggableId);
  if (
    sourceProjectId === null ||
    projectId === null ||
    !session ||
    session.projectId !== sourceProjectId ||
    (projectId &&
      !state.projects.some((project) => project.id === projectId)) ||
    result.destination.index < 0
  )
    return false;
  if (
    sourceProjectId === projectId &&
    result.source.index === result.destination.index
  )
    return false;

  // Resolve positions by stable IDs so unrelated folders retain their order.
  const targetSessions = state.sessions.filter(
    (item) => item.id !== session.id && item.projectId === projectId,
  );
  const targetIndex = Math.min(result.destination.index, targetSessions.length);
  const beforeId = targetSessions[targetIndex]?.id;
  const afterId = targetSessions[targetSessions.length - 1]?.id;
  const movedProject = sourceProjectId !== projectId;
  if (movedProject && !state.moveSessionsToProject([session.id], projectId))
    return false;

  const latest = useChatStore.getState();
  const from = latest.sessions.findIndex((item) => item.id === session.id);
  const remaining = latest.sessions.filter((item) => item.id !== session.id);
  const to = beforeId
    ? remaining.findIndex((item) => item.id === beforeId)
    : afterId
    ? remaining.findIndex((item) => item.id === afterId) + 1
    : from;
  if (from >= 0 && to >= 0 && from !== to) latest.moveSession(from, to);
  return movedProject || from !== to;
}
