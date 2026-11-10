import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { jest } from "@jest/globals";
import type { VideoDraft } from "../app/store/video";

jest.unstable_mockModule("@/app/utils", () => ({
  safeLocalStorage: () => localStorage,
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => "user-7",
  getLocalTokenId: () => 10,
  isLocalWorkspaceActive: () => true,
  localKey: (key: string) => `octopus:user-7:${key}`,
  persistLocalWrite: (action: () => Promise<void>) => action(),
}));
jest.unstable_mockModule("@/app/utils/chat-persistence", () => ({
  readChatSnapshot: jest.fn(async () => null),
  writeChatSnapshot: jest.fn(async () => {}),
  removeChatSnapshot: jest.fn(async () => {}),
}));

const { useVideoStore } = await import("../app/store/video");
const { VideoParameterControls } = await import(
  "../app/components/video-workspace/video-parameter-controls"
);
const initialDraft = JSON.parse(
  JSON.stringify(useVideoStore.getState().draft),
) as VideoDraft;
const updateDraft = useVideoStore.getState().updateDraft;
const changes = jest.fn<(patch: Partial<VideoDraft>) => void>();
const material = {
  id: "reference",
  type: "image" as const,
  name: "reference.png",
  url: "https://cdn.test/reference.png",
};

function ParameterControls() {
  const { draft, updateDraft } = useVideoStore();
  return <VideoParameterControls draft={draft} onChange={updateDraft} />;
}

beforeEach(() => {
  localStorage.clear();
  changes.mockReset().mockImplementation(updateDraft);
  useVideoStore.setState({
    draft: {
      ...initialDraft,
      model: "sora-2",
      resolution: "720p",
      aspectRatio: "16:9",
      size: "1280x720",
      duration: 8,
      prompt: "Keep @图片1 beside the ocean",
      materials: [material],
      draftAutoSave: false,
    },
    hasHydrated: true,
    draftRevision: 0,
    updateDraft: changes,
  });
});

test.each([45, 2.5])(
  "opening controls preserves custom resolution, ratio and duration %s without writing",
  (duration) => {
    useVideoStore.setState((state) => ({
      draft: {
        ...state.draft,
        resolution: "2160p",
        aspectRatio: "7:4",
        size: "2048x1080",
        duration,
      },
    }));
    const original = useVideoStore.getState().draft;
    const { rerender } = render(<ParameterControls />);
    fireEvent.click(screen.getByText("自定义参数"));
    rerender(<ParameterControls />);
    expect(screen.getByText("2160p")).toBeInTheDocument();
    expect(screen.getByText("7:4")).toBeInTheDocument();
    expect(screen.getByText(`${duration}s`)).toBeInTheDocument();
    expect(screen.getByLabelText("自定义视频时长")).toHaveValue(duration);
    expect(screen.getByRole("slider", { name: "视频时长" })).toHaveValue(
      String(duration > 30 ? 30 : 3),
    );
    expect(
      screen
        .getAllByRole("radio")
        .some((radio) => (radio as HTMLInputElement).checked),
    ).toBe(false);
    expect(changes).not.toHaveBeenCalled();
    expect(useVideoStore.getState().draft).toBe(original);
  },
);

test("preset selection recalculates manual dimensions once and ignores an already selected radio", () => {
  useVideoStore.setState((state) => ({
    draft: { ...state.draft, size: "1000x600" },
  }));
  render(<ParameterControls />);
  const resolution = within(
    screen.getByRole("radiogroup", { name: "分辨率" }),
  ).getByRole("radio", { name: "480p" });
  fireEvent.click(resolution);
  expect(useVideoStore.getState().draft).toMatchObject({
    resolution: "480p",
    size: "854x480",
  });
  expect(changes).toHaveBeenCalledTimes(1);
  fireEvent.click(resolution);
  expect(changes).toHaveBeenCalledTimes(1);

  const ratio = within(
    screen.getByRole("radiogroup", { name: "画面比例" }),
  ).getByRole("radio", { name: "9:16" });
  fireEvent.click(ratio);
  expect(useVideoStore.getState().draft).toMatchObject({
    aspectRatio: "9:16",
    size: "480x854",
  });
  expect(changes).toHaveBeenCalledTimes(2);
  fireEvent.click(ratio);
  expect(changes).toHaveBeenCalledTimes(2);
});

test("moving the duration slider preserves the current prompt and reference materials", () => {
  const original = useVideoStore.getState().draft;
  render(<ParameterControls />);
  fireEvent.change(screen.getByRole("slider", { name: "视频时长" }), {
    target: { value: "12" },
  });
  expect(changes).toHaveBeenCalledWith({ duration: 12 });
  expect(useVideoStore.getState().draft).toMatchObject({ duration: 12 });
  expect(useVideoStore.getState().draft.prompt).toBe(original.prompt);
  expect(useVideoStore.getState().draft.materials).toBe(original.materials);
});

test("default dimensions hide pixel editors and preserve the stored draft", () => {
  useVideoStore.setState((state) => ({
    draft: {
      ...state.draft,
      resolution: "480p",
      aspectRatio: "auto",
      size: "auto",
    },
  }));
  render(<ParameterControls />);
  fireEvent.click(screen.getByText("自定义参数"));
  expect(screen.queryByLabelText("视频宽度")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("视频高度")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "交换宽高" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("尺寸预览")).not.toBeInTheDocument();
  expect(useVideoStore.getState().draft.size).toBe("auto");
  expect(changes).not.toHaveBeenCalled();
});

test("clearing custom duration never stores zero and finite decimal input is retained", () => {
  useVideoStore.setState((state) => ({
    draft: { ...state.draft, duration: 2.5 },
  }));
  render(<ParameterControls />);
  fireEvent.click(screen.getByText("自定义参数"));
  const duration = screen.getByLabelText("自定义视频时长");
  fireEvent.change(duration, { target: { value: "" } });
  expect(changes).not.toHaveBeenCalled();
  expect(useVideoStore.getState().draft.duration).toBe(2.5);
  fireEvent.change(duration, { target: { value: "2.75" } });
  expect(changes).toHaveBeenCalledWith({ duration: 2.75 });
  expect(useVideoStore.getState().draft.duration).toBe(2.75);
  expect(duration).toHaveAttribute("step", "any");
});

test("chat-owned parameters render and emit patches without reading or changing the global video draft", () => {
  const globalDraft = useVideoStore.getState().draft;
  const chatDraft: VideoDraft = {
    ...globalDraft,
    prompt: "Current chat draft",
    resolution: "2160p",
    aspectRatio: "7:4",
    duration: 45,
  };
  const onChange = jest.fn<(patch: Partial<VideoDraft>) => void>();
  render(
    <VideoParameterControls draft={chatDraft} onChange={onChange}>
      <button type="button">聊天参数工具</button>
    </VideoParameterControls>,
  );
  expect(screen.getByText("2160p")).toBeInTheDocument();
  expect(screen.getByText("7:4")).toBeInTheDocument();
  expect(screen.getByText("45s")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "聊天参数工具" }),
  ).toBeInTheDocument();
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "分辨率" })).getByRole(
      "radio",
      { name: "480p" },
    ),
  );
  fireEvent.change(screen.getByRole("slider", { name: "视频时长" }), {
    target: { value: "12" },
  });
  expect(onChange.mock.calls).toEqual([
    [{ resolution: "480p" }],
    [{ duration: 12 }],
  ]);
  expect(changes).not.toHaveBeenCalled();
  expect(useVideoStore.getState().draft).toBe(globalDraft);
});
