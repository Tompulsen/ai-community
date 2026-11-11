import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { createRequire } from "node:module";
import type { GalleryImage, GalleryQuery } from "../app/store/gallery";
import type { VideoResult } from "../app/store/video";

type Page = { images: GalleryImage[]; after?: IDBValidKey };
const nextImage = createRequire(import.meta.url)("next/image").default;
jest.unstable_mockModule("next/image", () => ({ default: nextImage }));
const getImagePage = jest.fn<(query?: GalleryQuery) => Promise<Page>>();
const getGallerySummary =
  jest.fn<
    (query?: GalleryQuery) => Promise<{ count: number; models: string[] }>
  >();
const getStorageSize = jest.fn<() => Promise<string>>();
const getGallerySettings =
  jest.fn<() => Promise<{ autoSave: boolean; maxCount: number }>>();
const getImageBlob = jest.fn<() => Promise<Blob>>();
const releaseGalleryImages = jest.fn();
const showToast = jest.fn();
const copyToClipboard = jest.fn();
const navigate = jest.fn();
let scope = "user-1";
let active = true;
const allImages = jest.fn<() => Promise<GalleryImage[]>>();
const deleteImages = jest.fn<(...args: any[]) => Promise<void>>(async () => {});
const showConfirm = jest.fn(async () => true);
let videoResults: VideoResult[] = [];
const loadVideoDraft = jest.fn(async () => {});
const updateVideoResult = jest.fn<(...args: any[]) => Promise<void>>(
  async () => {},
);
jest.unstable_mockModule("@/app/store/video", () => ({
  useVideoStore: Object.assign(
    (selector: (state: { results: VideoResult[] }) => unknown) =>
      selector({ results: videoResults }),
    {
      getState: () => ({
        loadDraft: loadVideoDraft,
        updateResult: updateVideoResult,
      }),
    },
  ),
}));
jest.unstable_mockModule("@/app/components/gallery/gallery-video-card", () => ({
  GalleryVideoCard: ({
    result,
    batchMode,
    onReuse,
  }: {
    result: VideoResult;
    batchMode: boolean;
    onReuse: () => void;
  }) => (
    <div aria-label={`视频作品：${result.prompt}`}>
      {result.prompt}
      {!batchMode && (
        <button type="button" aria-label="复用配置" onClick={onReuse} />
      )}
    </div>
  ),
  galleryVideoBlob: jest.fn(),
}));
jest.unstable_mockModule("react-router-dom", () => ({
  useNavigate: () => navigate,
}));
jest.unstable_mockModule("@/app/store/gallery", () => ({
  getImagePage,
  getGallerySummary,
  getStorageSize,
  getGallerySettings,
  getImageBlob,
  releaseGalleryImages,
  getAllImages: allImages,
  deleteImages,
  saveGallerySettings: jest.fn(),
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showConfirm,
  showToast,
  Select: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));
jest.unstable_mockModule("@/app/utils", () => ({
  copyToClipboard,
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => scope,
  isLocalWorkspaceActive: () => active,
}));
jest.unstable_mockModule("@/app/components/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <header>{title}</header>,
  EmptyState: ({
    text,
    action,
  }: {
    text: string;
    action?: React.ReactNode;
  }) => (
    <div>
      {text}
      {action}
    </div>
  ),
  LoadingState: () => <div role="status">Loading</div>,
}));
jest.unstable_mockModule("@/app/components/gallery/lightbox", () => ({
  Lightbox: () => <div role="dialog" />,
}));
jest.unstable_mockModule("@/app/locales", () => ({
  getLang: () => "en",
  default: {
    Chat: { Actions: { Reuse: "复用配置" } },
    Gallery: {
      Title: "Gallery",
      Search: "Search",
      AllModels: "All models",
      TimeFilter: {
        All: "All time",
        Today: "Today",
        Week: "Week",
        Month: "Month",
        Year: "Year",
      },
      StorageInfo: (total: number) => `${total} images`,
      StorageSize: (size: string) => size,
      SelectImage: (prompt: string) => `Select ${prompt}`,
      BatchSelect: "Select",
      SelectAll: "Select all",
      DeleteSelected: "Delete selected",
      ConfirmDelete: "Remove works",
      ExportAll: "Export",
      Settings: "Settings",
      AutoSave: "Auto save",
      MaxCount: "Maximum",
      DeleteFailed: "Delete failed",
      Empty: "Empty",
      Local: "Local",
    },
    UI: { Retry: "Retry" },
  },
}));
const { GalleryPage } = await import("../app/components/gallery/gallery");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function image(id: string): GalleryImage {
  return {
    id,
    prompt: id,
    model: "image-model",
    width: 480,
    height: 270,
    createdAt: 1,
    imageData: "data:image/png;base64,aW1hZ2U=",
    status: "success",
  };
}

