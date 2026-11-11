import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { jest } from "@jest/globals";
import type { LocalTask } from "../app/utils/local-tasks";

const fetchAccess = jest.fn<() => Promise<void>>();
const session = jest.fn<() => Promise<{ selectedTokenId: number }>>();
const pendingTasks = jest.fn<() => LocalTask[]>();
const pollLocalTask =
  jest.fn<
    (
      task: LocalTask,
      read: (path: string) => Promise<unknown>,
      signal?: AbortSignal,
    ) => Promise<unknown>
  >();
const request = jest.fn<(...args: any[]) => Promise<unknown>>();
const forgetTask = jest.fn();
const loadVideo = jest.fn<() => Promise<void>>();
const resumeVideoRequest =
  jest.fn<(id: string, signal?: AbortSignal) => Promise<void>>();
const saveGeneratedImage = jest.fn<() => Promise<void>>();
let active = true;
const access = {
  fetch: fetchAccess,
  useCustomConfig: false,
  openaiUrl: "",
  openaiApiKey: "",
};
const initialSessions = [
  { id: "chat", messages: [{ id: "answer", content: "", streaming: true }] },
];
const chat = {
  sessions: initialSessions,
  updateTargetSession: (
    target: (typeof initialSessions)[number],
    update: (target: (typeof initialSessions)[number]) => void,
  ) => update(target),
  saveGeneratedImage,
};

jest.unstable_mockModule("react", () => React);
jest.unstable_mockModule("@/app/client/api", () => ({
  apiFetch: request,
  apiPath: (path: string) => `/api${path}`,
}));
jest.unstable_mockModule("@/app/client/new-api", () => ({
  newApiClient: { session },
}));
jest.unstable_mockModule("@/app/store/chat", () => ({
  useChatStore: { getState: () => chat },
}));
jest.unstable_mockModule("@/app/store/access", () => ({
  useAccessStore: Object.assign(
    (select: (state: typeof access) => unknown) => select(access),
    { getState: () => access },
  ),
}));
jest.unstable_mockModule("@/app/utils/image-response", () => ({
  imageResultUrls: () => ["https://fixture.test/result.png"],
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => "user-7",
  getLocalTokenId: () => 7,
  isLocalWorkspaceActive: () => active,
}));
jest.unstable_mockModule("@/app/utils/local-tasks", () => ({
  pendingTasks,
  pollLocalTask,
  forgetTask,
  createTaskQueryQueue: () => (read: () => Promise<unknown>) => read(),
}));
jest.unstable_mockModule("@/app/client/controller", () => ({
  ChatControllerPool: {
    controllers: {},
    key: (sessionId: string, messageId: string) => `${sessionId}:${messageId}`,
  },
}));
jest.unstable_mockModule("@/app/utils/custom-provider", () => ({
  CUSTOM_MODEL_PROVIDER: "Custom",
}));
jest.unstable_mockModule("@/app/utils/video-generation", async () => {
  await loadVideo();
  return { resumeVideoRequest };
});
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  Toast: ({ content }: { content: string }) => (
    <div role="status">{content}</div>
  ),
}));

function task(kind: LocalTask["kind"] = "video"): LocalTask {
  return {
    id: "pending",
    kind,
    upstreamId: "upstream",
    sessionId: "chat",
    messageId: "answer",
    tokenId: 7,
    model: "model",
    prompt: "Original prompt",
    createdAt: Date.now(),
  };
}

async function setup() {
  const { TaskRecovery } = await import("../app/components/task-recovery");
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<TaskRecovery />);
  });
  return view;
}

beforeEach(() => {
  jest.resetModules();
  active = true;
  fetchAccess.mockReset().mockResolvedValue();
  session.mockReset().mockResolvedValue({ selectedTokenId: 7 });
  pendingTasks.mockReset().mockReturnValue([]);
  pollLocalTask.mockReset().mockResolvedValue({});
  request.mockReset().mockResolvedValue({});
  forgetTask.mockClear();
  loadVideo.mockReset().mockResolvedValue();
  resumeVideoRequest.mockReset().mockResolvedValue();
  saveGeneratedImage.mockReset().mockResolvedValue();
  chat.sessions = [
    { id: "chat", messages: [{ id: "answer", content: "", streaming: true }] },
  ];
});

