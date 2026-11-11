import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { createRequire } from "node:module";
import { create } from "zustand";
import type { VideoResult } from "../app/store/video";
const nextImage = createRequire(import.meta.url)("next/image").default;
jest.unstable_mockModule("next/image", () => ({ default: nextImage }));

const useAccessStore = create(() => ({
  openaiUrl: "https://api.test",
  openaiApiKey: "first-key",
  useCustomConfig: true,
}));
const fetchVideoMedia =
  jest.fn<(result: VideoResult, signal: AbortSignal) => Promise<Blob>>();
const readMedia = jest.fn<() => Promise<Blob>>();
const createObjectURL = jest.fn(() => "blob:gallery-video");
const revokeObjectURL = jest.fn();
const POSTER = "data:image/jpeg;base64,cG9zdGVy";
const extractVideoPoster =
  jest.fn<
    (
      source: string,
      signal: AbortSignal,
    ) => Promise<{ poster: string; duration?: number } | undefined>
  >();
const updateVideoResult =
  jest.fn<(id: string, patch: Partial<VideoResult>) => Promise<void>>();
let videoResults: VideoResult[] = [];
let scope = "user-1";
let active = true;

jest.unstable_mockModule("@/app/store/access", () => ({ useAccessStore }));
jest.unstable_mockModule("@/app/store/video", () => ({
  useVideoStore: {
    getState: () => ({
      results: videoResults,
      updateResult: updateVideoResult,
    }),
  },
}));
jest.unstable_mockModule("@/app/utils/video-media", () => ({
  fetchVideoMedia,
}));
jest.unstable_mockModule("@/app/utils/video-poster", () => ({
  cachedVideoPoster: (result: VideoResult) => result.coverUrl,
  videoPosterCapture: () => jest.fn(),
  extractVideoPoster,
}));
jest.unstable_mockModule("@/app/utils/community-share", () => ({
  readMedia,
  videoGenerationMetadata: jest.fn(),
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => scope,
  isLocalWorkspaceActive: () => active,
}));
jest.unstable_mockModule("@/app/utils/video-api", () => ({
  buildVideoRequest: () => ({ body: {} }),
}));
jest.unstable_mockModule("@/app/utils/model", () => ({
  getModelProvider: () => ["sora-2"],
}));
jest.unstable_mockModule("@/app/components/community-share-button", () => ({
  CommunityShareButton: () => null,
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showToast: jest.fn(),
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: { Chat: { Actions: { Reuse: "复用配置" } } },
}));

const { GalleryVideoCard } = await import(
  "../app/components/gallery/gallery-video-card"
);
const originalMatchMedia = Object.getOwnPropertyDescriptor(
  window,
  "matchMedia",
);
const originalShow = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const originalClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);
const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
const originalObserver = Object.getOwnPropertyDescriptor(
  globalThis,
  "IntersectionObserver",
);
const pause = jest.fn();
const play = jest.fn<() => Promise<void>>(async () => {});
const onSelect = jest.fn();
const onDelete = jest.fn();
const onDownload = jest.fn<() => Promise<void>>(async () => {});
const onReuse = jest.fn();

function video(patch: Partial<VideoResult> = {}): VideoResult {
  return {
    id: "video-1",
    prompt: "Ocean waves",
    model: "sora-2",
    url: "https://media.test/original.mp4",
    status: "success",
    duration: 8,
    createdAt: 1,
    ...patch,
  };
}

function card(result: VideoResult, batchMode = false) {
  videoResults = [result];
  return (
    <GalleryVideoCard
      result={result}
      batchMode={batchMode}
      selected={false}
      onSelect={onSelect}
      onDelete={onDelete}
      onDownload={onDownload}
      onReuse={onReuse}
    />
  );
}

function openPreview() {
  const cover = screen.getByRole("button", {
    name: "预览视频 Ocean waves",
  });
  cover.focus();
  fireEvent.click(cover);
  const dialog = screen.getByRole("dialog", { name: "视频预览" });
  const player = within(dialog).getByLabelText(
    "播放视频 Ocean waves",
  ) as HTMLVideoElement;
  return { cover, dialog, player };
}

