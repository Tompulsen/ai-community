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
import { createRequire } from "node:module";
import { create } from "zustand";
import type { VideoDraft, VideoResult } from "../app/store/video";

const nextImage = createRequire(import.meta.url)("next/image").default;
jest.unstable_mockModule("next/image", () => ({ default: nextImage }));

const loadDraft = jest.fn<() => Promise<void>>(async () => {});
const removeResult = jest.fn<(id: string) => Promise<void>>(async () => {});
const useVideoStore = create(() => ({
  results: [] as VideoResult[],
  isGenerating: false,
  loadDraft,
  removeResult,
}));
const stopWaiting = jest.fn<(id: string) => void>();
const resumeRequest = jest.fn<(id: string) => Promise<void>>(async () => {});
const generateRequest = jest.fn();
const toast = jest.fn();
const fetchVideoMedia =
  jest.fn<(result: VideoResult, signal: AbortSignal) => Promise<Blob>>();

jest.unstable_mockModule("@/app/store/video", () => ({ useVideoStore }));
jest.unstable_mockModule("@/app/store/access", () => ({
  useAccessStore: (selector: (state: object) => unknown) =>
    selector({ newApiEnabled: false }),
  refetchModels: jest.fn(),
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <select>{children}</select>
  ),
  showConfirm: jest.fn(async () => false),
  showImageModal: jest.fn(),
  showModal: jest.fn(),
  showToast: toast,
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => "user-7",
  isLocalWorkspaceActive: () => true,
  localKey: (key: string) => key,
}));
jest.unstable_mockModule("@/app/utils/video-generation", () => ({
  generateVideoRequest: generateRequest,
  stopVideoWaiting: stopWaiting,
  resumeVideoRequest: resumeRequest,
  reuseVideoRequest: jest.fn(),
}));
jest.unstable_mockModule("@/app/utils/video-media", () => ({
  fetchVideoMedia,
}));
jest.unstable_mockModule("@/app/utils/model", () => ({
  getModelProvider: (model: string) => [model, undefined],
}));
jest.unstable_mockModule("@/app/utils/hooks", () => ({
  useAllModels: () => [],
}));
jest.unstable_mockModule("@/app/utils/model-capabilities", () => ({
  useModelCapabilitiesResolver: () => () => ({ category: "video" }),
}));
jest.unstable_mockModule("@/app/utils/use-anchored-panel", () => ({
  useAnchoredPanel: () => ({}),
}));
jest.unstable_mockModule("@/app/components/community-share-button", () => ({
  CommunityShareButton: ({ resultId }: { resultId: string }) => (
    <button type="button" aria-label="发布视频" data-result-id={resultId}>
      发布
    </button>
  ),
}));
jest.unstable_mockModule("@/app/components/quota-pricing-card", () => ({
  QuotaPricingCard: () => null,
}));
jest.unstable_mockModule("@/app/components/model-select", () => ({
  ModelSelect: () => null,
}));
jest.unstable_mockModule("@/app/components/selection-dialog", () => ({
  SelectionDialog: () => null,
}));
jest.unstable_mockModule("@/app/components/page-header", () => ({
  PageHeader: () => null,
}));
jest.unstable_mockModule(
  "@/app/components/video-workspace/video-prompt-input",
  () => ({ VideoPromptInput: () => null }),
);

