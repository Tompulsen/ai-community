"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DragDropContext, Droppable } from "@hello-pangea/dnd";
import {
  Check,
  ChevronRight,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import clsx from "clsx";

import { useAppConfig, useChatStore, type ChatProject } from "../store";
import { DEFAULT_SIDEBAR_WIDTH, Path } from "../constant";
import { useNavigate } from "react-router-dom";
import {
  getLocalScope,
  isLocalWorkspaceActive,
  type LocalScope,
} from "../utils/local-workspace";
import { createChatListStoreSelector } from "../utils/chat-list-summary";
import {
  CHAT_PROJECT_NAME_MAX_LENGTH,
  chatProjectNameSchema,
} from "../utils/chat-projects";
import { createImeGuard } from "../utils/ime-input";
import { ChatList } from "./chat-list";
import { focusMenuEdge, WorkspaceMenu } from "./workspace-menu";
import {
  applyChatProjectDrop,
  chatProjectDropId,
  projectIdFromDropId,
} from "./chat-project-drag";
import { showConfirm, showPrompt, showToast } from "./ui-lib";
import sidebarStyles from "./sidebar.module.scss";
import styles from "./chat-project-list.module.scss";

function SidebarSection(props: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (content.current) content.current.inert = !props.open;
  }, [props.open]);

  return (
    <section className={sidebarStyles.section} data-open={props.open}>
      <div className={styles.heading}>
        <button
          type="button"
          className={sidebarStyles["section-toggle"]}
          aria-label={props.title}
          aria-expanded={props.open}
          aria-controls={props.id}
          onClick={props.onToggle}
        >
          <span className={sidebarStyles["section-label"]}>{props.title}</span>
          <ChevronRight size={13} aria-hidden="true" />
        </button>
        {props.actions}
      </div>
      <div
        ref={content}
        id={props.id}
        className={sidebarStyles["section-content"]}
        aria-hidden={!props.open}
      >
        <div className={sidebarStyles["section-inner"]}>{props.children}</div>
      </div>
    </section>
  );
}

