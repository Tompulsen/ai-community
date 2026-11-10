import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { createRequire } from "node:module";
import { create } from "zustand";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import type { DropResult, OnDragEndResponder } from "@hello-pangea/dnd";
import type { ChatProject, ChatSession } from "../app/store/chat";
import { createChatListSummarySelector } from "../app/utils/chat-list-summary";

const actualDnd = createRequire(import.meta.url)(
  "@hello-pangea/dnd",
) as typeof import("@hello-pangea/dnd");
let finishDrag: OnDragEndResponder | undefined;
jest.unstable_mockModule("@hello-pangea/dnd", () => ({
  ...actualDnd,
  DragDropContext: (
    props: React.ComponentProps<typeof actualDnd.DragDropContext>,
  ) => {
    finishDrag = props.onDragEnd;
    return <actualDnd.DragDropContext {...props} />;
  },
}));

function session(id: string, topic: string, count: number): ChatSession {
  return {
    id,
    topic,
    messages: Array.from({ length: count }, (_, index) => ({
      id: `${id}-${index}`,
      role: "user" as const,
      content: "Original body",
      date: "2026-11-03",
    })),
    lastUpdate: new Date("2026-11-03T08:30:00Z").getTime(),
    mask: {
      avatar: `avatar-${id}`,
      modelConfig: { model: `model-${id}` },
    } as ChatSession["mask"],
    memoryPrompt: "",
    lastSummarizeIndex: 0,
    stat: { charCount: 0, tokenCount: 0, wordCount: 0 },
  };
}

type ChatState = {
  sessions: ChatSession[];
  projects: ChatProject[];
  currentSessionIndex: number;
  selectSession: (index: number) => void;
  moveSession: (from: number, to: number) => void;
  moveSessionsToProject: (ids: string[], projectId?: string) => boolean;
  createProject: (name: string) => string | undefined;
  deleteSessions: (ids: string[]) => void;
};

let undoDelete: (() => void) | undefined;
const selectSession = jest.fn<(index: number) => void>((index) => {
  useChatStore.setState({ currentSessionIndex: index });
});
const moveSession = jest.fn<(from: number, to: number) => void>((from, to) => {
  const sessions = useChatStore.getState().sessions.slice();
  const [moving] = sessions.splice(from, 1);
  sessions.splice(to, 0, moving);
  useChatStore.setState({ sessions });
});
const moveSessionsToProject = jest.fn<
  (ids: string[], projectId?: string) => boolean
