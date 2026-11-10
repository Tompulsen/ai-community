/** @jest-environment node */

import { jest } from "@jest/globals";
import { createStore } from "zustand/vanilla";
import type { ChatSession } from "../app/store/chat";
import {
  CHAT_PROJECT_NAME_MAX_LENGTH,
  normalizeChatProjects,
  normalizeChatProjectSessions,
} from "../app/utils/chat-projects";

let active = true;
let owner = "user-7";
let persistence: {
  version: number;
  migrate: (state: any, version: number) => any;
  merge: (state: any, current: any) => any;
};
const toast = jest.fn<(...args: any[]) => void>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => null, setItem() {}, removeItem() {} },
});
jest.unstable_mockModule("@/app/utils/store", () => ({
  createPersistStore: (
    initial: object,
    methods: (set: any, get: any) => object,
    options: typeof persistence & { name: string },
  ) => {
    if (options.name === "chat-next-web-store") persistence = options;
    return createStore((set, get) => ({
      ...initial,
      ...methods(set, get),
    }));
  },
}));
jest.unstable_mockModule("@/app/utils", () => ({
  getMessageTextContent: (message: { content: string }) => message.content,
  isDalle3: () => false,
  isVisionModelCheck: () => false,
  isImageModelCheck: () => false,
  shouldUseImageGenerationApi: () => false,
  safeLocalStorage: () => globalThis.localStorage,
}));
jest.unstable_mockModule("@/app/config/client", () => ({
  getClientConfig: () => ({}),
}));
jest.unstable_mockModule("@/app/utils/indexedDB-storage", () => ({
  indexedDBStorage: {},
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => owner,
  getLocalTokenId: () => null,
  isLocalWorkspaceActive: () => active,
  localKey: (key: string, scope = owner) => `octopus:${scope}:${key}`,
  beginLocalMaintenance: () => {},
  endLocalMaintenance: () => {},
  initializeLocalWorkspace: async () => owner,
  trackLocalWrite: (write: unknown) => write,
}));
jest.unstable_mockModule("@/app/client/api", () => ({
  getClientApi: () => ({ llm: { chat: jest.fn() } }),
  detectBase64Mime: jest.fn(),
  getHeaders: () => ({}),
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showToast: toast,
}));
jest.unstable_mockModule("@/app/client/image-generation", () => ({
  getImageGenerationService: () => ({
    setCallbacks: jest.fn(),
    generateImage: jest.fn(),
  }),
}));
jest.unstable_mockModule("@/app/store/access", () => ({
  useAccessStore: { getState: () => ({}) },
}));
jest.unstable_mockModule("@/app/store/skills", () => ({
  useSkillStore: { getState: () => ({ installed: {} }) },
}));
jest.unstable_mockModule("@/app/store/model-preferences", () => ({
  useModelPreferenceStore: {
    getState: () => ({ _hasHydrated: true, overrides: {} }),
  },
  waitForModelPreferences: async () => {},
}));
jest.unstable_mockModule("@/app/store/gallery", () => ({
  addImage: jest.fn(),
  getImageBlob: jest.fn(),
  getGallerySettings: async () => ({ autoSave: false }),
  trimToMaxCount: jest.fn(),
  clearAllImages: jest.fn(),
  dataURLtoBlob: jest.fn(),
}));
jest.unstable_mockModule("@/app/mcp/actions", () => ({
  executeMcpAction: jest.fn(),
  getAllTools: async () => [],
  isMcpEnabled: async () => false,
}));

const { useChatStore } = await import("../app/store/chat");
const { ChatControllerPool } = await import("../app/client/controller");

function addSession(projectId?: string): ChatSession {
  useChatStore.getState().newSession(undefined, projectId);
  return useChatStore.getState().currentSession();
}

beforeEach(() => {
  active = true;
  owner = "user-7";
  toast.mockClear();
  ChatControllerPool.stopAll();
  useChatStore.setState({
    sessions: [],
    projects: [],
    currentSessionIndex: 0,
  });
  addSession();
});