const originalCreateObjectURL = URL.createObjectURL;
beforeEach(() => {
  scope = "user-1";
  active = true;
  videoResults = [];
  allImages.mockReset().mockResolvedValue([]);
  deleteImages.mockClear();
  showConfirm.mockClear();
  loadVideoDraft.mockClear();
  updateVideoResult.mockClear();
  getImagePage.mockReset().mockResolvedValue({ images: [] });
  getGallerySummary
    .mockReset()
    .mockResolvedValue({ count: 1, models: ["image-model"] });
  getStorageSize.mockReset().mockResolvedValue("1 MB");
  getGallerySettings
    .mockReset()
    .mockResolvedValue({ autoSave: true, maxCount: 500 });
  getImageBlob.mockReset().mockResolvedValue(new Blob(["image"]));
  releaseGalleryImages.mockClear();
  showToast.mockClear();
  copyToClipboard.mockClear();
  navigate.mockClear();
  URL.createObjectURL = jest.fn(() => "blob:original");
});

function video(id: string, patch: Partial<VideoResult> = {}): VideoResult {
  return {
    id,
    url: "https://video.test/output.mp4",
    model: "sora-2",
    prompt: id,
    status: "success",
    createdAt: Date.now(),
    ...patch,
  };
}

test("an image exposes one reuse action that opens chat without copying or loading its output", async () => {
  getImagePage.mockResolvedValue({ images: [image("reuse-image")] });
  render(<GalleryPage />);
  await screen.findByAltText("reuse-image");
  const reuse = screen.getAllByRole("button", { name: "复用配置" });
  expect(reuse).toHaveLength(1);
  fireEvent.click(reuse[0]);
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith("/chat", {
    state: {
      reuseGalleryWork: { kind: "image", id: "reuse-image", scope: "user-1" },
    },
  });
  expect(copyToClipboard).not.toHaveBeenCalled();
  expect(getImageBlob).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a video reuse action opens the same chat handoff with its own work identity", async () => {
  videoResults = [video("reuse-video")];
  getGallerySummary.mockResolvedValue({ count: 0, models: [] });
  render(<GalleryPage />);
  await screen.findByLabelText("视频作品：reuse-video");
  fireEvent.click(screen.getByRole("button", { name: "复用配置" }));
  expect(navigate).toHaveBeenCalledWith("/chat", {
    state: {
      reuseGalleryWork: { kind: "video", id: "reuse-video", scope: "user-1" },
    },
  });
  expect(copyToClipboard).not.toHaveBeenCalled();
  expect(getImageBlob).not.toHaveBeenCalled();
});

test("batch mode hides reuse for both images and videos", async () => {
  getImagePage.mockResolvedValue({ images: [image("batch-image")] });
  videoResults = [video("batch-video")];
  render(<GalleryPage />);
  await screen.findByAltText("batch-image");
  expect(screen.getAllByRole("button", { name: "复用配置" })).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  expect(screen.queryByRole("button", { name: "复用配置" })).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
  expect(copyToClipboard).not.toHaveBeenCalled();
});

test("a stale gallery cannot hand an old work to another workspace", async () => {
  getImagePage.mockResolvedValue({ images: [image("old-work")] });
  render(<GalleryPage />);
  await screen.findByAltText("old-work");
  active = false;
  fireEvent.click(screen.getByRole("button", { name: "复用配置" }));
  expect(navigate).not.toHaveBeenCalled();
  expect(getImageBlob).not.toHaveBeenCalled();
});