function ProjectFolder(props: {
  project: ChatProject;
  count: number;
  current: boolean;
  narrow?: boolean;
  open: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  onDeleted: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [present, setPresent] = useState(props.open);
  const contents = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menuKeyboard = useRef<"first" | "last" | null>(null);
  const owner = useRef(getLocalScope());
  const contentId = `chat-project-content-${props.project.id}`;
  const menuId = `chat-project-menu-${props.project.id}`;
  const closeMenu = useCallback((restoreFocus = false) => {
    setMenuOpen(false);
    menuKeyboard.current = null;
    if (restoreFocus) menuTrigger.current?.focus({ preventScroll: true });
  }, []);
  const readProject = () =>
    isLocalWorkspaceActive() && getLocalScope() === owner.current
      ? useChatStore
          .getState()
          .projects.find((project) => project.id === props.project.id)
      : undefined;

  useLayoutEffect(() => {
    if (contents.current) contents.current.inert = !props.open;
    if (props.open) {
      setPresent(true);
      return;
    }
    const timeout = window.setTimeout(() => setPresent(false), 280);
    return () => window.clearTimeout(timeout);
  }, [props.open]);

  const restoreFocus = () => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (
        !active ||
        active === document.body ||
        !active.isConnected ||
        active.closest("[inert]")
      )
        toggle.current?.focus({ preventScroll: true });
    });
  };
  const rename = async () => {
    const project = readProject();
    if (!project) return;
    const name = (await showPrompt("重命名项目", project.name, 1))?.trim();
    if (!name || !readProject()) return;
    const state = useChatStore.getState();
    if (!state.projects.some((project) => project.id === props.project.id))
      return;
    if (!state.renameProject(props.project.id, name))
      showToast(`项目名称不能超过 ${CHAT_PROJECT_NAME_MAX_LENGTH} 个字符`);
    restoreFocus();
  };
  const remove = async () => {
    const project = readProject();
    if (!project) return;
    const confirmed = await showConfirm(
      `删除项目“${project.name}”？其中的会话会移回“对话”，内容会保留。`,
    );
    if (!confirmed || !readProject()) return;
    if (useChatStore.getState().deleteProject(props.project.id))
      props.onDeleted();
  };

  return (
    <Droppable droppableId={chatProjectDropId(props.project.id)}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={clsx(styles.folder, {
            [styles.narrow]: props.narrow,
          })}
          data-project-id={props.project.id}
          data-open={props.open}
          data-current={props.current || undefined}
          data-drag-over={snapshot.isDraggingOver || undefined}
        >
          <div className={styles.row}>
            <button
              ref={toggle}
              type="button"
              className={styles.toggle}
              aria-label={props.project.name}
              title={props.project.name}
              aria-expanded={props.open}
              aria-controls={contentId}
              data-project-toggle
              onClick={props.onToggle}
            >
              <ChevronRight
                className={styles.chevron}
                size={12}
                aria-hidden="true"
              />
              {props.open ? (
                <FolderOpen size={16} aria-hidden="true" />
              ) : (
                <Folder size={16} aria-hidden="true" />
              )}
              <span className={styles.name}>{props.project.name}</span>
              <span className={styles.count} aria-hidden="true">
                {props.count}
              </span>
            </button>
            <button
              ref={menuTrigger}
              type="button"
              className={styles.more}
              aria-label={`项目操作：${props.project.name}`}
              title="项目操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              onClick={(event) => {
                menuKeyboard.current = event.detail === 0 ? "first" : null;
                setMenuOpen((open) => !open);
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
                menuKeyboard.current =
                  event.key === "ArrowUp" ? "last" : "first";
                if (menuOpen) focusMenuEdge(menuId, menuKeyboard.current);
                else setMenuOpen(true);
              }}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
          </div>
          <div
            className={styles.contents}
            id={contentId}
            aria-hidden={!props.open}
          >
            <div ref={contents} className={styles.inner}>
              {present &&
                (props.count ? (
                  <ChatList
                    projectId={props.project.id}
                    narrow={props.narrow}
                    embedded
                  />
                ) : (
                  <button
                    type="button"
                    className={styles["empty-action"]}
                    aria-label={`在${props.project.name}中新建对话`}
                    title="新建对话"
                    onClick={props.onNewChat}
                  >
                    <SquarePen size={15} aria-hidden="true" />
                    <span className={styles.name}>新建对话</span>
                  </button>
                ))}
            </div>
          </div>
          {provided.placeholder}
          <WorkspaceMenu
            id={menuId}
            label={props.project.name}
            open={menuOpen}
            trigger={menuTrigger}
            keyboard={menuKeyboard}
            align="end"
            onClose={closeMenu}
            items={[
              {
                id: "new-chat",
                label: "新建对话",
                icon: <SquarePen />,
                onSelect: () => {
                  if (readProject()) props.onNewChat();
                },
              },
              {
                id: "rename",
                label: "重命名项目",
                icon: <Pencil />,
                onSelect: () => void rename(),
              },
              {
                id: "delete",
                label: "删除项目",
                icon: <Trash2 />,
                destructive: true,
                onSelect: () => void remove(),
              },
            ]}
          />
        </div>
      )}
    </Droppable>
  );
}