test("project names are trimmed and invalid names do not change state", () => {
  const id = useChatStore.getState().createProject("  Research  ");
  expect(useChatStore.getState().projects).toEqual([
    { id, name: "Research", createdAt: expect.any(Number) },
  ]);
  const projects = useChatStore.getState().projects;
  expect(useChatStore.getState().createProject("  ")).toBeUndefined();
  expect(
    useChatStore
      .getState()
      .createProject("x".repeat(CHAT_PROJECT_NAME_MAX_LENGTH + 1)),
  ).toBeUndefined();
  expect(useChatStore.getState().projects).toBe(projects);
  expect(
    useChatStore
      .getState()
      .createProject("x".repeat(CHAT_PROJECT_NAME_MAX_LENGTH)),
  ).toEqual(expect.any(String));
});

test("renaming a project keeps its identity and validates the new name", () => {
  const store = useChatStore.getState();
  const id = store.createProject("Original")!;
  const project = useChatStore.getState().projects[0];
  expect(store.renameProject(id, "  Renamed  ")).toBe(true);
  expect(useChatStore.getState().projects[0]).toEqual({
    ...project,
    name: "Renamed",
  });
  const renamed = useChatStore.getState().projects;
  expect(store.renameProject(id, "Renamed")).toBe(true);
  expect(useChatStore.getState().projects).toBe(renamed);
  expect(store.renameProject(id, "")).toBe(false);
  expect(store.renameProject("missing", "Valid")).toBe(false);
});

test("deleting a project unfiles its conversations and preserves other references", () => {
  const store = useChatStore.getState();
  const first = store.createProject("First")!;
  const second = store.createProject("Second")!;
  const unfiled = store.currentSession();
  const assigned = addSession(first);
  const other = addSession(second);
  const before = useChatStore.getState();
  expect(before.deleteProject(first)).toBe(true);
  const after = useChatStore.getState();
  expect(after.projects.map((project) => project.id)).toEqual([second]);
  expect(after.sessions).toHaveLength(3);
  expect(after.currentSessionIndex).toBe(before.currentSessionIndex);
  expect(after.currentSession()).toBe(other);
  expect(after.sessions.find((session) => session.id === other.id)).toBe(other);
  expect(after.sessions.find((session) => session.id === unfiled.id)).toBe(
    unfiled,
  );
  const moved = after.sessions.find((session) => session.id === assigned.id)!;
  expect(moved).not.toBe(assigned);
  expect(moved.projectId).toBeUndefined();
  expect(moved.messages).toBe(assigned.messages);
  expect(after.deleteProject(first)).toBe(false);
});

test("moving conversations validates the target and can move them back to unfiled", () => {
  const store = useChatStore.getState();
  const id = store.createProject("Project")!;
  const first = store.currentSession();
  const second = addSession();
  const before = useChatStore.getState().sessions;
  expect(store.moveSessionsToProject([first.id], "missing")).toBe(false);
  expect(useChatStore.getState().sessions).toBe(before);
  expect(store.moveSessionsToProject([first.id, "missing"], id)).toBe(true);
  const moved = useChatStore.getState().sessions;
  expect(moved.find((session) => session.id === first.id)?.projectId).toBe(id);
  expect(moved.find((session) => session.id === second.id)).toBe(second);
  expect(store.moveSessionsToProject([first.id], id)).toBe(true);
  expect(useChatStore.getState().sessions).toBe(moved);
  expect(store.moveSessionsToProject([first.id])).toBe(true);
  expect(
    useChatStore.getState().sessions.find((session) => session.id === first.id),
  ).not.toHaveProperty("projectId");
});

test("new and forked conversations inherit only valid project assignments", () => {
  const store = useChatStore.getState();
  const id = store.createProject("Project")!;
  const source = addSession(id);
  expect(source.projectId).toBe(id);
  store.forkSession();
  const fork = useChatStore.getState().currentSession();
  expect(fork.projectId).toBe(id);
  expect(fork.id).not.toBe(source.id);
  expect(addSession("deleted-project").projectId).toBeUndefined();
});

