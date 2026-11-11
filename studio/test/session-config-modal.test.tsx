import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { create } from "zustand";
import { deserialize, serialize } from "node:v8";

type TestMask = {
  name: string;
  modelConfig: { temperature: number };
};
type TestSession = {
  id: string;
  topic: string;
  projectId?: string;
  mask: TestMask;
  memoryPrompt: string;
  lastSummarizeIndex: number;
};
type TestState = {
  sessions: TestSession[];
  currentSessionIndex: number;
  draft: string;
  updateTargetSession: (
    target: TestSession,
    updater: (session: TestSession) => void,
  ) => void;
};

let owner = "owner-a";
let active = true;
const navigate = jest.fn();
const createMask = jest.fn();
const confirm = jest.fn<() => Promise<boolean>>();
const updateTargetSession = jest.fn<TestState["updateTargetSession"]>(
  (target, updater) => {
    const state = useChatStore.getState();
    const sessions = state.sessions.map((session) => {
      if (session.id !== target.id) return session;
      const updated = { ...session };
      updater(updated);
      return updated;
    });
    useChatStore.setState({ sessions });
  },
);
const useChatStore = create<TestState>(() => ({
  sessions: [],
  currentSessionIndex: 0,
  draft: "Unsent draft",
  updateTargetSession,
}));

jest.unstable_mockModule("@/app/store", () => ({ useChatStore }));
jest.unstable_mockModule("@/app/store/mask", () => ({
  useMaskStore: { getState: () => ({ create: createMask }) },
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => owner,
  isLocalWorkspaceActive: () => active,
}));
jest.unstable_mockModule("react-router-dom", () => ({
  useNavigate: () => navigate,
}));
jest.unstable_mockModule("@/app/icons/reload.svg", () => ({
  default: () => <svg />,
}));
jest.unstable_mockModule("@/app/icons/copy.svg", () => ({
  default: () => <svg />,
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    Context: { Edit: "Current chat configuration" },
    Chat: {
      InputActions: { ChatSettings: "Chat settings" },
      Config: { Reset: "Reset memory", SaveAs: "Save as preset" },
    },
    Memory: { Title: "Memory", ResetConfirm: "Reset memory?" },
  },
}));
jest.unstable_mockModule("next/dynamic", () => ({
  default: () =>
    function MaskConfig({
      mask,
      updateMask,
    }: {
      mask: TestMask;
      updateMask: (updater: (mask: TestMask) => void) => void;
    }) {
      return (
        <input
          aria-label="Preset name"
          value={mask.name}
          onChange={(event) =>
            updateMask((current) => {
              current.name = event.target.value;
            })
          }
        />
      );
    },
}));
jest.unstable_mockModule("@/app/components/button", () => ({
  IconButton: ({ text, onClick }: { text: string; onClick: () => void }) => (
    <button onClick={onClick}>{text}</button>
  ),
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showConfirm: confirm,
  ListItem: () => null,
  Modal: ({
    title,
    children,
    actions,
    onClose,
  }: {
    title: string;
    children: React.ReactNode;
    actions: React.ReactNode;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label={title}>
      <button onClick={onClose}>Close</button>
      {children}
      {actions}
    </div>
  ),
  useModalClose: (onClose: () => void) => {
    const latest = React.useRef(onClose);
    latest.current = onClose;
    return {
      maskRef: React.useRef<HTMLDivElement>(null),
      requestClose: React.useCallback((afterClose?: () => void) => {
        afterClose?.();
        latest.current();
      }, []),
    };
  },
}));

const { SessionConfigModel } = await import(
  "../app/components/session-config-modal"
);

const cloneDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "structuredClone",
);
beforeAll(() => {
  Object.defineProperty(globalThis, "structuredClone", {
    configurable: true,
    value: <T,>(value: T): T => deserialize(serialize(value)),
  });
});
afterAll(() => {
  if (cloneDescriptor)
    Object.defineProperty(globalThis, "structuredClone", cloneDescriptor);
  else Reflect.deleteProperty(globalThis, "structuredClone");
});