test("historical successful videos appear even with no gallery images", async () => {
  videoResults = [
    video("completed-video"),
    video("pending", { status: "pending" }),
    video("failed", { status: "failed" }),
    video("hidden", { galleryHidden: true }),
    video("auto-save-off", {
      request: { autoSaveGallery: false } as VideoResult["request"],
    }),
    video("no-output", { url: "" }),
  ];
  getGallerySummary.mockResolvedValue({ count: 0, models: [] });
  render(<GalleryPage />);
  expect(
    await screen.findByLabelText("视频作品：completed-video"),
  ).toBeInTheDocument();
  expect(loadVideoDraft).toHaveBeenCalled();
  expect(screen.queryByLabelText("视频作品：pending")).toBeNull();
  expect(screen.queryByLabelText("视频作品：failed")).toBeNull();
  expect(screen.queryByLabelText("视频作品：hidden")).toBeNull();
  expect(screen.queryByLabelText("视频作品：auto-save-off")).toBeNull();
  expect(screen.queryByLabelText("视频作品：no-output")).toBeNull();
  expect(screen.queryByText("Empty")).toBeNull();
});

test("video works follow type, model and search filters", async () => {
  videoResults = [video("Ocean waves")];
  getGallerySummary.mockResolvedValue({ count: 0, models: [] });
  render(<GalleryPage />);
  await screen.findByLabelText("视频作品：Ocean waves");
  fireEvent.change(screen.getByRole("combobox", { name: "作品类型" }), {
    target: { value: "image" },
  });
  await screen.findByText("没有找到匹配的作品");
  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
  await screen.findByLabelText("视频作品：Ocean waves");
  fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
    target: { value: "unmatched" },
  });
  await waitFor(() =>
    expect(screen.queryByLabelText("视频作品：Ocean waves")).toBeNull(),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
    target: { value: "Ocean" },
  });
  await screen.findByLabelText("视频作品：Ocean waves");
  expect(screen.getByRole("option", { name: "sora-2" })).toBeInTheDocument();
});

test("video-only pagination works after the image cursor is exhausted", async () => {
  videoResults = Array.from({ length: 61 }, (_, index) =>
    video(`video-${index}`, { createdAt: 1000 - index }),
  );
  getGallerySummary.mockResolvedValue({ count: 0, models: [] });
  render(<GalleryPage />);
  await screen.findByLabelText("视频作品：video-0");
  expect(screen.queryByLabelText("视频作品：video-60")).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: /^加载更多/ }));
  await screen.findByLabelText("视频作品：video-60");
  expect(screen.queryByRole("button", { name: /^加载更多/ })).toBeNull();
});

test("older videos wait behind unloaded newer images in mixed pagination", async () => {
  videoResults = [video("old-video", { createdAt: 1 })];
  const recent = Array.from({ length: 60 }, (_, index) => ({
    ...image(`recent-${index}`),
    createdAt: 100 - index,
  }));
  getImagePage
    .mockResolvedValueOnce({ images: recent, after: "next" })
    .mockResolvedValueOnce({
      images: [{ ...image("last-image"), createdAt: 2 }],
    })
    .mockResolvedValueOnce({ images: recent, after: "next" });
  getGallerySummary.mockResolvedValue({ count: 61, models: ["image-model"] });
  render(<GalleryPage />);
  const loadMore = await screen.findByRole("button", { name: /^加载更多/ });
  expect(screen.queryByLabelText("视频作品：old-video")).toBeNull();
  await waitFor(() => expect(loadMore).not.toBeDisabled());
  fireEvent.click(loadMore);
  await screen.findByLabelText("视频作品：old-video");
  const library = screen.getByLabelText("视频作品：old-video").parentElement!;
  expect(library.lastElementChild).toHaveAttribute(
    "aria-label",
    "视频作品：old-video",
  );
  act(() => window.dispatchEvent(new Event("gallery-changed")));
  await waitFor(() =>
    expect(screen.queryByLabelText("视频作品：old-video")).toBeNull(),
  );
});

test("leaving during export preparation prevents image and video downloads", async () => {
  const pending = deferred<GalleryImage[]>();
  videoResults = [video("export-video")];
  allImages.mockReturnValueOnce(pending.promise);
  const view = render(<GalleryPage />);
  await screen.findByLabelText("视频作品：export-video");
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  view.unmount();
  await act(async () => pending.resolve([image("export-image")]));
  expect(getImageBlob).not.toHaveBeenCalled();
});