>((ids, projectId) => {
  if (
    projectId &&
    !useChatStore
      .getState()
      .projects.some((project) => project.id === projectId)
  )
    return false;
  useChatStore.setState((state) => ({
    sessions: state.sessions.map((entry) =>
      ids.includes(entry.id) ? { ...entry, projectId } : entry,
    ),
  }));
  return true;
});
const createProject = jest.fn<(name: string) => string | undefined>((name) => {
  const id = `project-${name}`;
  useChatStore.setState((state) => ({
    projects: [...state.projects, { id, name, createdAt: Date.now() }],
  }));
  return id;
});
const deleteSessions = jest.fn<(ids: string[]) => void>((ids) => {
  const state = useChatStore.getState();
  undoDelete = () =>
    useChatStore.setState({
      sessions: state.sessions,
      currentSessionIndex: state.currentSessionIndex,
    });
  const remaining = state.sessions.filter((entry) => !ids.includes(entry.id));
  useChatStore.setState({
    sessions: remaining.length ? remaining : [session("blank", "New chat", 0)],
    currentSessionIndex: 0,
  });
});
const useChatStore = create<ChatState>(() => ({
  sessions: [],
  projects: [],
  currentSessionIndex: 0,
  selectSession,
  moveSession,
  moveSessionsToProject,
  createProject,
  deleteSessions,
}));
const avatarRenders = jest.fn(
  ({ avatar, model }: { avatar: string; model?: string }) => (
    <span data-testid={`avatar-${avatar}`}>{`${avatar}/${model}`}</span>
  ),
);
const confirm = jest.fn<(message: string) => Promise<boolean>>();
const prompt = jest.fn<() => Promise<string | null>>();
const toast = jest.fn();
let workspaceScope = "workspace-a";
let workspaceActive = true;
jest.unstable_mockModule("@/app/store", () => ({ useChatStore }));
jest.unstable_mockModule("@/app/components/mask-avatar", () => ({
  MaskAvatar: avatarRenders,
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showConfirm: confirm,
  showPrompt: prompt,
  showToast: toast,
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => workspaceScope,
  isLocalWorkspaceActive: () => workspaceActive,
}));
jest.unstable_mockModule("@/app/utils/use-anchored-panel", () => ({
  useAnchoredPanel: () => ({
    position: "fixed",
    left: 120,
    top: 40,
    width: 216,
    visibility: "visible",
  }),
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    Chat: {
      InputActions: { More: "More", ChatSettings: "Chat settings" },
    },
    ChatItem: {
      ChatItemCount: (count: number) => `${count} messages`,
      SelectChat: (title: string) => `Select ${title}`,
      Favorite: "Favorite",
      Unfavorite: "Unfavorite",
      SelectedCount: (count: number) => `${count} selected`,
      SelectAll: "Select all",
      DeselectAll: "Deselect all",
      DeleteSelected: "Delete selected",
      DeleteConfirm: (count: number) => `Delete ${count} selected chats?`,
    },
    Home: { DeleteChat: "Delete chat" },
    UI: { Cancel: "Cancel" },
  },
}));
const { ChatList } = await import("../app/components/chat-list");
const { promptCreateChatProject } = await import(
  "../app/components/chat-project-actions"
);

const originalScroll = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
const originalShowModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const originalClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: jest.fn(),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterAll(() => {
  if (originalScroll)
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScroll,
    );
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  for (const [name, descriptor] of [
    ["showModal", originalShowModal],
    ["close", originalClose],
  ] as const) {
    if (descriptor)
      Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});
beforeEach(() => {
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{ width: 100, height: 30 }] as unknown as DOMRectList);
  useChatStore.setState({
    sessions: [
      session("first", "First", 1),
      session("second", "Second", 2),
      session("third", "Third", 3),
    ],
    currentSessionIndex: 0,
    projects: [
      { id: "project-a", name: "Writing", createdAt: 1 },
      { id: "project-b", name: "Research", createdAt: 2 },
    ],
  });
  avatarRenders.mockClear();
  selectSession.mockClear();
  moveSession.mockClear();
  moveSessionsToProject.mockClear();
  createProject.mockClear();
  deleteSessions.mockClear();
  confirm.mockReset().mockResolvedValue(true);
  prompt.mockReset().mockResolvedValue(null);
  toast.mockClear();
  workspaceScope = "workspace-a";
  workspaceActive = true;
  document.body.classList.add("reduce-motion");
  undoDelete = undefined;
  finishDrag = undefined;
});
afterEach(() => {
  document.body.classList.remove("reduce-motion");
  jest.restoreAllMocks();
});

function LocationControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <output data-testid="location">{location.pathname}</output>
      <button onClick={() => navigate("/gallery")}>Open gallery</button>
    </>
  );
}

function setup(narrow = true, projectId?: string) {
  return render(
    <MemoryRouter initialEntries={["/chat"]}>
      <ChatList narrow={narrow} projectId={projectId} />
      <LocationControls />
    </MemoryRouter>,
  );
}

async function runChatAction(title: string, label: string) {
  fireEvent.click(screen.getByRole("button", { name: `More\uFF1A${title}` }));
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
  });
}

async function selectChat(title: string) {
  await runChatAction(title, `Select ${title}`);
}

