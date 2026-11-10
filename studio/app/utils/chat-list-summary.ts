import type { ChatSession } from "../store/chat";

type ChatListState = {
  sessions: readonly ChatSession[];
  currentSessionIndex: number;
};

export type ChatListSessionSummary = {
  id: string;
  topic: string;
  count: number;
  time: number;
  index: number;
  favorite?: boolean;
  projectId?: string;
  avatar: string;
  model: string;
};

type ChatListSummary = {
  sessions: readonly ChatListSessionSummary[];
  selectedIndex: number;
};

export function createChatListSummarySelector(projectId?: string | null) {
  let snapshot: ChatListSummary = { sessions: [], selectedIndex: -1 };
  return (state: ChatListState): ChatListSummary => {
    const previous = snapshot.sessions;
    let changed: ChatListSessionSummary[] | undefined;
    let visibleIndex = 0;
    let selectedIndex = -1;
    for (let index = 0; index < state.sessions.length; index++) {
      const session = state.sessions[index];
      const sessionProjectId = session.projectId || undefined;
      if (projectId !== null && sessionProjectId !== projectId) continue;
      if (index === state.currentSessionIndex) selectedIndex = visibleIndex;
      const cached = previous[visibleIndex];
      const avatar = session.mask.avatar;
      const model = session.mask.modelConfig.model;
      if (
        cached &&
        cached.id === session.id &&
        cached.topic === session.topic &&
        cached.count === session.messages.length &&
        Object.is(cached.time, session.lastUpdate) &&
        cached.index === index &&
        cached.favorite === session.favorite &&
        cached.projectId === sessionProjectId &&
        cached.avatar === avatar &&
        cached.model === model
      ) {
        changed?.push(cached);
        visibleIndex++;
        continue;
      }
      // Copy only display values; sessions and masks can be mutated in place.
      changed ??= previous.slice(0, visibleIndex);
      changed.push({
        id: session.id,
        topic: session.topic,
        count: session.messages.length,
        time: session.lastUpdate,
        index,
        favorite: session.favorite,
        projectId: sessionProjectId,
        avatar,
        model,
      });
      visibleIndex++;
    }
    if (!changed && previous.length !== visibleIndex) {
      changed = previous.slice(0, visibleIndex);
    }
    if (changed || snapshot.selectedIndex !== selectedIndex) {
      snapshot = {
        sessions: changed ?? previous,
        selectedIndex,
      };
    }
    return snapshot;
  };
}

type ChatListStoreIndex = {
  all: ChatListSummary;
  projects: ReadonlyMap<string | undefined, ChatListSummary>;
};

const summarizeStore = createChatListSummarySelector(null);
const storeIndices = new WeakMap<ChatListState, ChatListStoreIndex>();
const emptyProject: ChatListSummary = { sessions: [], selectedIndex: -1 };
let previousStoreIndex: ChatListStoreIndex | undefined;

function storeIndex(state: ChatListState): ChatListStoreIndex {
  const cached = storeIndices.get(state);
  if (cached) return cached;
  const all = summarizeStore(state);
  let index = previousStoreIndex;
  if (!index || index.all !== all) {
    const grouped = new Map<string | undefined, ChatListSessionSummary[]>();
    for (const session of all.sessions) {
      const rows = grouped.get(session.projectId);
      if (rows) rows.push(session);
      else grouped.set(session.projectId, [session]);
    }
    const projects = new Map<string | undefined, ChatListSummary>();
    for (const [projectId, sessions] of grouped) {
      const previous = index?.projects.get(projectId);
      const selectedIndex = sessions.findIndex(
        (session) => session.index === all.selectedIndex,
      );
      const unchanged =
        previous?.sessions.length === sessions.length &&
        sessions.every(
          (session, position) => previous.sessions[position] === session,
        );
      projects.set(
        projectId,
        unchanged && previous.selectedIndex === selectedIndex
          ? previous
          : {
              sessions: unchanged ? previous.sessions : sessions,
              selectedIndex,
            },
      );
    }
    index = { all, projects };
    previousStoreIndex = index;
  }
  storeIndices.set(state, index);
  return index;
}

export function createChatListStoreSelector(projectId?: string | null) {
  // Zustand notifies with a new root, so lists can share primitive snapshots safely.
  return (state: ChatListState): ChatListSummary => {
    const index = storeIndex(state);
    return projectId === null
      ? index.all
      : index.projects.get(projectId) ?? emptyProject;
  };
}