test("batch selection distinguishes equal image and video IDs and preserves video history", async () => {
  videoResults = [video("same-id")];
  allImages.mockResolvedValue([image("same-id")]);
  getImagePage.mockResolvedValue({ images: [image("same-id")] });
  render(<GalleryPage />);
  await screen.findByLabelText("视频作品：same-id");
  await waitFor(() => expect(getGallerySettings).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  const remove = await screen.findByRole("button", {
    name: "Delete selected (2)",
  });
  fireEvent.click(remove);
  await waitFor(() => expect(deleteImages).toHaveBeenCalledWith(["same-id"]));
  expect(updateVideoResult).toHaveBeenCalledWith("same-id", {
    galleryHidden: true,
  });
});
afterAll(() => {
  URL.createObjectURL = originalCreateObjectURL;
});

test("releases an in-flight page after unmount without reading more storage", async () => {
  const pending = deferred<Page>();
  const stale = image("stale");
  getImagePage.mockReturnValueOnce(pending.promise);
  const view = render(<GalleryPage />);
  expect(getImagePage).toHaveBeenCalledTimes(1);
  view.unmount();

  await act(async () => pending.resolve({ images: [stale] }));

  expect(releaseGalleryImages).toHaveBeenCalledWith([stale]);
  expect(getStorageSize).not.toHaveBeenCalled();
  expect(getGallerySettings).not.toHaveBeenCalled();
});

test("offers image creation and hides batch actions when the entire library is empty", async () => {
  getGallerySummary.mockResolvedValue({ count: 0, models: [] });
  render(<GalleryPage />);

  fireEvent.click(await screen.findByRole("button", { name: "开始生图" }));

  expect(navigate).toHaveBeenCalledWith("/chat", {
    state: { selectImageModel: true },
  });
  expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
  expect(screen.queryByRole("button", { name: "清除筛选" })).toBeNull();
});

test("clears search, model and date filters when there are no matching images", async () => {
  const filtered = (query?: GalleryQuery) =>
    !!(query?.query || query?.model || query?.since);
  getImagePage.mockImplementation(async (query) => ({
    images: filtered(query) ? [] : [image("available")],
  }));
  getGallerySummary.mockImplementation(async (query) => ({
    count: filtered(query) ? 0 : 1,
    models: ["image-model"],
  }));
  render(<GalleryPage />);
  await screen.findByAltText("available");
  const search = screen.getByRole("textbox", { name: "Search" });
  const model = screen.getByRole("combobox", { name: "All models" });
  const time = screen.getByRole("combobox", { name: "All time" });
  fireEvent.change(search, { target: { value: "no match" } });
  fireEvent.change(model, { target: { value: "image-model" } });
  fireEvent.change(time, { target: { value: "week" } });

  await screen.findByText("没有找到匹配的作品");
  expect(screen.queryByText("Empty")).toBeNull();
  expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));

  await screen.findByAltText("available");
  expect(search).toHaveValue("");
  expect(model).toHaveValue("");
  expect(time).toHaveValue("");
  expect(getImagePage).toHaveBeenLastCalledWith({
    query: "",
    model: "",
    since: undefined,
  });
});

test("shows retry without an empty state after a load error and recovers", async () => {
  const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
  getImagePage
    .mockRejectedValueOnce(new Error("storage unavailable"))
    .mockResolvedValueOnce({ images: [image("recovered")] });
  render(<GalleryPage />);

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("作品加载失败，请重试");
  expect(screen.queryByText("Empty")).toBeNull();
  expect(screen.queryByRole("button", { name: "开始生图" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));

  await screen.findByAltText("recovered");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
  errorLog.mockRestore();
});

test("keeps the latest search results when an earlier page settles later", async () => {
  const pending = deferred<Page>();
  const stale = image("stale");
  const latest = image("latest");
  getImagePage
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ images: [latest] });
  render(<GalleryPage />);
  fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
    target: { value: "latest" },
  });
  const preview = await screen.findByAltText("latest");
  expect(preview).toHaveAttribute("data-nimg", "fill");
  expect(preview).not.toHaveAttribute("srcset");
  expect(preview).toHaveAttribute("loading", "lazy");

  await act(async () => pending.resolve({ images: [stale] }));

  expect(screen.getByAltText("latest")).toBe(preview);
  expect(screen.queryByAltText("stale")).toBeNull();
  expect(releaseGalleryImages).toHaveBeenCalledWith([stale]);
  expect(getStorageSize).toHaveBeenCalledTimes(1);
});

