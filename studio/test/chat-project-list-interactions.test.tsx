import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { ChatProject, ChatSession } from "../app/store/chat";

type State = {
  projects: ChatProject[];
  sessions: ChatSession[];
  currentSessionIndex: number;
  _hasHydrated: boolean;
  createProject: (name: string) => string | undefined;
  renameProject: (id: string, name: string) => boolean;
  deleteProject: (id: string) => boolean;
  newSession: (mask?: unknown, projectId?: string) => void;
};
const createProject = jest.fn<State["createProject"]>();
const renameProject = jest.fn<State["renameProject"]>();
const deleteProject = jest.fn<State["deleteProject"]>();
const newSession = jest.fn<State["newSession"]>();
const navigate = jest.fn();
const prompt = jest.fn<(...args: any[]) => Promise<string | null>>();
const confirm = jest.fn<(...args: any[]) => Promise<boolean>>();
const toast = jest.fn();
const updateConfig =
  jest.fn<(updater: (config: { sidebarWidth: number }) => void) => void>();
let owner = "user-7";
let active = true;
let sidebarWidth = 72;

function initialState(): State {
  return {
    projects: [
      { id: "project-one", name: "Project one", createdAt: 1 },
      { id: "project-two", name: "Project two", createdAt: 2 },
    ],
    sessions: [
      {
        id: "current-chat",
        topic: "Current chat",
        messages: [],
        lastUpdate: 0,
        mask: {
          avatar: "gpt-bot",
          modelConfig: { model: "fixture" },
        } as ChatSession["mask"],
        memoryPrompt: "",
        lastSummarizeIndex: 0,
        stat: { charCount: 0, tokenCount: 0, wordCount: 0 },
      },
    ],
    currentSessionIndex: 0,
    _hasHydrated: true,
    createProject,
    renameProject,
    deleteProject,
    newSession,
  };
}
const chatStore = createStore<State>(() => initialState());

jest.unstable_mockModule("@/app/store", () => ({
  useChatStore: Object.assign(
    (selector: (state: State) => unknown) => useStore(chatStore, selector),
    { getState: chatStore.getState },
  ),
  useAppConfig: { getState: () => ({ update: updateConfig }) },
}));
jest.unstable_mockModule("@/app/components/chat-list", () => ({
  ChatList: () => <div />,
}));
jest.unstable_mockModule("@hello-pangea/dnd", () => ({
  DragDropContext: ({ children }: { children: React.ReactNode }) => children,
  Droppable: ({
    children,
  }: {
    children: (...args: any[]) => React.ReactNode;
  }) =>
    children(
      { innerRef: () => {}, droppableProps: {}, placeholder: null },
      { isDraggingOver: false },
    ),
}));
jest.unstable_mockModule("react-router-dom", () => ({
  useNavigate: () => navigate,
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => owner,
  isLocalWorkspaceActive: () => active,
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showPrompt: prompt,
  showConfirm: confirm,
  showToast: toast,
}));
jest.unstable_mockModule("@/app/utils/use-anchored-panel", () => ({
  useAnchoredPanel: () => ({
    position: "fixed",
    left: 100,
    top: 40,
    width: 216,
    visibility: "visible",
  }),
}));

const { ChatProjectArea } = await import("../app/components/chat-project-list");

function setup(narrow = false) {
  return render(
    <>
      <textarea aria-label="Current draft" defaultValue="Keep this draft" />
      <button type="button">Outside control</button>
      <ChatProjectArea narrow={narrow} />
    </>,
  );
}
function createTrigger() {
  return screen.getByRole("button", { name: "新建项目" });
}
function projectInput() {
  return screen.getByRole("textbox", { name: "项目名称" });
}
function openCreate(value = "") {
  fireEvent.click(createTrigger());
  const input = projectInput();
  if (value) fireEvent.change(input, { target: { value } });
  return input;
}
function submitCreate() {
  fireEvent.click(screen.getByRole("button", { name: "确认创建项目" }));
}
function openProjectMenu(name = "Project one") {
  const trigger = screen.getByRole("button", { name: `项目操作：${name}` });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  return trigger;
}

beforeEach(() => {
  owner = "user-7";
  active = true;
  sidebarWidth = 72;
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{ width: 100, height: 32 }] as unknown as DOMRectList);
  createProject.mockReset().mockImplementation((name) => {
    const id = "created-project";
    chatStore.setState((state) => ({
      projects: [...state.projects, { id, name, createdAt: 3 }],
    }));
    return id;
  });
  renameProject.mockReset().mockImplementation((id, name) => {
    chatStore.setState((state) => ({
      projects: state.projects.map((project) =>
        project.id === id ? { ...project, name } : project,
      ),
    }));
    return true;
  });
  deleteProject.mockReset().mockImplementation((id) => {
    chatStore.setState((state) => ({
      projects: state.projects.filter((project) => project.id !== id),
    }));
    return true;
  });
  newSession.mockReset();
  navigate.mockReset();
  prompt.mockReset().mockResolvedValue(null);
  confirm.mockReset().mockResolvedValue(true);
  toast.mockReset();
  updateConfig.mockReset().mockImplementation((updater) => {
    const config = { sidebarWidth };
    updater(config);
    sidebarWidth = config.sidebarWidth;
  });
  chatStore.setState(initialState(), true);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test("the narrow project plus expands the sidebar and opens a focused inline input without a dialog", async () => {
  setup(true);
  const input = openCreate();
  await waitFor(() => expect(input).toHaveFocus());
  expect(input.closest("form")).toHaveAttribute("data-project-create-form");
  expect(createTrigger()).toHaveAttribute("aria-expanded", "true");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(prompt).not.toHaveBeenCalled();
  expect(updateConfig).toHaveBeenCalledTimes(1);
  expect(sidebarWidth).toBe(300);
});

