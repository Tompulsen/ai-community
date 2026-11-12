import type { ChatMessage, ChatSession } from "./types.ts";

const ROOT = "__root__";

type MessageSnapshot = {
  message: ChatMessage;
  id: string;
  role: ChatMessage["role"];
  parentId?: string;
  branchOrder?: number;
};

type BranchIndex = {
  active: MessageSnapshot[];
  archived?: MessageSnapshot[];
  selections: [string, string][];
  messages: ChatMessage[];
  activeById: Map<string, ChatMessage>;
  siblingsByParent: Map<string, string[]>;
  synchronized?: boolean;
  validatedStateToken?: number;
  busyStateToken?: number;
  busy?: boolean;
};

const branchIndexes = new WeakMap<ChatSession, BranchIndex>();
// Tokens must not keep old store snapshots and deleted sessions alive.
const stateTokens = new WeakMap<object, number>();
let nextStateToken = 0;

function stateToken(state: object) {
  let token = stateTokens.get(state);
  if (token === undefined) {
    token = ++nextStateToken;
    stateTokens.set(state, token);
  }
  return token;
}

function parentKey(message: ChatMessage) {
  return message.parentId ?? ROOT;
}

function siblingKey(message: ChatMessage) {
  return JSON.stringify([message.role, message.parentId ?? null]);
}

function snapshotMessage(message: ChatMessage): MessageSnapshot {
  return {
    message,
    id: message.id,
    role: message.role,
    parentId: message.parentId,
    branchOrder: message.branchOrder,
  };
}

function messagesMatch(
  messages: ChatMessage[] | undefined,
  snapshots: MessageSnapshot[] | undefined,
) {
  if (!messages || !snapshots) return !messages && !snapshots;
  if (messages.length !== snapshots.length) return false;
  return messages.every((message, index) => {
    const saved = snapshots[index];
    return (
      message === saved.message &&
      message.id === saved.id &&
      message.role === saved.role &&
      message.parentId === saved.parentId &&
      message.branchOrder === saved.branchOrder
    );
  });
}

function structureMatches(
  session: ChatSession,
  index: BranchIndex,
  includeSelections = false,
) {
  return (
    messagesMatch(session.messages, index.active) &&
    messagesMatch(session.messageBranches, index.archived) &&
    (!includeSelections ||
      (Object.keys(session.branchSelections ?? {}).length ===
        index.selections.length &&
        index.selections.every(
          ([parent, child]) => session.branchSelections?.[parent] === child,
        )))
  );
}

function createBranchIndex(session: ChatSession): BranchIndex {
  const messages = new Map<string, ChatMessage>();
  for (const message of session.messageBranches ?? [])
    messages.set(message.id, message);
  for (const message of session.messages) messages.set(message.id, message);
  const ordered = [...messages.values()].sort(
    (left, right) => (left.branchOrder ?? 0) - (right.branchOrder ?? 0),
  );
  const activeById = new Map<string, ChatMessage>();
  for (const message of session.messages)
    if (!activeById.has(message.id)) activeById.set(message.id, message);
  const siblingsByParent = new Map<string, string[]>();
  for (const message of ordered) {
    if (message.role === "system") continue;
    const key = siblingKey(message);
    const siblings = siblingsByParent.get(key);
    if (siblings) siblings.push(message.id);
    else siblingsByParent.set(key, [message.id]);
  }
  return {
    active: session.messages.map(snapshotMessage),
    archived: session.messageBranches?.map(snapshotMessage),
    selections: Object.entries(session.branchSelections ?? {}),
    messages: ordered,
    activeById,
    siblingsByParent,
  };
}

function branchIndex(session: ChatSession, state?: object) {
  let index = branchIndexes.get(session);
  const token = state ? stateToken(state) : undefined;
  // State tokens avoid rechecking every visible answer; primitive snapshots
  // still detect in-place edits made by imports or external store.setState.
  if (
    !index ||
    (!(token !== undefined && index.validatedStateToken === token) &&
      !structureMatches(session, index))
  ) {
    index = createBranchIndex(session);
    branchIndexes.set(session, index);
  }
  if (token !== undefined) index.validatedStateToken = token;
  return index;
}