function finishExit() {
  act(() => jest.advanceTimersByTime(220));
  act(() => jest.runAllTicks());
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  scope = "user-1";
  active = true;
  videoResults = [];
  useAccessStore.setState({
    openaiUrl: "https://api.test",
    openaiApiKey: "first-key",
    useCustomConfig: true,
  });
  fetchVideoMedia.mockReset().mockResolvedValue(new Blob(["video"]));
  extractVideoPoster
    .mockReset()
    .mockResolvedValue({ poster: POSTER, duration: 8 });
  updateVideoResult.mockReset().mockResolvedValue();
  play.mockReset().mockResolvedValue();
  document.body.classList.remove("reduce-motion");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
      this.querySelector<HTMLButtonElement>("button")?.focus();
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: undefined,
  });
  jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
  jest.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{ width: 40, height: 40 }] as unknown as DOMRectList);
});

afterEach(() => {
  cleanup();
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
  for (const [target, property, descriptor] of [
    [window, "matchMedia", originalMatchMedia],
    [HTMLDialogElement.prototype, "showModal", originalShow],
    [HTMLDialogElement.prototype, "close", originalClose],
    [URL, "createObjectURL", originalCreate],
    [URL, "revokeObjectURL", originalRevoke],
    [globalThis, "IntersectionObserver", originalObserver],
  ] as const) {
    if (descriptor) Object.defineProperty(target, property, descriptor);
    else Reflect.deleteProperty(target, property);
  }
});

test("reuse invokes its callback once without opening or downloading the output", () => {
  render(
    card(
      video({
        coverUrl: "https://media.test/cover.jpg",
        mediaPath: "/media/private-video",
      }),
    ),
  );
  expect(screen.getAllByRole("button", { name: "复用配置" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "复用配置" }));
  expect(onReuse).toHaveBeenCalledTimes(1);
  expect(onSelect).not.toHaveBeenCalled();
  expect(onDelete).not.toHaveBeenCalled();
  expect(onDownload).not.toHaveBeenCalled();
  expect(fetchVideoMedia).not.toHaveBeenCalled();
  expect(readMedia).not.toHaveBeenCalled();
  expect(play).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a known cover is immediately interactive without downloading video bytes", async () => {
  const pending = deferred<Blob>();
  fetchVideoMedia.mockReturnValueOnce(pending.promise);
  render(
    card(
      video({
        coverUrl: "https://media.test/cover.jpg",
        mediaPath: "/media/private-video",
      }),
    ),
  );
  await act(async () => {});
  const cover = screen.getByRole("button", { name: "预览视频 Ocean waves" });
  expect(cover.querySelector("img")).toHaveAttribute(
    "src",
    "https://media.test/cover.jpg",
  );
  expect(fetchVideoMedia).not.toHaveBeenCalled();
  expect(extractVideoPoster).not.toHaveBeenCalled();
  expect(createObjectURL).not.toHaveBeenCalled();
  fireEvent.click(cover);
  expect(screen.getByRole("dialog", { name: "视频预览" })).toHaveTextContent(
    "正在加载视频",
  );
  expect(fetchVideoMedia).toHaveBeenCalledTimes(1);
  await act(async () =>
    pending.resolve(new Blob(["video"], { type: "video/mp4" })),
  );
  expect(screen.getByLabelText("播放视频 Ocean waves")).toHaveAttribute(
    "src",
    "blob:gallery-video",
  );
  expect(fetchVideoMedia).toHaveBeenCalledTimes(1);
});