test("reset retains the project and clearing all conversations also clears projects", () => {
  const store = useChatStore.getState();
  const id = store.createProject("Project")!;
  const source = addSession(id);
  store.resetSession(source);
  expect(useChatStore.getState().currentSession().projectId).toBe(id);
  store.clearSessions();
  expect(useChatStore.getState().projects).toEqual([]);
  expect(useChatStore.getState().sessions).toHaveLength(1);
  expect(useChatStore.getState().currentSession().projectId).toBeUndefined();
});

test("project writes and conversation creation reject an inactive account", () => {
  const store = useChatStore.getState();
  const id = store.createProject("Project")!;
  const before = useChatStore.getState();
  active = false;
  expect(store.createProject("Blocked")).toBeUndefined();
  expect(store.renameProject(id, "Blocked")).toBe(false);
  expect(store.deleteProject(id)).toBe(false);
  expect(store.moveSessionsToProject([store.currentSession().id], id)).toBe(
    false,
  );
  store.newSession(undefined, id);
  store.forkSession();
  store.clearSessions();
  expect(useChatStore.getState()).toBe(before);
});

test("deletion undo cannot restore a removed project assignment", () => {
  const store = useChatStore.getState();
  const id = store.createProject("Project")!;
  const assigned = addSession(id);
  store.deleteSessions([assigned.id]);
  const undo = toast.mock.calls.at(-1)?.[1] as { onClick: () => void };
  store.deleteProject(id);
  undo.onClick();
  const restored = useChatStore
    .getState()
    .sessions.find((session) => session.id === assigned.id);
  expect(restored).toBeDefined();
  expect(restored?.projectId).toBeUndefined();
  expect(useChatStore.getState().currentSession().id).toBe(assigned.id);
});

test("deletion undo remains scoped to the account that deleted the chat", () => {
  const store = useChatStore.getState();
  const assigned = addSession(store.createProject("Project"));
  store.deleteSessions([assigned.id]);
  const undo = toast.mock.calls.at(-1)?.[1] as { onClick: () => void };
  const before = useChatStore.getState();
  owner = "user-8";
  undo.onClick();
  expect(useChatStore.getState()).toBe(before);
});

test("legacy hydration initializes projects and removes dangling assignments", () => {
  const legacy = { sessions: [addSession()], currentSessionIndex: 0 };
  expect(persistence.version).toBe(3.6);
  const migrated = persistence.migrate(legacy, 3.5);
  expect(migrated.projects).toEqual([]);
  const merged = persistence.merge(
    { ...legacy, sessions: [{ ...legacy.sessions[0], projectId: "gone" }] },
    useChatStore.getState(),
  );
  expect(merged.projects).toEqual([]);
  expect(merged.sessions[0].projectId).toBeUndefined();
  expect(merged.newSession).toEqual(expect.any(Function));
});

test("project normalization keeps valid metadata and stable conversation references", () => {
  const projects = normalizeChatProjects([
    { id: "project", name: "  Project  ", createdAt: 1 },
    { id: "project", name: "Duplicate", createdAt: 2 },
    { id: "invalid", name: "", createdAt: 1 },
    { id: "future", name: "Bad time", createdAt: Infinity },
  ]);
  expect(projects).toEqual([{ id: "project", name: "Project", createdAt: 1 }]);
  const source = addSession();
  const sessions = [{ ...source, projectId: "project" }, source];
  expect(normalizeChatProjectSessions(sessions, projects)).toBe(sessions);
  const merged = persistence.merge(
    { projects, sessions },
    useChatStore.getState(),
  );
  expect(merged.projects).toEqual(projects);
  expect(merged.sessions).toBe(sessions);
  const migrated = persistence.migrate({ projects, sessions }, 3.5);
  expect(migrated.sessions[0].projectId).toBe("project");
});