export function ChatProjectArea(props: { narrow?: boolean }) {
  const projects = useChatStore((state) => state.projects);
  const hydrated = useChatStore((state) => state._hasHydrated);
  const selector = useMemo(() => createChatListStoreSelector(null), []);
  const { sessions } = useChatStore(selector);
  const currentProjectId = useChatStore(
    (state) => state.sessions[state.currentSessionIndex]?.projectId,
  );
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const session of sessions)
      if (session.projectId)
        result.set(session.projectId, (result.get(session.projectId) ?? 0) + 1);
    return result;
  }, [sessions]);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [conversationsOpen, setConversationsOpen] = useState(true);
  const [openProjects, setOpenProjects] = useState<Set<string>>(
    () => new Set(),
  );
  const [creating, setCreating] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [createError, setCreateError] = useState("");
  const createTrigger = useRef<HTMLButtonElement>(null);
  const createForm = useRef<HTMLFormElement>(null);
  const createInput = useRef<HTMLInputElement>(null);
  const createOwner = useRef<LocalScope>();
  const createIme = useRef(createImeGuard());
  const area = useRef<HTMLDivElement>(null);
  const dragOwner = useRef<LocalScope>();
  const navigate = useNavigate();
  const expandProject = useCallback((id: string) => {
    setOpenProjects((previous) =>
      previous.has(id) ? previous : new Set(previous).add(id),
    );
  }, []);

  useEffect(() => {
    if (currentProjectId) {
      setProjectsOpen(true);
      expandProject(currentProjectId);
    } else {
      setConversationsOpen(true);
    }
  }, [currentProjectId, expandProject]);

  const cancelCreate = useCallback((restoreFocus = true) => {
    createOwner.current = undefined;
    setCreating(false);
    setProjectName("");
    setCreateError("");
    if (restoreFocus)
      requestAnimationFrame(
        () => createTrigger.current?.focus({ preventScroll: true }),
      );
  }, []);
  useLayoutEffect(() => {
    if (createForm.current)
      createForm.current.inert = !creating || !projectsOpen;
    if (!creating || !projectsOpen) return;
    let frame: number;
    const focusInput = () => {
      const input = createInput.current;
      if (!input) return;
      const active = document.activeElement;
      if (
        active !== document.body &&
        active !== createTrigger.current &&
        active !== input
      )
        return;
      // Visibility can settle after the section's first animation frame.
      if (getComputedStyle(input).visibility !== "visible") {
        frame = requestAnimationFrame(focusInput);
        return;
      }
      input.focus({ preventScroll: true });
    };
    frame = requestAnimationFrame(focusInput);
    return () => cancelAnimationFrame(frame);
  }, [creating, projectsOpen]);
  useEffect(() => {
    const invalidate = () => cancelCreate(false);
    window.addEventListener("local-workspace-switch", invalidate);
    window.addEventListener("local-data-maintenance", invalidate);
    return () => {
      window.removeEventListener("local-workspace-switch", invalidate);
      window.removeEventListener("local-data-maintenance", invalidate);
    };
  }, [cancelCreate]);
  const openCreate = () => {
    if (creating) {
      cancelCreate();
      return;
    }
    if (!useChatStore.getState()._hasHydrated || !isLocalWorkspaceActive())
      return;
    createOwner.current = getLocalScope();
    createIme.current = createImeGuard();
    if (props.narrow)
      useAppConfig.getState().update((config) => {
        config.sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
      });
    setProjectsOpen(true);
    setCreating(true);
  };
  const createProject = () => {
    const state = useChatStore.getState();
    if (
      !creating ||
      !state._hasHydrated ||
      !isLocalWorkspaceActive() ||
      createOwner.current !== getLocalScope()
    ) {
      cancelCreate(false);
      return;
    }
    const parsed = chatProjectNameSchema.safeParse(projectName);
    if (!parsed.success) {
      setCreateError(
        projectName.trim()
          ? `项目名称不能超过 ${CHAT_PROJECT_NAME_MAX_LENGTH} 个字符`
          : "请输入项目名称",
      );
      createInput.current?.focus({ preventScroll: true });
      return;
    }
    const id = state.createProject(parsed.data);
    if (!id) return;
    cancelCreate(false);
    expandProject(id);
    requestAnimationFrame(() => {
      const project = Array.from(
        area.current?.querySelectorAll<HTMLElement>("[data-project-id]") ?? [],
      ).find((element) => element.dataset.projectId === id);
      project
        ?.querySelector<HTMLButtonElement>("[data-project-toggle]")
        ?.focus({ preventScroll: true });
    });
  };
  const newChat = (id: string) => {
    const state = useChatStore.getState();
    if (
      !isLocalWorkspaceActive() ||
      !state.projects.some((project) => project.id === id)
    )
      return;
    state.newSession(undefined, id);
    expandProject(id);
    navigate(Path.Chat);
  };
  const projectDeleted = (id: string) => {
    setOpenProjects((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    requestAnimationFrame(() => {
      area.current
        ?.querySelector<HTMLButtonElement>("[data-create-project]")
        ?.focus({ preventScroll: true });
    });
  };

  return (
    <div ref={area} data-narrow={props.narrow || undefined}>
      <DragDropContext
        onDragStart={() => {
          dragOwner.current =
            hydrated && isLocalWorkspaceActive() ? getLocalScope() : undefined;
        }}
        onDragEnd={(result) => {
          const owner = dragOwner.current;
          dragOwner.current = undefined;
          if (!applyChatProjectDrop(result, owner)) return;
          const projectId = projectIdFromDropId(
            result.destination!.droppableId,
          );
          if (projectId) {
            setProjectsOpen(true);
            expandProject(projectId);
          } else {
            setConversationsOpen(true);
          }
        }}
      >
        <SidebarSection
          id="workspace-projects"
          title="项目"
          open={projectsOpen}
          onToggle={() => setProjectsOpen((open) => !open)}
          actions={
            <button
              ref={createTrigger}
              type="button"
              className={styles.create}
              aria-label="新建项目"
              title="新建项目"
              data-create-project
              aria-expanded={creating}
              aria-controls="workspace-project-create"
              disabled={!hydrated}
              onClick={openCreate}
            >
              <Plus size={16} aria-hidden="true" />
            </button>
          }
        >
          <div
            id="workspace-project-create"
            className={styles["create-panel"]}
            data-open={creating}
            aria-hidden={!creating}
          >
            <div className={styles["create-inner"]}>
              <form
                ref={createForm}
                className={styles["create-form"]}
                data-project-create-form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!createIme.current.isComposing({ key: "Enter" }))
                    createProject();
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    createIme.current.blocks(event.nativeEvent)
                  ) {
                    event.preventDefault();
                  } else if (
                    event.key === "Escape" &&
                    !createIme.current.isComposing(event.nativeEvent)
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelCreate();
                  }
                }}
                onKeyUp={(event) =>
                  createIme.current.release(event.nativeEvent)
                }
              >
                <input
                  ref={createInput}
                  className={styles["create-input"]}
                  aria-label="项目名称"
                  placeholder="项目名称"
                  value={projectName}
                  disabled={!creating || !hydrated}
                  aria-invalid={createError ? true : undefined}
                  aria-describedby={
                    createError ? "workspace-project-create-error" : undefined
                  }
                  autoComplete="off"
                  onChange={(event) => {
                    setProjectName(event.currentTarget.value);
                    setCreateError("");
                  }}
                  onCompositionStart={() => createIme.current.start()}
                  onCompositionEnd={() => createIme.current.end()}
                />
                <button
                  className={styles["create-action"]}
                  type="submit"
                  aria-label="确认创建项目"
                  title="创建项目"
                  disabled={!creating || !hydrated}
                >
                  <Check size={16} aria-hidden="true" />
                </button>
                <button
                  className={styles["create-action"]}
                  type="button"
                  aria-label="取消新建项目"
                  title="取消"
                  disabled={!creating}
                  onClick={() => cancelCreate()}
                >
                  <X size={16} aria-hidden="true" />
                </button>
                {createError && (
                  <p
                    id="workspace-project-create-error"
                    className={styles["create-error"]}
                    role="alert"
                  >
                    {createError}
                  </p>
                )}
              </form>
            </div>
          </div>
          {projects.map((project) => (
            <ProjectFolder
              key={project.id}
              project={project}
              count={counts.get(project.id) ?? 0}
              current={currentProjectId === project.id}
              narrow={props.narrow}
              open={openProjects.has(project.id)}
              onToggle={() =>
                setOpenProjects((previous) => {
                  const next = new Set(previous);
                  if (next.has(project.id)) next.delete(project.id);
                  else next.add(project.id);
                  return next;
                })
              }
              onNewChat={() => newChat(project.id)}
              onDeleted={() => projectDeleted(project.id)}
            />
          ))}
        </SidebarSection>
        <Droppable droppableId={chatProjectDropId()}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={styles.conversations}
              data-drag-over={snapshot.isDraggingOver || undefined}
            >
              <SidebarSection
                id="workspace-conversations"
                title="对话"
                open={conversationsOpen}
                onToggle={() => setConversationsOpen((open) => !open)}
              >
                <ChatList narrow={props.narrow} embedded />
              </SidebarSection>
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );
}