beforeEach(() => {
  jest.clearAllMocks();
  owner = "owner-a";
  active = true;
  confirm.mockResolvedValue(true);
  useChatStore.setState({
    currentSessionIndex: 0,
    draft: "Unsent draft",
    sessions: [
      {
        id: "a",
        topic: "Current chat",
        mask: { name: "Preset A", modelConfig: { temperature: 0.1 } },
        memoryPrompt: "Memory A",
        lastSummarizeIndex: 2,
      },
      {
        id: "b",
        topic: "Project chat",
        projectId: "project-1",
        mask: { name: "Preset B", modelConfig: { temperature: 0.7 } },
        memoryPrompt: "Memory B",
        lastSummarizeIndex: 5,
      },
    ],
  });
});
afterEach(cleanup);

test("edits a non-current project conversation without selecting it or changing the draft", () => {
  render(<SessionConfigModel sessionId="b" onClose={jest.fn()} />);
  expect(
    screen.getByRole("dialog", { name: "Project chat · Chat settings" }),
  ).toBeInTheDocument();
  expect(document.querySelector("[data-session-config-id]")).toHaveAttribute(
    "data-session-config-id",
    "b",
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), {
    target: { value: "Updated B" },
  });
  const state = useChatStore.getState();
  expect(state.sessions.map((session) => session.mask.name)).toEqual([
    "Preset A",
    "Updated B",
  ]);
  expect(state.currentSessionIndex).toBe(0);
  expect(state.draft).toBe("Unsent draft");
  expect(navigate).not.toHaveBeenCalled();
});

test("default mode keeps the conversation that was current when opened", () => {
  render(<SessionConfigModel onClose={jest.fn()} />);
  act(() => useChatStore.setState({ currentSessionIndex: 1 }));
  expect(
    screen.getByRole("dialog", { name: "Current chat configuration" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Preset name" })).toHaveValue(
    "Preset A",
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), {
    target: { value: "Updated A" },
  });
  expect(
    useChatStore.getState().sessions.map((session) => session.mask.name),
  ).toEqual(["Updated A", "Preset B"]);
});

test("reset memory targets its original conversation after confirmation", async () => {
  let finish!: (confirmed: boolean) => void;
  confirm.mockImplementation(
    () => new Promise((resolve) => (finish = resolve)),
  );
  render(<SessionConfigModel sessionId="b" onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Reset memory" }));
  act(() => useChatStore.setState({ currentSessionIndex: 1 }));
  await act(async () => finish(true));
  expect(
    useChatStore.getState().sessions.map((session) => session.memoryPrompt),
  ).toEqual(["Memory A", ""]);
});

test.each([
  "owner changed",
  "workspace paused",
  "target removed",
  "closed",
  "unmounted",
])("pending reset does not write after %s", async (invalidation) => {
  let finish!: (confirmed: boolean) => void;
  confirm.mockImplementation(
    () => new Promise((resolve) => (finish = resolve)),
  );
  const { unmount } = render(
    <SessionConfigModel sessionId="b" onClose={jest.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Reset memory" }));
  if (invalidation === "owner changed") owner = "owner-b";
  if (invalidation === "workspace paused") active = false;
  if (invalidation === "target removed")
    act(() =>
      useChatStore.setState(({ sessions }) => ({
        sessions: sessions.filter((session) => session.id !== "b"),
      })),
    );
  if (invalidation === "closed")
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  if (invalidation === "unmounted") unmount();
  await act(async () => finish(true));
  expect(updateTargetSession).not.toHaveBeenCalled();
});

test("save as preset copies the targeted configuration before navigating", () => {
  const close = jest.fn();
  render(<SessionConfigModel sessionId="b" onClose={close} />);
  const mask = useChatStore.getState().sessions[1].mask;
  fireEvent.click(screen.getByRole("button", { name: "Save as preset" }));
  expect(createMask).toHaveBeenCalledWith(mask);
  expect(createMask.mock.calls[0][0]).not.toBe(mask);
  expect(navigate).toHaveBeenCalledWith("/masks");
  expect(close).toHaveBeenCalledTimes(1);
  expect(useChatStore.getState().currentSessionIndex).toBe(0);
  expect(useChatStore.getState().draft).toBe("Unsent draft");
});
