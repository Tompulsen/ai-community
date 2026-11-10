import styles from "./chat-list.module.scss";
import dynamic from "next/dynamic";
import {
  DragDropContext,
  Droppable,
  Draggable,
  OnDragEndResponder,
} from "@hello-pangea/dnd";

import { useChatStore } from "../store";

import Locale from "../locales";
import { useLocation, useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { MaskAvatar } from "./mask-avatar";
import { memo, useCallback, useMemo, useRef, useEffect, useState } from "react";
import {
  FolderInput,
  FolderMinus,
  ListChecks,
  MoreHorizontal,
  MousePointer2,
  Pencil,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { showConfirm } from "./ui-lib";
import { WorkspaceMenu } from "./workspace-menu";
import { createChatListStoreSelector } from "../utils/chat-list-summary";
import { renameChatSession } from "./chat-session-actions";
import { MoveToProjectDialog } from "./chat-project-actions";
import {
  getLocalScope,
  isLocalWorkspaceActive,
} from "../utils/local-workspace";
import clsx from "clsx";

const SessionConfigModel = dynamic(
  async () => (await import("./session-config-modal")).SessionConfigModel,
  { ssr: false, loading: () => null },
);

function formatChatTime(timestamp: number) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return { label: "", full: "" };
  const now = new Date();
  const label =
    date.toDateString() === now.toDateString()
      ? date.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          ...(date.getFullYear() !== now.getFullYear()
            ? { year: "numeric" }
            : {}),
        });
  return { label, full: date.toLocaleString(), iso: date.toISOString() };
}

function restoreListFocus(
  container: HTMLDivElement | null,
  id?: string,
  preferRequestedRow = false,
) {
  requestAnimationFrame(() => {
    if (!container?.isConnected) return;
    const active = document.activeElement;
    if (
      !preferRequestedRow &&
      active instanceof HTMLElement &&
      active !== document.body &&
      active.isConnected &&
      !active.closest("[hidden], [inert], [aria-hidden='true']")
    )
      return;
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("[data-chat-session-id]"),
    ).filter((row) => !row.closest("[hidden], [inert], [aria-hidden='true']"));
    const state = useChatStore.getState();
    const currentId = state.sessions[state.currentSessionIndex]?.id;
    const requestedRow = rows.find((item) => item.dataset.chatSessionId === id);
    const targetProject = state.sessions.find((session) => session.id === id)
      ?.projectId;
    const projectToggle = targetProject
      ? Array.from(document.querySelectorAll<HTMLElement>("[data-project-id]"))
          .find(
            (project) =>
              project.dataset.projectId === targetProject &&
              !project.closest("[hidden], [inert], [aria-hidden='true']"),
          )
          ?.querySelector<HTMLButtonElement>("[data-project-toggle]")
      : undefined;
    const row =
      requestedRow ??
      rows.find((item) => item.dataset.chatSessionId === currentId) ??
      rows[0];
    const control =
      requestedRow?.querySelector<HTMLButtonElement>("[data-chat-more]") ??
      projectToggle ??
      row?.querySelector<HTMLButtonElement>("[data-chat-more]") ??
      row;
    control?.focus({ preventScroll: true });
  });
}