test("closing a still-loading covered video never reopens the dialog on completion", async () => {
  const pending = deferred<Blob>();
  fetchVideoMedia.mockReturnValueOnce(pending.promise);
  render(
    card(
      video({
        coverUrl: "https://media.test/cover.jpg",
        mediaPath: "/media/private-video",
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "预览视频 Ocean waves" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "关闭" }),
  );
  finishExit();
  await act(async () =>
    pending.resolve(new Blob(["video"], { type: "video/mp4" })),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("batch selection of a covered video never downloads it", () => {
  render(
    card(
      video({
        coverUrl: "https://media.test/cover.jpg",
        mediaPath: "/media/private-video",
      }),
      true,
    ),
  );
  expect(screen.queryByRole("button", { name: "复用配置" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "预览视频 Ocean waves" }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onReuse).not.toHaveBeenCalled();
  expect(fetchVideoMedia).not.toHaveBeenCalled();
});

test("a separately extracted image covers the list and shares the original with playback", async () => {
  render(card(video({ mediaPath: "/media/private-video" })));
  await act(async () => {});
  const cover = screen.getByRole("button", {
    name: "预览视频 Ocean waves",
  });
  expect(cover).toHaveAttribute("type", "button");
  expect(cover.querySelector("video")).toBeNull();
  expect(cover.querySelector("img")).toHaveAttribute("src", POSTER);
  expect(document.querySelector("video")).toBeNull();
  expect(extractVideoPoster).toHaveBeenCalledTimes(1);
  expect(extractVideoPoster).toHaveBeenCalledWith(
    "blob:gallery-video",
    expect.any(AbortSignal),
  );
  expect(updateVideoResult).toHaveBeenCalledWith("video-1", {
    coverUrl: POSTER,
  });

  const { player } = openPreview();
  expect(player).toHaveAttribute("src", "blob:gallery-video");
  expect(player).toHaveAttribute("autoplay");
  expect(player).toHaveAttribute("controls");
  expect(player).toHaveAttribute("playsinline");
  expect(player).toHaveAttribute("tabindex", "0");
  expect(player).toHaveFocus();
  expect(fetchVideoMedia).toHaveBeenCalledTimes(1);
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  expect(readMedia).not.toHaveBeenCalled();
});

test("opening requests playback once without restarting it on metadata updates or closing", async () => {
  extractVideoPoster.mockResolvedValueOnce({ poster: POSTER });
  render(card(video({ duration: undefined })));
  await act(async () => {});
  const { cover, dialog, player } = openPreview();
  expect(play).toHaveBeenCalledTimes(1);
  expect(play.mock.contexts).toContain(player);
  player.pause();
  Object.defineProperty(player, "duration", {
    configurable: true,
    value: 2.5,
  });
  fireEvent.loadedMetadata(player);
  expect(cover).toHaveTextContent("2.5 秒");
  expect(play).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  finishExit();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(play).toHaveBeenCalledTimes(1);
});

test("a blocked playback request keeps the native controls available", async () => {
  play.mockRejectedValueOnce(
    new DOMException("Playback requires user activation", "NotAllowedError"),
  );
  render(card(video()));
  const { player } = openPreview();
  await act(async () => {});
  expect(play).toHaveBeenCalledTimes(1);
  expect(player).toHaveAttribute("controls");
  expect(player).toHaveAttribute("src", "https://media.test/original.mp4");
  expect(screen.getByRole("dialog", { name: "视频预览" })).not.toHaveAttribute(
    "data-closing",
  );
});

test("a missing duration uses the extracted duration without a list video", async () => {
  extractVideoPoster.mockResolvedValueOnce({
    poster: POSTER,
    duration: 2.54,
  });
  render(
    card(
      video({
        duration: undefined,
        mediaPath: "/media/private-video",
      }),
    ),
  );
  await act(async () => {});
  const cover = screen.getByRole("button", {
    name: "预览视频 Ocean waves",
  });
  expect(cover.querySelector("video")).toBeNull();
  expect(cover).toHaveTextContent("2.5 秒");
  expect(fetchVideoMedia).toHaveBeenCalledTimes(1);
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  expect(readMedia).not.toHaveBeenCalled();
});

test("a missing duration ignores invalid playback metadata and accepts a valid value", async () => {
  extractVideoPoster.mockResolvedValueOnce({ poster: POSTER });
  render(card(video({ duration: undefined })));
  await act(async () => {});
  const { cover, player } = openPreview();
  expect(cover).not.toHaveTextContent("秒");
  for (const duration of [NaN, Infinity, 0, -1]) {
    Object.defineProperty(player, "duration", {
      configurable: true,
      value: duration,
    });
    fireEvent.loadedMetadata(player);
    expect(cover).not.toHaveTextContent("秒");
  }
  Object.defineProperty(player, "duration", {
    configurable: true,
    value: 2.54,
  });
  fireEvent.loadedMetadata(player);
  expect(cover).toHaveTextContent("2.5 秒");
});

test("Escape keeps the existing exit animation and restores focus to the cover", async () => {
  render(card(video()));
  await act(async () => {});
  const { cover, dialog, player } = openPreview();
  const close = within(dialog).getByRole("button", { name: "关闭" });
  fireEvent.keyDown(player, { key: "Tab" });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(player).toHaveFocus();
  fireEvent.keyDown(player, { key: "Escape" });
  expect(dialog).toHaveAttribute("data-closing", "true");
  expect(dialog).toHaveAttribute("open");
  finishExit();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(cover).toHaveFocus();
  expect(pause.mock.contexts).toContain(player);
});

test("batch mode selects once and entering it closes the current player", async () => {
  const result = video();
  const view = render(card(result, true));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "预览视频 Ocean waves" }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  view.rerender(card(result));
  const { player } = openPreview();
  view.rerender(card(result, true));
  expect(screen.queryByLabelText("播放视频 Ocean waves")).toBeNull();
  expect(pause.mock.contexts).toContain(player);
  finishExit();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(onSelect).toHaveBeenCalledTimes(1);
});

test.each([
  "local-workspace-switch",
  "local-data-maintenance",
  "model-source-changing",
])("%s removes the old playable source immediately", async (eventName) => {
  render(
    card(
      video({
        mediaPath: "/media/private-video",
        customApiBase: "https://api.test",
      }),
    ),
  );
  await act(async () => {});
  const { player } = openPreview();
  act(() => window.dispatchEvent(new Event(eventName)));
  expect(screen.queryByLabelText("播放视频 Ocean waves")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent(
    "账号或接口已切换，请重新加载",
  );
  expect(pause.mock.contexts).toContain(player);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:gallery-video");
  finishExit();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("custom provider changes discard a late old response before creating its object URL", async () => {
  const pending = deferred<Blob>();
  fetchVideoMedia.mockReturnValueOnce(pending.promise);
  render(
    card(
      video({
        mediaPath: "/media/private-video",
        customApiBase: "https://api.test",
      }),
    ),
  );
  const firstSignal = fetchVideoMedia.mock.calls[0][1];
  act(() => useAccessStore.setState({ openaiApiKey: "next-key" }));
  await act(async () => {});
  expect(firstSignal.aborted).toBe(true);
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(new Blob(["stale video"])));
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  expect(
    screen
      .getByRole("button", { name: "预览视频 Ocean waves" })
      .querySelector("img"),
  ).toHaveAttribute("src", POSTER);
});

test("unmount pauses the active player and revokes its original object URL", async () => {
  const view = render(card(video({ mediaPath: "/media/private-video" })));
  await act(async () => {});
  const { player } = openPreview();
  pause.mockClear();
  view.unmount();
  expect(pause.mock.contexts).toContain(player);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:gallery-video");
});

test("failed media remains reloadable and a recovered preview uses the fresh source", async () => {
  fetchVideoMedia.mockRejectedValueOnce(new Error("media unavailable"));
  render(card(video({ mediaPath: "/media/private-video" })));
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("media unavailable");
  expect(
    screen.queryByRole("button", { name: "预览视频 Ocean waves" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  await act(async () => {});
  const { player } = openPreview();
  expect(player).toHaveAttribute("src", "blob:gallery-video");
  expect(fetchVideoMedia).toHaveBeenCalledTimes(2);
});

test.each(["rejected", "all black"] as const)(
  "a %s poster leaves playback available and can be extracted again",
  async (failure) => {
    if (failure === "rejected")
      extractVideoPoster.mockRejectedValueOnce(new Error("Cannot capture"));
    else extractVideoPoster.mockResolvedValueOnce(undefined);
    render(card(video({ mediaPath: "/media/private-video" })));
    await act(async () => {});
    const cover = screen.getByRole("button", {
      name: "预览视频 Ocean waves",
    });
    expect(cover.querySelector("img")).toBeNull();
    expect(cover.querySelector("video")).toBeNull();
    expect(updateVideoResult).not.toHaveBeenCalled();
    const { dialog, player } = openPreview();
    expect(player).toHaveAttribute("src", "blob:gallery-video");
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    finishExit();

    fireEvent.click(screen.getByRole("button", { name: "重新提取封面" }));
    await act(async () => {});
    expect(extractVideoPoster).toHaveBeenCalledTimes(2);
    expect(cover.querySelector("img")).toHaveAttribute("src", POSTER);
    expect(fetchVideoMedia).toHaveBeenCalledTimes(1);
    expect(updateVideoResult).toHaveBeenCalledWith("video-1", {
      coverUrl: POSTER,
    });
  },
);

test("an unreadable stored cover is replaced by an independent frame", async () => {
  render(
    card(
      video({
        coverUrl: "https://media.test/expired-cover.jpg",
        mediaPath: "/media/private-video",
      }),
    ),
  );
  const image = screen.getByRole("img", { name: "Ocean waves" });
  expect(fetchVideoMedia).not.toHaveBeenCalled();
  fireEvent.error(image);
  await act(async () => {});
  expect(fetchVideoMedia).toHaveBeenCalledTimes(1);
  expect(extractVideoPoster).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("img", { name: "Ocean waves" })).toHaveAttribute(
    "src",
    POSTER,
  );
  expect(updateVideoResult).toHaveBeenCalledWith("video-1", {
    coverUrl: POSTER,
  });
});

test.each(["account", "deletion", "source"] as const)(
  "a poster that finishes after %s changes cannot be persisted",
  async (change) => {
    const pending = deferred<{ poster: string; duration: number }>();
    extractVideoPoster
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(undefined);
    const result = video({ mediaPath: "/media/private-video" });
    const view = render(card(result));
    await act(async () => {});
    expect(extractVideoPoster).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (change === "account") scope = "user-2";
      else if (change === "deletion") videoResults = [];
      else
        view.rerender(
          card(
            video({
              mediaPath: "/media/replaced-video",
              url: "https://media.test/replaced.mp4",
            }),
          ),
        );
    });
    await act(async () => pending.resolve({ poster: POSTER, duration: 8 }));
    expect(updateVideoResult).not.toHaveBeenCalled();
    expect(screen.queryByRole("img", { name: "Ocean waves" })).toBeNull();
  },
);

test("persisting a new cover never closes playback or redownloads the source", async () => {
  const result = video({
    coverUrl: "https://media.test/cover.jpg",
    mediaPath: "/media/private-video",
  });
  const view = render(card(result));
  fireEvent.click(screen.getByRole("button", { name: "预览视频 Ocean waves" }));
  await act(async () => {});
  const dialog = screen.getByRole("dialog", { name: "视频预览" });
  const player = within(dialog).getByLabelText("播放视频 Ocean waves");
  view.rerender(card({ ...result, coverUrl: POSTER }));
  await act(async () => {});
  expect(screen.getByRole("dialog", { name: "视频预览" })).toBe(dialog);
  expect(dialog).not.toHaveAttribute("data-closing");
  expect(within(dialog).getByLabelText("播放视频 Ocean waves")).toBe(player);
  expect(player).toHaveAttribute("src", "blob:gallery-video");
  expect(fetchVideoMedia).toHaveBeenCalledTimes(1);
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  expect(play).toHaveBeenCalledTimes(1);
});

test("a local poster save failure leaves the video successful and playable", async () => {
  updateVideoResult.mockRejectedValueOnce(
    new Error("Local storage is unavailable"),
  );
  const result = video({ mediaPath: "/media/private-video" });
  render(card(result));
  await act(async () => {});
  expect(screen.getByRole("img", { name: "Ocean waves" })).toHaveAttribute(
    "src",
    POSTER,
  );
  expect(updateVideoResult.mock.calls).toEqual([
    ["video-1", { coverUrl: POSTER }],
  ]);
  expect(result).toMatchObject({ status: "success" });
  expect(result.error).toBeUndefined();
  const { player } = openPreview();
  expect(player).toHaveAttribute("src", "blob:gallery-video");
});