test("streamed body and reasoning changes do not render conversation rows", () => {
  setup();
  expect(avatarRenders).toHaveBeenCalled();
  avatarRenders.mockClear();
  act(() => {
    const state = useChatStore.getState();
    state.sessions[0].messages[0].content = "Streamed body";
    state.sessions[0].messages[0].reasoning = "Streamed reasoning";
    useChatStore.setState({
      sessions: state.sessions.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              messages: entry.messages.slice(),
              mask: {
                ...entry.mask,
                modelConfig: { ...entry.mask.modelConfig },
              },
            }
          : entry,
      ),
    });
  });
  expect(avatarRenders).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "First" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("in-place summary edits refresh only their row, including narrow avatars", () => {
  const result = setup();
  avatarRenders.mockClear();
  const updatedTime = new Date("2026-11-02T04:25:00Z").getTime();
  act(() => {
    const state = useChatStore.getState();
    const entry = state.sessions[1];
    entry.topic = "Updated second";
    entry.messages.push({ ...entry.messages[0], id: "new-message" });
    entry.lastUpdate = updatedTime;
    entry.favorite = true;
    entry.mask.avatar = "updated-avatar";
    entry.mask.modelConfig.model = "updated-model";
    useChatStore.setState({ sessions: state.sessions });
  });
  expect(avatarRenders).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("avatar-updated-avatar")).toHaveTextContent(
    "updated-avatar/updated-model",
  );
  const row = screen.getByRole("button", { name: "Updated second" });
  expect(row).toHaveTextContent("3");
  result.rerender(
    <MemoryRouter initialEntries={["/chat"]}>
      <ChatList />
      <LocationControls />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("button", { name: "Updated second" }),
  ).toHaveTextContent("3 messages");
  expect(row.querySelector("time")).toHaveAttribute(
    "datetime",
    new Date(updatedTime).toISOString(),
  );
  expect(row.querySelector("time")).toHaveAttribute(
    "title",
    new Date(updatedTime).toLocaleString(),
  );
});