export const ChatItem = memo(function ChatItem(props: {
  onClick?: (id: string) => void;
  onDelete?: (id: string) => void;
  onRename?: (id: string) => void;
  onSettings?: (id: string) => void;
  onMoveToProject?: (id: string) => void;
  onRemoveFromProject?: (id: string) => void;
  title: string;
  count: number;
  time: number;
  selected: boolean;
  id: string;
  index: number;
  narrow?: boolean;
  avatar: string;
  model: string;
  selecting?: boolean;
  checked?: boolean;
  onToggle?: (id: string) => void;
  projectId?: string;
}) {
  const time = formatChatTime(props.time);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsId = `chat-item-actions-${props.id}`;
  const countId = `chat-item-count-${props.id}`;
  const draggableRef = useRef<HTMLDivElement | null>(null);
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const actionsKeyboard = useRef<"first" | "last" | null>(null);
  const closeActions = useCallback((restoreFocus = false) => {
    setActionsOpen(false);
    actionsKeyboard.current = null;
    if (restoreFocus) actionsTrigger.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (props.selecting) closeActions();
  }, [props.selecting, closeActions]);
  useEffect(() => {
    if (props.selected && !props.selecting && draggableRef.current) {
      draggableRef.current?.scrollIntoView({
        block: "center",
      });
    }
  }, [props.selected, props.selecting]);

  const { pathname: currentPath } = useLocation();
  const isCurrent =
    props.selected && (currentPath === Path.Chat || currentPath === Path.Home);
  return (
    <Draggable
      draggableId={`${props.id}`}
      index={props.index}
      isDragDisabled={props.selecting}
    >
      {(provided) => (
        <>
          <div
            className={clsx(styles["chat-item"], {
              [styles["chat-item-selected"]]: props.selecting
                ? props.checked
                : isCurrent,
              [styles["chat-item-selecting"]]: props.selecting,
              [styles["chat-item-compact"]]: props.narrow,
            })}
            onClick={() => {
              if (props.selecting) props.onToggle?.(props.id);
              else props.onClick?.(props.id);
            }}
            ref={(ele) => {
              draggableRef.current = ele;
              provided.innerRef(ele);
            }}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            role="button"
            tabIndex={0}
            aria-label={props.title}
            aria-describedby={props.narrow ? undefined : countId}
            data-chat-session-id={props.id}
            data-chat-project-id={props.projectId}
            aria-current={isCurrent ? "page" : undefined}
            aria-pressed={props.selecting ? props.checked : undefined}
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                event.target !== event.currentTarget ||
                event.defaultPrevented ||
                event.nativeEvent.isComposing ||
                event.repeat
              ) {
                return;
              }
              event.preventDefault();
              if (props.selecting) props.onToggle?.(props.id);
              else props.onClick?.(props.id);
            }}
          >
            {props.narrow ? (
              <div className={styles["chat-item-narrow"]}>
                <div className={clsx(styles["chat-item-avatar"], "no-dark")}>
                  <MaskAvatar avatar={props.avatar} model={props.model} />
                </div>
                {props.count > 0 && (
                  <div className={styles["chat-item-narrow-count"]}>
                    {props.count > 99 ? "99+" : props.count}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className={styles["chat-item-title"]}>
                  <span>{props.title}</span>
                </div>
                <span id={countId} className={styles["chat-item-count"]}>
                  {Locale.ChatItem.ChatItemCount(props.count)}
                </span>
                <time
                  className={styles["chat-item-date"]}
                  dateTime={time.iso}
                  title={time.full}
                >
                  {time.label}
                </time>
              </>
            )}

            {!props.selecting && (
              <button
                ref={actionsTrigger}
                type="button"
                className={styles["chat-item-more"]}
                title={Locale.Chat.InputActions.More}
                aria-label={`${Locale.Chat.InputActions.More}：${props.title}`}
                aria-haspopup="menu"
                aria-expanded={actionsOpen}
                aria-controls={actionsId}
                data-chat-more
                onClick={(e) => {
                  e.stopPropagation();
                  actionsKeyboard.current = e.detail === 0 ? "first" : null;
                  setActionsOpen((previous) => !previous);
                }}
                onKeyDown={(event) => {
                  if (
                    !["ArrowDown", "ArrowUp"].includes(event.key) ||
                    event.defaultPrevented ||
                    event.nativeEvent.isComposing
                  )
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  actionsKeyboard.current =
                    event.key === "ArrowDown" ? "first" : "last";
                  if (actionsOpen) {
                    const controls = document
                      .getElementById(actionsId)
                      ?.querySelectorAll<HTMLButtonElement>(
                        'button[role="menuitem"]:not(:disabled)',
                      );
                    const control =
                      actionsKeyboard.current === "last"
                        ? controls?.[controls.length - 1]
                        : controls?.[0];
                    control?.focus({ preventScroll: true });
                  } else setActionsOpen(true);
                }}
              >
                <MoreHorizontal aria-hidden="true" />
              </button>
            )}
          </div>
          <WorkspaceMenu
            id={actionsId}
            label={props.title}
            open={actionsOpen}
            align="end"
            trigger={actionsTrigger}
            keyboard={actionsKeyboard}
            onClose={closeActions}
            items={[
              ...(props.onMoveToProject
                ? [
                    {
                      id: "move-to-project",
                      label: "移至项目",
                      icon: <FolderInput />,
                      onSelect: () => props.onMoveToProject?.(props.id),
                    },
                  ]
                : []),
              ...(props.projectId && props.onRemoveFromProject
                ? [
                    {
                      id: "remove-from-project",
                      label: "移出项目",
                      icon: <FolderMinus />,
                      onSelect: () => props.onRemoveFromProject?.(props.id),
                    },
                  ]
                : []),
              ...(props.onRename
                ? [
                    {
                      id: "rename",
                      label: Locale.Chat.Rename,
                      icon: <Pencil />,
                      onSelect: () => props.onRename?.(props.id),
                    },
                  ]
                : []),
              ...(props.onSettings
                ? [
                    {
                      id: "settings",
                      label: Locale.Chat.InputActions.ChatSettings,
                      icon: <Settings2 />,
                      onSelect: () => props.onSettings?.(props.id),
                    },
                  ]
                : []),
              {
                id: "select",
                label: Locale.ChatItem.SelectChat(props.title),
                icon: <MousePointer2 />,
                onSelect: () => {
                  props.onToggle?.(props.id);
                  draggableRef.current?.focus({ preventScroll: true });
                },
              },
              {
                id: "delete",
                label: Locale.Home.DeleteChat,
                icon: <Trash2 />,
                destructive: true,
                onSelect: () => props.onDelete?.(props.id),
              },
            ]}
          />
        </>
      )}
    </Draggable>
  );
});