export function branchMessages(session: ChatSession) {
  return branchIndex(session).messages.slice();
}

export function branchBusy(session: ChatSession, state?: object) {
  const token = state ? stateToken(state) : undefined;
  const index = state ? branchIndex(session, state) : undefined;
  if (index && token !== undefined && index.busyStateToken === token)
    return index.busy!;
  const busy = session.messages.some(
    (message) => message.streaming || message.materialStatus === "processing",
  );
  if (index) {
    index.busyStateToken = token;
    index.busy = busy;
  }
  return busy;
}

export function initializeBranches(session: ChatSession) {
  session.messageBranches ??= [];
  synchronizeBranches(session);
}

export function synchronizeBranches(
  session: ChatSession,
  previousSession?: ChatSession,
) {
  const index =
    branchIndexes.get(session) ??
    (previousSession ? branchIndexes.get(previousSession) : undefined);
  if (
    index &&
    (index.synchronized || !session.messageBranches) &&
    structureMatches(session, index, true)
  ) {
    branchIndexes.set(session, index);
    return;
  }
  if (!session.messageBranches) return;
  const all = branchMessages(session);
  let order = all.reduce(
    (maximum, message) => Math.max(maximum, message.branchOrder ?? -1),
    -1,
  );
  const selections = { ...session.branchSelections };
  session.messages = session.messages.map((message, index, messages) => {
    const next = message;
    if (next.branchOrder === undefined) next.branchOrder = ++order;
    next.parentId = index ? messages[index - 1].id : undefined;
    selections[parentKey(next)] = next.id;
    return next;
  });
  const activeIds = new Set(session.messages.map((message) => message.id));
  session.messageBranches = (session.messageBranches ?? []).filter(
    (message) => !activeIds.has(message.id),
  );
  const nodes = new Map(
    [...session.messageBranches, ...session.messages].map((message) => [
      message.id,
      message,
    ]),
  );
  session.branchSelections = Object.fromEntries(
    Object.entries(selections).filter(
      ([parent, child]) =>
        nodes.has(child) && parentKey(nodes.get(child)!) === parent,
    ),
  );
  const nextIndex = createBranchIndex(session);
  nextIndex.synchronized = true;
  branchIndexes.set(session, nextIndex);
}

export function answerBranches(
  session: ChatSession,
  messageId: string,
  state?: object,
) {
  const index = branchIndex(session, state);
  const message = index.activeById.get(messageId);
  if (!message || message.role === "system" || !session.messageBranches)
    return { index: 0, total: 1, messageIds: [messageId] };
  const messageIds =
    index.siblingsByParent.get(siblingKey(message))?.slice() ?? [];
  return {
    index: Math.max(0, messageIds.indexOf(messageId)),
    total: messageIds.length,
    messageIds,
  };
}

function activatePath(session: ChatSession, messages: ChatMessage[]) {
  const previous = session.messages;
  const nodes = branchMessages(session);
  const activeIds = new Set(messages.map((message) => message.id));
  let common = 0;
  while (
    common < previous.length &&
    common < messages.length &&
    previous[common].id === messages[common].id
  )
    common++;
  session.messages = messages;
  session.messageBranches = nodes.filter(
    (message) => !activeIds.has(message.id),
  );
  // A summary can contain an answer that belongs to the other path.
  session.memoryPrompt = "";
  session.lastSummarizeIndex = 0;
  if (session.clearContextIndex !== undefined)
    session.clearContextIndex = Math.min(session.clearContextIndex, common);
  session.lastUpdate = Date.now();
  synchronizeBranches(session);
}