test("selection, cancelled project movement, deletion and undo keep their controls", async () => {
  setup();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await selectChat("Second");
  expect(
    screen.getByRole("toolbar", { name: "1 selected" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(selectSession).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: /^More/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Second" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "Third" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: "Third" }));
  expect(
    screen.getByRole("toolbar", { name: "2 selected" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Third" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Third" }));
  fireEvent.click(screen.getByRole("button", { name: "移至项目" }));
  expect(screen.getByRole("dialog", { name: "移至项目" })).toBeInTheDocument();
  fireEvent.click(
    screen
      .getByRole("dialog", { name: "移至项目" })
      .querySelector("button:last-child")!,
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(moveSessionsToProject).not.toHaveBeenCalled();
  expect(
    screen.getByRole("toolbar", { name: "1 selected" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  expect(
    screen.getByRole("toolbar", { name: "3 selected" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
  await waitFor(() => expect(deleteSessions).toHaveBeenCalledTimes(1));
  expect(deleteSessions).toHaveBeenCalledWith(["first", "second", "third"]);
  expect(screen.queryByRole("toolbar")).toBeNull();
  act(() => undoDelete!());
  expect(screen.getByRole("button", { name: "Second" })).toBeInTheDocument();
  await selectChat("First");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("toolbar")).toBeNull();
});

test("project selectors preserve global indices and track in-place moves", () => {
  const all = createChatListSummarySelector(null);
  const unassigned = createChatListSummarySelector();
  const writing = createChatListSummarySelector("project-a");
  const state = useChatStore.getState();
  state.sessions[1].projectId = "project-a";
  state.sessions[2].projectId = "project-a";
  state.currentSessionIndex = 2;
  const allSnapshot = all(state);
  expect(allSnapshot.sessions).toHaveLength(3);
  expect(allSnapshot.selectedIndex).toBe(2);
  const filtered = writing(state);
  expect(filtered.sessions.map((item) => [item.id, item.index])).toEqual([
    ["second", 1],
    ["third", 2],
  ]);
  expect(filtered.selectedIndex).toBe(1);
  expect(unassigned(state).sessions.map((item) => item.id)).toEqual(["first"]);
  expect(unassigned(state).selectedIndex).toBe(-1);
  state.sessions[1].projectId = undefined;
  expect(writing(state).sessions.map((item) => item.id)).toEqual(["third"]);
  expect(writing(state).selectedIndex).toBe(0);
  expect(unassigned(state).sessions.map((item) => item.id)).toEqual([
    "first",
    "second",
  ]);
});

test("project rows select global sessions and drag only their filtered peers", () => {
  useChatStore.setState((state) => ({
    sessions: state.sessions.map((entry, index) =>
      index ? { ...entry, projectId: "project-a" } : entry,
    ),
    currentSessionIndex: 2,
  }));
  setup(false, "project-a");
  expect(
    screen.queryByRole("button", { name: "First" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Third" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "Second" }), {
    key: "Enter",
    keyCode: 13,
  });
  expect(selectSession).toHaveBeenLastCalledWith(1);
  const complete = finishDrag!;
  act(() => {
    complete(
      {
        draggableId: "second",
        type: "DEFAULT",
        source: { droppableId: "chat-list:project:project-a", index: 0 },
        destination: { droppableId: "chat-list:project:project-a", index: 1 },
        reason: "DROP",
        mode: "FLUID",
        combine: null,
      } satisfies DropResult,
      { announce: jest.fn() },
    );
  });
  expect(moveSession).toHaveBeenLastCalledWith(1, 2);
});

test("batch movement uses the chosen project and preserves legacy favorite data", async () => {
  useChatStore.setState((state) => ({
    sessions: state.sessions.map((entry) => ({ ...entry, favorite: true })),
  }));
  setup(false);
  await selectChat("Second");
  fireEvent.click(screen.getByRole("button", { name: "移至项目" }));
  fireEvent.click(screen.getByRole("button", { name: "Writing" }));
  await waitFor(() =>
    expect(moveSessionsToProject).toHaveBeenCalledWith(["second"], "project-a"),
  );
  expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Second" }),
  ).not.toBeInTheDocument();
  expect(useChatStore.getState().sessions[1].favorite).toBe(true);
});

test("a conversation can leave a project without deleting its messages", async () => {
  useChatStore.setState((state) => ({
    sessions: state.sessions.map((entry) => ({
      ...entry,
      projectId: "project-a",
    })),
  }));
  setup(false, "project-a");
  await runChatAction("Second", "移出项目");
  await waitFor(() =>
    expect(moveSessionsToProject).toHaveBeenCalledWith(["second"]),
  );
  expect(useChatStore.getState().sessions[1].messages).toHaveLength(2);
  expect(useChatStore.getState().sessions[1].projectId).toBeUndefined();
});

test("a project choice cannot move a removed conversation or a different workspace", async () => {
  setup(false);
  await runChatAction("Second", "移至项目");
  act(() =>
    useChatStore.setState((state) => ({
      sessions: state.sessions.filter((entry) => entry.id !== "second"),
    })),
  );
  fireEvent.click(screen.getByRole("button", { name: "Writing" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(moveSessionsToProject).not.toHaveBeenCalled();
  await runChatAction("Third", "移至项目");
  workspaceScope = "workspace-b";
  fireEvent.click(screen.getByRole("button", { name: "Writing" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(moveSessionsToProject).not.toHaveBeenCalled();
});

test("a project removed during the selection exit is not used as a destination", async () => {
  setup(false);
  await runChatAction("Second", "移至项目");
  document.body.classList.remove("reduce-motion");
  fireEvent.click(screen.getByRole("button", { name: "Writing" }));
  act(() =>
    useChatStore.setState((state) => ({
      projects: state.projects.filter((project) => project.id !== "project-a"),
    })),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(moveSessionsToProject).not.toHaveBeenCalled();
  expect(useChatStore.getState().sessions[1].projectId).toBeUndefined();
});

test("project creation ignores a prompt result after switching workspace", async () => {
  let resolvePrompt!: (value: string | null) => void;
  prompt.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolvePrompt = resolve;
      }),
  );
  const creation = promptCreateChatProject();
  await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  workspaceScope = "workspace-b";
  resolvePrompt("Writing");
  expect(await creation).toBeUndefined();
  expect(createProject).not.toHaveBeenCalled();
});

test("project creation reports an overlong name without submitting it", async () => {
  prompt.mockResolvedValueOnce("x".repeat(81));
  expect(await promptCreateChatProject()).toBeUndefined();
  expect(createProject).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith("项目名称最多 80 个字符");
});

test("an old project row cannot move a new workspace's matching conversation", async () => {
  useChatStore.setState((state) => ({
    sessions: state.sessions.map((entry) => ({
      ...entry,
      projectId: "project-a",
    })),
  }));
  setup(false, "project-a");
  workspaceScope = "workspace-b";
  await runChatAction("Second", "移出项目");
  expect(moveSessionsToProject).not.toHaveBeenCalled();
});

test("embedded lists share their parent's drag context and droppable", () => {
  render(
    <MemoryRouter>
      <actualDnd.DragDropContext onDragEnd={jest.fn()}>
        <actualDnd.Droppable droppableId="chat-list:unassigned">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps}>
              <ChatList embedded />
              {provided.placeholder}
            </div>
          )}
        </actualDnd.Droppable>
      </actualDnd.DragDropContext>
    </MemoryRouter>,
  );
  expect(document.querySelectorAll("[data-rfd-droppable-id]")).toHaveLength(1);
  expect(document.querySelectorAll("[data-rfd-draggable-id]")).toHaveLength(3);
  expect(finishDrag).toBeUndefined();
});

test("menu deletion confirms and supports undo without opening the conversation", async () => {
  setup();
  confirm.mockResolvedValueOnce(false);
  await runChatAction("Second", "Delete chat");
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(deleteSessions).not.toHaveBeenCalled();
  await runChatAction("Second", "Delete chat");
  await waitFor(() => expect(deleteSessions).toHaveBeenCalledWith(["second"]));
  expect(
    screen.queryByRole("button", { name: "Second" }),
  ).not.toBeInTheDocument();
  expect(selectSession).not.toHaveBeenCalled();
  act(() => undoDelete!());
  expect(screen.getByRole("button", { name: "Second" })).toBeInTheDocument();
});

test("drag completion finds the current source and destination by conversation id", () => {
  setup();
  const complete = finishDrag!;
  act(() => {
    useChatStore.setState((state) => ({
      sessions: [session("inserted", "Inserted", 0), ...state.sessions],
      currentSessionIndex: 1,
    }));
  });
  act(() => {
    complete(
      {
        draggableId: "second",
        type: "DEFAULT",
        source: { droppableId: "chat-list", index: 1 },
        destination: { droppableId: "chat-list", index: 0 },
        reason: "DROP",
        mode: "FLUID",
        combine: null,
      } satisfies DropResult,
      { announce: jest.fn() },
    );
  });
  expect(moveSession).toHaveBeenLastCalledWith(2, 1);
  expect(useChatStore.getState().sessions.map((entry) => entry.id)).toEqual([
    "inserted",
    "second",
    "first",
    "third",
  ]);
});

test("route highlighting and Enter selection follow the current conversation index", () => {
  setup(false);
  fireEvent.click(screen.getByRole("button", { name: "Open gallery" }));
  expect(screen.getByRole("button", { name: "First" })).not.toHaveAttribute(
    "aria-current",
  );
  act(() => {
    useChatStore.setState((state) => ({
      sessions: [session("inserted", "Inserted", 0), ...state.sessions],
      currentSessionIndex: 1,
    }));
  });
  const second = screen.getByRole("button", { name: "Second" });
  fireEvent.keyDown(second, { key: "Enter", keyCode: 13 });
  expect(selectSession).toHaveBeenLastCalledWith(2);
  expect(screen.getByTestId("location")).toHaveTextContent("/chat");
  expect(second).toHaveAttribute("aria-current", "page");
});
