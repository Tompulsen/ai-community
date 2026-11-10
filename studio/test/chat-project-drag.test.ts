import { jest } from "@jest/globals";
import type { DropResult } from "@hello-pangea/dnd";

type Session = { id: string; projectId?: string };
let sessions: Session[];
let activeId: string;
let owner: string;
let active: boolean;

const moveProject = jest.fn<(ids: string[], projectId?: string) => boolean>();
const moveSession = jest.fn<(from: number, to: number) => void>();
const state = {
  get sessions() {
    return sessions;
  },
  projects: ["alpha", "beta", "empty"].map((id) => ({
    id,
    name: id,
    createdAt: 0,
  })),
  moveSessionsToProject: moveProject,
  moveSession,
};

jest.unstable_mockModule("@/app/store", () => ({
  useChatStore: { getState: () => state },
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => owner,
  isLocalWorkspaceActive: () => active,
}));

const { applyChatProjectDrop, chatProjectDropId, projectIdFromDropId } =
  await import("../app/components/chat-project-drag");

function drop(
  id: string,
  sourceProject: string | undefined,
  sourceIndex: number,
  destinationProject: string | undefined,
  destinationIndex: number,
): DropResult {
  return {
    draggableId: id,
    type: "DEFAULT",
    reason: "DROP",
    mode: "FLUID",
    source: {
      droppableId: chatProjectDropId(sourceProject),
      index: sourceIndex,
    },
    destination: {
      droppableId: chatProjectDropId(destinationProject),
      index: destinationIndex,
    },
    combine: null,
  };
}

function ids(projectId?: string) {
  return sessions
    .filter((session) => session.projectId === projectId)
    .map((session) => session.id);
}

beforeEach(() => {
  sessions = [
    { id: "plain-1" },
    { id: "alpha-1", projectId: "alpha" },
    { id: "plain-2" },
    { id: "beta-1", projectId: "beta" },
    { id: "alpha-2", projectId: "alpha" },
    { id: "plain-3" },
  ];
  activeId = "plain-3";
  owner = "legacy";
  active = true;
  moveProject.mockReset().mockImplementation((selected, projectId) => {
    sessions = sessions.map((session) =>
      selected.includes(session.id) ? { ...session, projectId } : session,
    );
    return true;
  });
  moveSession.mockReset().mockImplementation((from, to) => {
    const [session] = sessions.splice(from, 1);
    sessions.splice(to, 0, session);
  });
});

test("drop IDs distinguish regular chats, projects and unrelated drop targets", () => {
  expect(projectIdFromDropId(chatProjectDropId())).toBeUndefined();
  expect(projectIdFromDropId(chatProjectDropId("alpha"))).toBe("alpha");
  expect(projectIdFromDropId("chat-list:project:")).toBeNull();
  expect(projectIdFromDropId("unrelated")).toBeNull();
});

test("a regular conversation moves between the destination folder's sessions", () => {
  expect(
    applyChatProjectDrop(drop("plain-2", undefined, 1, "alpha", 1), "legacy"),
  ).toBe(true);
  expect(moveProject).toHaveBeenCalledWith(["plain-2"], "alpha");
  expect(ids("alpha")).toEqual(["alpha-1", "plain-2", "alpha-2"]);
  expect(ids()).toEqual(["plain-1", "plain-3"]);
  expect(ids("beta")).toEqual(["beta-1"]);
  expect(sessions.some((session) => session.id === activeId)).toBe(true);
});

test("a conversation can move directly between project folders", () => {
  expect(
    applyChatProjectDrop(drop("alpha-2", "alpha", 1, "beta", 0), "legacy"),
  ).toBe(true);
  expect(ids("alpha")).toEqual(["alpha-1"]);
  expect(ids("beta")).toEqual(["alpha-2", "beta-1"]);
  expect(ids()).toEqual(["plain-1", "plain-2", "plain-3"]);
});

test("dropping into regular chats removes the project membership", () => {
  expect(
    applyChatProjectDrop(drop("alpha-1", "alpha", 0, undefined, 1), "legacy"),
  ).toBe(true);
  expect(moveProject).toHaveBeenCalledWith(["alpha-1"], undefined);
  expect(ids()).toEqual(["plain-1", "alpha-1", "plain-2", "plain-3"]);
});

test("dropping into an empty folder preserves unrelated conversation positions", () => {
  const before = sessions.map((session) => session.id);
  expect(
    applyChatProjectDrop(drop("plain-2", undefined, 1, "empty", 0), "legacy"),
  ).toBe(true);
  expect(ids("empty")).toEqual(["plain-2"]);
  expect(sessions.map((session) => session.id)).toEqual(before);
  expect(moveSession).not.toHaveBeenCalled();
});

test.each([
  ["alpha-2", 1, 0, ["alpha-2", "alpha-1"]],
  ["alpha-1", 0, 1, ["alpha-2", "alpha-1"]],
] as const)(
  "same-project reordering uses filtered positions for %s",
  (id, from, to, expected) => {
    expect(
      applyChatProjectDrop(drop(id, "alpha", from, "alpha", to), "legacy"),
    ).toBe(true);
    expect(ids("alpha")).toEqual(expected);
    expect(ids()).toEqual(["plain-1", "plain-2", "plain-3"]);
    expect(moveProject).not.toHaveBeenCalled();
  },
);

test("a no-op drop does not write project or session data", () => {
  expect(
    applyChatProjectDrop(drop("alpha-1", "alpha", 0, "alpha", 0), "legacy"),
  ).toBe(false);
  expect(moveProject).not.toHaveBeenCalled();
  expect(moveSession).not.toHaveBeenCalled();
});

test.each(["unknown", ""])("invalid destination %s is rejected", (project) => {
  const result = drop("plain-1", undefined, 0, "alpha", 0);
  result.destination!.droppableId = `chat-list:project:${project}`;
  expect(applyChatProjectDrop(result, "legacy")).toBe(false);
  expect(moveProject).not.toHaveBeenCalled();
});

test("a stale source membership cannot move a conversation from another folder", () => {
  sessions[0].projectId = "beta";
  expect(
    applyChatProjectDrop(drop("plain-1", undefined, 0, "alpha", 0), "legacy"),
  ).toBe(false);
  expect(moveProject).not.toHaveBeenCalled();
});

test("cancelled and outside drops do not move conversations", () => {
  const cancelled = drop("plain-1", undefined, 0, "alpha", 0);
  cancelled.reason = "CANCEL";
  expect(applyChatProjectDrop(cancelled, "legacy")).toBe(false);
  const outside = drop("plain-1", undefined, 0, "alpha", 0);
  outside.destination = null;
  expect(applyChatProjectDrop(outside, "legacy")).toBe(false);
  expect(moveProject).not.toHaveBeenCalled();
});

test("changing workspace while dragging cannot move another account's conversation", () => {
  owner = "user-7";
  expect(
    applyChatProjectDrop(drop("plain-1", undefined, 0, "alpha", 0), "legacy"),
  ).toBe(false);
  expect(moveProject).not.toHaveBeenCalled();
});

test("workspace maintenance and missing drag ownership reject writes", () => {
  active = false;
  const result = drop("plain-1", undefined, 0, "alpha", 0);
  expect(applyChatProjectDrop(result, "legacy")).toBe(false);
  active = true;
  expect(applyChatProjectDrop(result, undefined)).toBe(false);
  expect(moveProject).not.toHaveBeenCalled();
});