export function selectAnswerBranch(
  session: ChatSession,
  messageId: string,
  targetId: string,
  deleting = false,
) {
  if (!deleting && branchBusy(session)) return false;
  const sourceIndex = session.messages.findIndex(
    (message) => message.id === messageId && message.role !== "system",
  );
  if (sourceIndex < 0) return false;
  const source = session.messages[sourceIndex];
  const nodes = branchMessages(session);
  const target = nodes.find((message) => message.id === targetId);
  if (
    !target ||
    source.role !== target.role ||
    source.parentId !== target.parentId
  )
    return false;
  const children = new Map<string, ChatMessage[]>();
  for (const node of nodes) {
    const key = parentKey(node);
    children.set(key, [...(children.get(key) ?? []), node]);
  }
  const path = session.messages.slice(0, sourceIndex);
  const visited = new Set(path.map((message) => message.id));
  let current: ChatMessage | undefined = target;
  while (current && !visited.has(current.id)) {
    path.push(current);
    visited.add(current.id);
    const next: ChatMessage[] = children.get(current.id) ?? [];
    current =
      next.find(
        (message) => message.id === session.branchSelections?.[current!.id],
      ) ?? next.at(-1);
  }
  activatePath(session, path);
  return true;
}

export function createAnswerBranch(
  session: ChatSession,
  userId: string,
  answer: ChatMessage,
) {
  if (branchBusy(session)) return false;
  const userIndex = session.messages.findIndex(
    (message) => message.id === userId && message.role === "user",
  );
  if (userIndex < 0) return false;
  initializeBranches(session);
  const prefix = session.messages.slice(0, userIndex + 1);
  activatePath(session, prefix);
  session.messages = [...session.messages, answer];
  synchronizeBranches(session);
  return true;
}

export function createEditedMessageBranch(
  session: ChatSession,
  userId: string,
  user: ChatMessage,
  answer: ChatMessage,
) {
  if (branchBusy(session)) return false;
  const index = session.messages.findIndex(
    (message) => message.id === userId && message.role === "user",
  );
  if (index < 0 || user.role !== "user" || answer.role !== "assistant")
    return false;
  initializeBranches(session);
  activatePath(session, session.messages.slice(0, index));
  session.messages = [...session.messages, user, answer];
  synchronizeBranches(session);
  return true;
}

export function deleteBranchMessage(session: ChatSession, messageId: string) {
  const index = session.messages.findIndex(
    (message) => message.id === messageId,
  );
  if (index < 0) return false;
  if (!session.messageBranches) {
    session.messages = session.messages.filter(
      (message) => message.id !== messageId,
    );
    session.memoryPrompt = "";
    session.lastSummarizeIndex = 0;
    if (
      session.clearContextIndex !== undefined &&
      index < session.clearContextIndex
    )
      session.clearContextIndex--;
    return true;
  }
  const source = session.messages[index];
  const nodes = branchMessages(session);
  const removed = new Set([messageId]);
  for (const node of nodes)
    if (node.parentId && removed.has(node.parentId)) removed.add(node.id);
  const replacement = nodes.find(
    (message) =>
      message.id !== messageId &&
      message.role === source.role &&
      message.parentId === source.parentId &&
      !removed.has(message.id),
  );
  if (replacement && source.role !== "system") {
    // Selecting is safe after the deleted turn has been stopped by the caller.
    selectAnswerBranch(session, messageId, replacement.id, true);
  } else {
    activatePath(session, session.messages.slice(0, index));
  }
  session.messages = session.messages.filter(
    (message) => !removed.has(message.id),
  );
  session.messageBranches = (session.messageBranches ?? []).filter(
    (message) => !removed.has(message.id),
  );
  synchronizeBranches(session);
  return true;
}

export function cloneBranchMessages(
  session: ChatSession,
  nextId: () => string,
) {
  const ids = new Map(
    branchMessages(session).map((message) => [message.id, nextId()]),
  );
  const clone = (message: ChatMessage): ChatMessage => ({
    ...structuredClone(message),
    id: ids.get(message.id)!,
    parentId: message.parentId ? ids.get(message.parentId) : undefined,
    streaming: false,
    ...(message.streaming ? { interrupted: true } : {}),
  });
  return {
    messages: session.messages.map(clone),
    ...(session.messageBranches
      ? {
          messageBranches: session.messageBranches.map(clone),
          branchSelections: Object.fromEntries(
            Object.entries(session.branchSelections ?? {}).flatMap(
              ([parent, child]) => {
                const nextParent = parent === ROOT ? ROOT : ids.get(parent);
                const nextChild = ids.get(child);
                return nextParent && nextChild ? [[nextParent, nextChild]] : [];
              },
            ),
          ),
        }
      : {}),
  };
}