const { ChatVideoResult } = await import(
  "../app/components/video-workspace/video-workspace"
);
const originalRequest: VideoDraft = {
  apiFormat: "openai",
  sourceWorkId: "source-work",
  model: "sora-2",
  mode: "image-to-video",
  prompt: "Original request",
  negativePrompt: "",
  aspectRatio: "9:16",
  resolution: "1080p",
  size: "1080x1920",
  duration: 2.5,
  count: 1,
  seed: "",
  promptAdherence: 1,
  cameraMotion: 50,
  materials: [
    {
      id: "reference",
      name: "reference.png",
      type: "image",
      url: "https://fixture.test/reference.png",
    },
  ],
  referenceMode: "all-reference",
  openaiReferenceSource: "upload",
  protocolOptions: { openai: { generateAudio: false } },
  customParams: { openai: '{"seed":0}' },
  autoPlay: true,
  autoSaveGallery: true,
  confirmBeforeGenerate: false,
  draftAutoSave: true,
};
const result: VideoResult = {
  id: "video-result",
  url: "https://fixture.test/video.mp4",
  model: originalRequest.model,
  prompt: "Display prompt",
  request: originalRequest,
  status: "success",
  createdAt: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  loadDraft.mockReset().mockResolvedValue();
  resumeRequest.mockReset().mockResolvedValue();
  fetchVideoMedia.mockReset();
  useVideoStore.setState({ results: [result], isGenerating: false });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const states: { state: string; record?: VideoResult }[] = [
  { state: "success", record: result },
  {
    state: "pending",
    record: { ...result, status: "pending", phase: "generating" },
  },
  {
    state: "paused",
    record: {
      ...result,
      status: "pending",
      phase: "paused",
      upstreamId: "upstream",
    },
  },
  {
    state: "failed",
    record: { ...result, status: "failed", error: "Upstream rejected" },
  },
  { state: "missing" },
];

test.each(states)(
  "$state chat video cards never duplicate generic message actions or generate automatically",
  ({ record }) => {
    useVideoStore.setState({ results: record ? [record] : [] });
    render(<ChatVideoResult id={result.id} />);
    expect(
      screen.queryAllByRole("button", {
        name: /复用|删除|更多|重试|重新生成/,
      }),
    ).toHaveLength(0);
    expect(generateRequest).not.toHaveBeenCalled();
    expect(removeResult).not.toHaveBeenCalled();
  },
);

test("successful chat video keeps its download and publish controls", () => {
  let downloaded: { href: string; name: string } | undefined;
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloaded = { href: this.href, name: this.download };
  });
  render(<ChatVideoResult id={result.id} />);
  expect(screen.getByRole("button", { name: "发布视频" })).toHaveAttribute(
    "data-result-id",
    result.id,
  );
  fireEvent.click(screen.getByRole("button", { name: "下载视频" }));
  expect(downloaded).toEqual({
    href: result.url,
    name: `video_${result.id}.mp4`,
  });
  expect(generateRequest).not.toHaveBeenCalled();
});

test("chat results keep local pause and resume controls while receiving later task updates", async () => {
  useVideoStore.setState({
    results: [
      { ...result, status: "pending", phase: "generating", progress: 37 },
    ],
  });
  render(<ChatVideoResult id={result.id} />);
  expect(screen.getByRole("progressbar", { name: "视频生成进度" })).toHaveValue(
    37,
  );
  fireEvent.click(screen.getByRole("button", { name: "停止等待" }));
  expect(stopWaiting).toHaveBeenCalledWith(result.id);
  act(() =>
    useVideoStore.setState({
      results: [
        {
          ...result,
          status: "pending",
          phase: "paused",
          upstreamId: "upstream",
        },
      ],
    }),
  );
  expect(screen.queryByRole("button", { name: /复用/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "继续查询" }));
  expect(resumeRequest).toHaveBeenCalledWith(result.id);
  act(() => useVideoStore.setState({ results: [result] }));
  expect(screen.getByRole("button", { name: "下载视频" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "继续查询" }),
  ).not.toBeInTheDocument();
  expect(generateRequest).not.toHaveBeenCalled();
});

test("failed resume reports the existing task error without starting another generation", async () => {
  useVideoStore.setState({
    results: [
      { ...result, status: "pending", phase: "paused", upstreamId: "upstream" },
    ],
  });
  resumeRequest.mockRejectedValueOnce(
    new Error("Original account is required"),
  );
  render(<ChatVideoResult id={result.id} />);
  fireEvent.click(screen.getByRole("button", { name: "继续查询" }));
  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith("Original account is required"),
  );
  expect(resumeRequest).toHaveBeenCalledWith(result.id);
  expect(generateRequest).not.toHaveBeenCalled();
});