test("creation waits for the input to become visible before focusing it", async () => {
  setup();
  const input = openCreate();
  input.style.visibility = "hidden";
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(input).not.toHaveFocus();
  input.style.visibility = "visible";
  await waitFor(() => expect(input).toHaveFocus());
});

test("successful creation trims the name, expands and focuses its folder without switching chat or draft", async () => {
  setup();
  const original = chatStore.getState().sessions[0];
  openCreate("  Research  ");
  submitCreate();
  expect(createProject).toHaveBeenCalledWith("Research");
  const folder = screen.getByRole("button", { name: "Research" });
  expect(folder).toHaveAttribute("aria-expanded", "true");
  await waitFor(() => expect(folder).toHaveFocus());
  expect(createTrigger()).toHaveAttribute("aria-expanded", "false");
  expect(chatStore.getState().sessions[0]).toBe(original);
  expect(chatStore.getState().currentSessionIndex).toBe(0);
  expect(screen.getByRole("textbox", { name: "Current draft" })).toHaveValue(
    "Keep this draft",
  );
  expect(newSession).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});

test.each(["escape", "cancel"])(
  "%s cancels inline creation and restores focus to the project plus",
  async (action) => {
    setup();
    const input = openCreate("Unsubmitted project");
    if (action === "escape") fireEvent.keyDown(input, { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: "取消新建项目" }));
    expect(createTrigger()).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(createTrigger()).toHaveFocus());
    expect(createProject).not.toHaveBeenCalled();
  },
);

test("invalid blank and overlong names remain editable with a clear error", () => {
  setup();
  const input = openCreate("  ");
  submitCreate();
  expect(screen.getByRole("alert")).toHaveTextContent("请输入项目名称");
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "x".repeat(81) } });
  submitCreate();
  expect(screen.getByRole("alert")).toHaveTextContent("80");
  expect(createProject).not.toHaveBeenCalled();
});

test("hydration and the owner captured when opening protect project creation", () => {
  chatStore.setState({ _hasHydrated: false });
  setup();
  expect(createTrigger()).toBeDisabled();
  fireEvent.click(createTrigger());
  expect(screen.queryByRole("textbox", { name: "项目名称" })).toBeNull();
  expect(createProject).not.toHaveBeenCalled();
  act(() => chatStore.setState({ _hasHydrated: true }));
  openCreate("Old owner project");
  owner = "user-8";
  submitCreate();
  expect(createProject).not.toHaveBeenCalled();
  expect(createTrigger()).toHaveAttribute("aria-expanded", "false");
});

test("a form submission during composition is ignored and a completed composition can submit", () => {
  setup();
  const input = openCreate("中文项目");
  const form = input.closest("form")!;
  for (const metadata of [
    { key: "Enter", isComposing: true },
    { key: "Enter", keyCode: 229 },
  ])
    expect(fireEvent.keyDown(input, metadata)).toBe(false);
  expect(createProject).not.toHaveBeenCalled();
  fireEvent.compositionStart(input);
  fireEvent.submit(form);
  expect(createProject).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyUp(input, { key: "Enter", keyCode: 13 });
  fireEvent.submit(form);
  expect(createProject).toHaveBeenCalledTimes(1);
  expect(createProject).toHaveBeenCalledWith("中文项目");
});

test("new conversation uses the chosen project only after its menu closes", async () => {
  setup();
  newSession.mockImplementation(() => {
    expect(screen.queryByRole("menu", { name: "Project one" })).toBeNull();
  });
  const trigger = openProjectMenu();
  const menu = screen.getByRole("menu", { name: "Project one" });
  expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  expect(menu).toHaveAttribute("id", trigger.getAttribute("aria-controls"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: "新建对话" }));
  await waitFor(() =>
    expect(newSession).toHaveBeenCalledWith(undefined, "project-one"),
  );
  expect(navigate).toHaveBeenCalledWith("/chat");
});

test("an old project's pending rename cannot write after its workspace changes", async () => {
  setup();
  let resolveName!: (value: string) => void;
  prompt.mockReturnValue(
    new Promise<string>((resolve) => {
      resolveName = resolve;
    }),
  );
  openProjectMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "重命名项目" }));
  await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  owner = "user-8";
  await act(async () => resolveName("Changed later"));
  expect(renameProject).not.toHaveBeenCalled();
});