afterEach(() => cleanup());

test("importing task recovery does not load the video generation module", async () => {
  await import("../app/components/task-recovery");
  expect(loadVideo).not.toHaveBeenCalled();
});

test.each(["empty", "paused video", "image"] as const)(
  "%s recovery does not load video generation",
  async (kind) => {
    pendingTasks.mockReturnValue(
      kind === "empty"
        ? []
        : kind === "paused video"
        ? [{ ...task(), paused: true }]
        : [task("image")],
    );
    await setup();

    expect(loadVideo).not.toHaveBeenCalled();
    expect(resumeVideoRequest).not.toHaveBeenCalled();
    if (kind === "image") {
      expect(pollLocalTask).toHaveBeenCalledTimes(1);
      expect(chat.sessions[0].messages[0]).toMatchObject({
        streaming: false,
        content: "![Generated Image](https://fixture.test/result.png)",
      });
      expect(saveGeneratedImage).toHaveBeenCalledWith(
        "chat",
        "answer",
        ["https://fixture.test/result.png"],
        "Original prompt",
        "model",
      );
      expect(forgetTask).toHaveBeenCalledWith("pending");
    }
  },
);

test("an active video task loads and resumes with the recovery signal", async () => {
  pendingTasks.mockReturnValue([task()]);
  await setup();
  await waitFor(() => expect(resumeVideoRequest).toHaveBeenCalledTimes(1));

  expect(loadVideo).toHaveBeenCalledTimes(1);
  expect(resumeVideoRequest).toHaveBeenCalledWith(
    "pending",
    expect.any(AbortSignal),
  );
  expect(resumeVideoRequest.mock.calls[0][1]?.aborted).toBe(false);
  expect(pollLocalTask).not.toHaveBeenCalled();
});

test("a restored task uses its saved group and group changes do not restart recovery", async () => {
  pendingTasks.mockReturnValue([{ ...task("image"), tokenId: 5 }]);
  pollLocalTask.mockImplementationOnce(async (_task, read) => {
    await read("/tasks/original");
    return {};
  });
  await setup();
  expect(request.mock.calls[0][1].headers["X-New-Api-Token"]).toBe("5");
  await act(async () => {
    window.dispatchEvent(new Event("new-api-model-source-ready"));
    window.dispatchEvent(
      new CustomEvent("new-api-session-changed", {
        detail: { userId: 7, tokenId: 9 },
      }),
    );
  });
  expect(pollLocalTask).toHaveBeenCalledTimes(1);
});

test.each([
  "local-data-maintenance",
  "model-source-changing",
  "local-workspace-switch",
  "inactive",
  "unmount",
])("a video module finishing after %s never resumes", async (change) => {
  let finish!: () => void;
  loadVideo.mockImplementationOnce(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );
  pendingTasks.mockReturnValue([task()]);
  const view = await setup();
  await waitFor(() => expect(loadVideo).toHaveBeenCalledTimes(1));

  await act(async () => {
    if (change === "inactive") active = false;
    else if (change === "unmount") view.unmount();
    else window.dispatchEvent(new Event(change));
    finish();
  });

  expect(resumeVideoRequest).not.toHaveBeenCalled();
});

test.each(["load", "resume"])(
  "%s failures keep the task and report its error",
  async (stage) => {
    pendingTasks.mockReturnValue([task()]);
    const failure = new Error("Video recovery unavailable");
    if (stage === "load") loadVideo.mockRejectedValueOnce(failure);
    else resumeVideoRequest.mockRejectedValueOnce(failure);
    await setup();

    expect(await screen.findByRole("status")).toHaveTextContent(
      failure.message,
    );
    expect(forgetTask).not.toHaveBeenCalled();
  },
);

test("the existing recovery event can resume a task after an empty startup", async () => {
  await setup();
  expect(loadVideo).not.toHaveBeenCalled();
  pendingTasks.mockReturnValue([task()]);
  await act(async () => {
    window.dispatchEvent(new Event("resume-local-tasks"));
  });
  await waitFor(() => expect(resumeVideoRequest).toHaveBeenCalledTimes(1));
});