test("failed generation keeps its upstream error without offering a second retry button", () => {
  useVideoStore.setState({
    results: [
      { ...result, status: "failed", error: "Provider quota exceeded" },
    ],
  });
  render(<ChatVideoResult id={result.id} />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Provider quota exceeded",
  );
  expect(screen.queryByRole("button", { name: /重试|重新生成/ })).toBeNull();
  expect(generateRequest).not.toHaveBeenCalled();
});

test("a media playback failure can reload the same result without resubmitting", () => {
  render(<ChatVideoResult id={result.id} />);
  fireEvent.error(screen.getByLabelText(`播放视频：${result.prompt}`));
  expect(screen.getByRole("status")).toHaveTextContent(
    "视频暂时无法播放，请重新加载",
  );
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  expect(screen.getByLabelText(`播放视频：${result.prompt}`)).toHaveAttribute(
    "src",
    result.url,
  );
  expect(generateRequest).not.toHaveBeenCalled();
  expect(removeResult).not.toHaveBeenCalled();
});

test("cover-only updates preserve an in-flight chat video request and its playback node", async () => {
  const saved = { ...result, mediaPath: "/v1/videos/task/content" };
  useVideoStore.setState({ results: [saved] });
  let finish!: (blob: Blob) => void;
  fetchVideoMedia.mockReturnValueOnce(
    new Promise<Blob>((resolve) => {
      finish = resolve;
    }),
  );
  const originalCreate = Object.getOwnPropertyDescriptor(
    URL,
    "createObjectURL",
  );
  const originalRevoke = Object.getOwnPropertyDescriptor(
    URL,
    "revokeObjectURL",
  );
  const createObjectURL = jest.fn(() => "blob:chat-video");
  const revokeObjectURL = jest.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  const view = render(<ChatVideoResult id={result.id} />);
  try {
    expect(fetchVideoMedia).toHaveBeenCalledTimes(1);
    const signal = fetchVideoMedia.mock.calls[0][1];
    const covered = {
      ...saved,
      coverUrl: "data:" + "image/jpeg;base64,cG9zdGVy",
    };
    act(() => useVideoStore.setState({ results: [covered] }));
    expect(signal.aborted).toBe(false);
    expect(fetchVideoMedia).toHaveBeenCalledTimes(1);
    await act(async () => finish(new Blob(["original video"])));
    const player = screen.getByLabelText(
      `播放视频：${result.prompt}`,
    ) as HTMLVideoElement;
    expect(player).toHaveAttribute("src", "blob:chat-video");
    player.currentTime = 1.25;
    act(() =>
      useVideoStore.setState({
        results: [{ ...covered, coverUrl: covered.coverUrl + "Mg==" }],
      }),
    );
    expect(screen.getByLabelText(`播放视频：${result.prompt}`)).toBe(player);
    expect(player.currentTime).toBe(1.25);
    expect(player).toHaveAttribute("src", "blob:chat-video");
    expect(signal.aborted).toBe(false);
    expect(fetchVideoMedia).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    for (const [property, descriptor] of [
      ["createObjectURL", originalCreate],
      ["revokeObjectURL", originalRevoke],
    ] as const) {
      if (descriptor) Object.defineProperty(URL, property, descriptor);
      else Reflect.deleteProperty(URL, property);
    }
  }
});

test("a missing record points to the current chat or gallery without automatically generating", () => {
  useVideoStore.setState({ results: [] });
  render(<ChatVideoResult id="missing" />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "视频记录暂不可用，可在当前会话重新生成或查看作品库。",
  );
  expect(generateRequest).not.toHaveBeenCalled();
});

test("record hydration failure remains visible and never generates a replacement request", async () => {
  useVideoStore.setState({ results: [] });
  loadDraft.mockRejectedValueOnce(new Error("Storage unavailable"));
  render(<ChatVideoResult id="missing" />);
  expect(
    await screen.findByText("视频记录加载失败，请刷新重试。"),
  ).toBeVisible();
  expect(generateRequest).not.toHaveBeenCalled();
  expect(removeResult).not.toHaveBeenCalled();
});