test("keeps current storage information when an earlier read settles later", async () => {
  const pending = deferred<string>();
  getImagePage
    .mockResolvedValueOnce({ images: [image("initial")] })
    .mockResolvedValueOnce({ images: [image("latest")] });
  getStorageSize.mockReturnValueOnce(pending.promise);
  render(<GalleryPage />);
  await waitFor(() => expect(getStorageSize).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
    target: { value: "latest" },
  });
  await waitFor(() => expect(getGallerySettings).toHaveBeenCalledTimes(1));

  await act(async () => pending.resolve("stale storage"));

  expect(screen.getByText("1 MB")).toBeInTheDocument();
  expect(screen.queryByText("stale storage")).toBeNull();
  expect(getGallerySettings).toHaveBeenCalledTimes(1);
});

test("keeps current settings when an earlier read settles later", async () => {
  const pending = deferred<{ autoSave: boolean; maxCount: number }>();
  getImagePage
    .mockResolvedValueOnce({ images: [image("initial")] })
    .mockResolvedValueOnce({ images: [image("latest")] });
  getGallerySettings
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ autoSave: false, maxCount: 700 });
  render(<GalleryPage />);
  await waitFor(() => expect(getGallerySettings).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
    target: { value: "latest" },
  });
  await waitFor(() => expect(screen.getByRole("spinbutton")).toHaveValue(700));

  await act(async () => pending.resolve({ autoSave: true, maxCount: 900 }));

  expect(screen.getByRole("spinbutton")).toHaveValue(700);
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});

test("settings remain open during label activation and close only when focus moves outside", async () => {
  render(<GalleryPage />);
  await waitFor(() => expect(getGallerySettings).toHaveBeenCalledTimes(1));
  const summary = screen.getByRole("button", { name: "Settings" });
  const details = summary.closest("details")!;
  details.open = true;

  fireEvent.blur(summary, { relatedTarget: null });
  expect(details.open).toBe(true);

  fireEvent.blur(summary, {
    relatedTarget: screen.getByRole("checkbox", { name: "Auto save" }),
  });
  expect(details.open).toBe(true);

  fireEvent.blur(summary, {
    relatedTarget: screen.getByRole("button", { name: "开始生图" }),
  });
  expect(details.open).toBe(false);
});

test("ignores a load-more failure from an earlier search", async () => {
  const pending = deferred<Page>();
  getImagePage
    .mockResolvedValueOnce({ images: [image("initial")], after: "next" })
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ images: [image("latest")] });
  render(<GalleryPage />);
  const loadMore = await screen.findByRole("button", {
    name: /^加载更多/,
  });
  await waitFor(() => expect(loadMore).not.toBeDisabled());
  fireEvent.click(loadMore);
  await waitFor(() => expect(getImagePage).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
    target: { value: "latest" },
  });
  const latest = await screen.findByAltText("latest");

  await act(async () => pending.reject(new Error("stale page")));

  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByAltText("latest")).toBe(latest);
});

test.each(["resolve", "reject"] as const)(
  "ignores an original image request after leaving the gallery (%s)",
  async (result) => {
    const pending = deferred<Blob>();
    const original = image("original");
    getImagePage.mockResolvedValueOnce({ images: [original] });
    getImageBlob.mockReturnValueOnce(pending.promise);
    const view = render(<GalleryPage />);
    const preview = await screen.findByAltText("original");
    // JSDOM does not apply the gallery's positioned square layout.
    preview.parentElement!.style.position = "relative";
    Object.defineProperties(preview, {
      width: { value: 240 },
      height: { value: 240 },
    });
    fireEvent.load(preview);
    await waitFor(() => expect(preview).toHaveAttribute("tabindex", "0"));
    fireEvent.click(preview);
    await waitFor(() => expect(getImageBlob).toHaveBeenCalledWith("original"));
    view.unmount();

    await act(async () => {
      if (result === "reject") pending.reject(new Error("stale original"));
      else pending.resolve(new Blob(["original"]));
    });

    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(releaseGalleryImages).toHaveBeenCalledWith([original]);
  },
);