export const ChatList = memo(function ChatList(props: {
  narrow?: boolean;
  projectId?: string;
  embedded?: boolean;
}) {
  const selector = useMemo(
    () => createChatListStoreSelector(props.projectId),
    [props.projectId],
  );
  const { sessions, selectedIndex } = useChatStore(selector);
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);
  const listOwner = useRef(getLocalScope());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [movingIds, setMovingIds] = useState<string[] | null>(null);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const selected = sessions.filter((session) => selectedIds.has(session.id));
  const selecting = selected.length > 0;
  const allSelected = selected.length === sessions.length;

  const cancelSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);
  useEffect(() => {
    setSelectedIds((previous) => {
      const visible = new Set(sessions.map((session) => session.id));
      const next = new Set([...previous].filter((id) => visible.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [sessions]);
  useEffect(() => {
    setSelectedIds((previous) => (previous.size ? new Set() : previous));
  }, [props.projectId]);
  useEffect(() => {
    if (!selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedIds(new Set());
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selecting]);
  const toggleSession = useCallback((id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const openSession = useCallback(
    (id: string) => {
      const state = useChatStore.getState();
      const index = state.sessions.findIndex((session) => session.id === id);
      if (index < 0) return;
      navigate(Path.Chat);
      void state.selectSession(index);
    },
    [navigate],
  );
  const deleteSession = useCallback(async (id: string) => {
    if (!(await showConfirm(Locale.Home.DeleteChat))) return;
    const state = useChatStore.getState();
    if (state.sessions.some((session) => session.id === id))
      await state.deleteSessions([id]);
    restoreListFocus(listRef.current, id);
  }, []);
  const renameSession = useCallback(async (id: string) => {
    await renameChatSession(id);
    restoreListFocus(listRef.current, id);
  }, []);
  const openSettings = useCallback((id: string) => {
    if (
      isLocalWorkspaceActive() &&
      getLocalScope() === listOwner.current &&
      useChatStore.getState().sessions.some((session) => session.id === id)
    )
      setSettingsId(id);
  }, []);
  const startProjectMove = useCallback((ids: string[]) => {
    if (isLocalWorkspaceActive() && getLocalScope() === listOwner.current)
      setMovingIds(ids);
  }, []);
  const moveSession = useCallback(
    (id: string) => startProjectMove([id]),
    [startProjectMove],
  );
  const removeFromProject = useCallback((id: string) => {
    if (!isLocalWorkspaceActive() || getLocalScope() !== listOwner.current)
      return;
    const state = useChatStore.getState();
    if (
      state.sessions.some((session) => session.id === id && session.projectId)
    )
      state.moveSessionsToProject([id]);
    restoreListFocus(listRef.current, id);
  }, []);
  const deleteSelected = async () => {
    const ids = selected.map((session) => session.id);
    if (
      ids.length &&
      (await showConfirm(Locale.ChatItem.DeleteConfirm(ids.length)))
    ) {
      await useChatStore.getState().deleteSessions(ids);
      cancelSelection();
      restoreListFocus(listRef.current);
    }
  };

  const onDragEnd = useCallback<OnDragEndResponder>(
    (result) => {
      if (selecting) return;
      const { destination, source } = result;
      if (!destination) return;
      if (destination.droppableId !== source.droppableId) return;

      if (
        destination.droppableId === source.droppableId &&
        destination.index === source.index
      )
        return;

      const state = useChatStore.getState();
      const moving = state.sessions.find(
        (session) => session.id === result.draggableId,
      );
      if ((moving?.projectId || undefined) !== props.projectId) return;
      const from = state.sessions.findIndex(
        (session) => session.id === result.draggableId,
      );
      const destinationId = sessions[destination.index]?.id;
      const to = state.sessions.findIndex(
        (session) =>
          session.id === destinationId &&
          (session.projectId || undefined) === props.projectId,
      );
      if (from >= 0 && to >= 0 && from !== to) state.moveSession(from, to);
    },
    [selecting, sessions, props.projectId],
  );

  const rows = sessions.map((item, index) => (
    <ChatItem
      title={item.topic}
      time={item.time}
      count={item.count}
      key={item.id}
      id={item.id}
      index={index}
      selected={index === selectedIndex}
      selecting={selecting}
      checked={selectedIds.has(item.id)}
      projectId={item.projectId}
      onToggle={toggleSession}
      onClick={openSession}
      onDelete={deleteSession}
      onRename={renameSession}
      onSettings={openSettings}
      onMoveToProject={moveSession}
      onRemoveFromProject={removeFromProject}
      narrow={props.narrow}
      avatar={item.avatar}
      model={item.model}
    />
  ));

  return (
    <div
      ref={listRef}
      className={styles["chat-list-shell"]}
      data-chat-list-project={props.projectId ?? ""}
    >
      {props.embedded ? (
        <div className={styles["chat-list"]}>{rows}</div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable
            droppableId={
              props.projectId
                ? `chat-list:project:${props.projectId}`
                : "chat-list:unassigned"
            }
          >
            {(provided) => (
              <div
                className={styles["chat-list"]}
                ref={provided.innerRef}
                {...provided.droppableProps}
              >
                {rows}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}
      {sessions.length === 0 && (
        <p className={styles["chat-list-empty"]} role="status">
          暂无对话
        </p>
      )}
      {selecting && (
        <div
          role="toolbar"
          aria-label={Locale.ChatItem.SelectedCount(selected.length)}
          className={clsx(styles["chat-list-toolbar"], {
            [styles["chat-list-toolbar-narrow"]]: props.narrow,
          })}
        >
          <>
            <button
              type="button"
              title={
                allSelected
                  ? Locale.ChatItem.DeselectAll
                  : Locale.ChatItem.SelectAll
              }
              aria-label={
                allSelected
                  ? Locale.ChatItem.DeselectAll
                  : Locale.ChatItem.SelectAll
              }
              onClick={() =>
                setSelectedIds(
                  allSelected
                    ? new Set()
                    : new Set(sessions.map((session) => session.id)),
                )
              }
            >
              <ListChecks aria-hidden="true" />
            </button>
            <span aria-live="polite">
              {props.narrow
                ? selected.length
                : Locale.ChatItem.SelectedCount(selected.length)}
            </span>
            <button
              type="button"
              title="移至项目"
              aria-label="移至项目"
              onClick={() =>
                startProjectMove(selected.map((session) => session.id))
              }
            >
              <FolderInput aria-hidden="true" />
            </button>
            <button
              type="button"
              title={Locale.ChatItem.DeleteSelected}
              aria-label={Locale.ChatItem.DeleteSelected}
              disabled={!selected.length}
              onClick={deleteSelected}
            >
              <Trash2 aria-hidden="true" />
            </button>
            <button
              type="button"
              title={Locale.UI.Cancel}
              aria-label={Locale.UI.Cancel}
              onClick={cancelSelection}
            >
              <X aria-hidden="true" />
            </button>
          </>
        </div>
      )}
      {movingIds && (
        <MoveToProjectDialog
          sessionIds={movingIds}
          currentProjectId={props.projectId}
          onClose={(moved) => {
            const movedId = movingIds[0];
            setMovingIds(null);
            if (moved) cancelSelection();
            restoreListFocus(listRef.current, movedId);
          }}
        />
      )}
      {settingsId && (
        <SessionConfigModel
          key={settingsId}
          sessionId={settingsId}
          onClose={() => {
            setSettingsId(null);
            restoreListFocus(listRef.current, settingsId, true);
          }}
        />
      )}
    </div>
  );
});
