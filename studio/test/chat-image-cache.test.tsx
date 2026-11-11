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

const nextImage = createRequire(import.meta.url)("next/image").default;
jest.unstable_mockModule("next/image", () => ({ default: nextImage }));
let owner = "user-7";
const loadAsset =
  jest.fn<typeof import("../app/utils/image-asset").loadImageAsset>();
const decode = jest.fn<() => Promise<void>>();
const dimensions =
  jest.fn<typeof import("../app/store/gallery").getImageDimensions>();
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => owner,
}));
jest.unstable_mockModule("@/app/utils/image-asset", () => ({
  loadImageAsset: loadAsset,
}));
jest.unstable_mockModule("@/app/store/gallery", () => ({
  getImageDimensions: dimensions,
}));
const { ChatImage } = await import("../app/components/chat-image");
const originalObserver = Object.getOwnPropertyDescriptor(
  globalThis,
  "IntersectionObserver",
);

function observeVisibility() {
  const observers: {
    callback: IntersectionObserverCallback;
    observer: IntersectionObserver;
    options?: IntersectionObserverInit;
  }[] = [];
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: jest.fn(
      (
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) => {
        const observer = {
          observe: jest.fn(),
          unobserve: jest.fn(),
          disconnect: jest.fn(),
        } as unknown as IntersectionObserver;
        observers.push({ callback, observer, options });
        return observer;
      },
    ),
  });
  return observers;
}

function intersect(
  record: ReturnType<typeof observeVisibility>[number],
  isIntersecting = true,
) {
  act(() =>
    record.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      record.observer,
    ),
  );
}

beforeEach(() => {
  owner = "user-7";
  loadAsset
    .mockReset()
    .mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  decode.mockReset().mockResolvedValue(undefined);
  dimensions.mockReset().mockResolvedValue({ width: 480, height: 270 });
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: class {
      src = "";
      naturalWidth = 480;
      naturalHeight = 270;
      decode = decode;
    },
  });
  URL.createObjectURL = jest.fn(() => `blob:${Math.random()}`);
  URL.revokeObjectURL = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
  if (originalObserver)
    Object.defineProperty(globalThis, "IntersectionObserver", originalObserver);
  else Reflect.deleteProperty(globalThis, "IntersectionObserver");
});

test("returning to a decoded image shows the same URL and size immediately", async () => {
  const props = {
    src: "https://fixture/return.png",
    imageId: "return",
    alt: "return image",
  };
  const first = render(<ChatImage {...props} />);
  const image = await screen.findByAltText("return image");
  const url = image.getAttribute("src");
  expect(image).toHaveAttribute("width", "480");
  expect(image).toHaveAttribute("height", "270");
  expect(image).not.toHaveAttribute("srcset");
  first.unmount();
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url);
  const observers = observeVisibility();
  decode.mockImplementation(() => new Promise(() => {}));
  render(<ChatImage {...props} />);
  expect(screen.getByAltText("return image").getAttribute("src")).toBe(url);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByAltText("return image").style.animation).toBe("none");
  expect(
    screen
      .getByAltText("return image")
      .parentElement?.style.getPropertyValue("--image-ratio"),
  ).toBe(String(480 / 270));
  expect(loadAsset).toHaveBeenCalledTimes(1);
  expect(decode).toHaveBeenCalledTimes(1);
  expect(observers).toHaveLength(0);
});

test("a different account cannot reuse another account's decoded image", async () => {
  const props = {
    src: "https://fixture/private.png",
    imageId: "private",
    alt: "private image",
  };
  const first = render(<ChatImage {...props} />);
  const url = (await screen.findByAltText("private image")).getAttribute("src");
  first.unmount();
  owner = "user-8";
  const observers = observeVisibility();
  render(<ChatImage {...props} />);
  expect(screen.queryByAltText("private image")).toBeNull();
  expect(loadAsset).toHaveBeenCalledTimes(1);
  intersect(observers[0]);
  await waitFor(() => expect(loadAsset).toHaveBeenCalledTimes(2));
  expect(
    (await screen.findByAltText("private image")).getAttribute("src"),
  ).not.toBe(url);
});

test("a mounted image refreshes its cache key when the account changes", async () => {
  const props = {
    src: "https://fixture/account-rerender.png",
    imageId: "account-rerender",
    alt: "account rerender image",
  };
  const view = render(<ChatImage {...props} />);
  const firstUrl = (
    await screen.findByAltText("account rerender image")
  ).getAttribute("src");
  owner = "user-8";
  view.rerender(<ChatImage {...props} />);
  expect(screen.queryByAltText("account rerender image")).toBeNull();
  expect(
    (await screen.findByAltText("account rerender image")).getAttribute("src"),
  ).not.toBe(firstUrl);
  expect(loadAsset).toHaveBeenCalledTimes(2);
  expect(decode).toHaveBeenCalledTimes(2);
});

test("evicts older idle previews without revoking the mounted image", async () => {
  const urls: string[] = [];
  for (let index = 0; index < 6; index++) {
    const view = render(
      <ChatImage
        src={`https://fixture/evict-${index}.png`}
        alt="eviction image"
      />,
    );
    const image = await screen.findByAltText("eviction image");
    const url = image.getAttribute("src")!;
    urls.push(url);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url);
    view.unmount();
  }
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(urls[0]);
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(urls.at(-1));
});

test("offscreen images retain metadata and reserve space without loading or timing", async () => {
  const observers = observeVisibility();
  const interval = jest.spyOn(window, "setInterval");
  const { getByTestId } = render(
    <div data-testid="scroll" style={{ overflowY: "auto" }}>
      <ChatImage
        src="https://fixture/offscreen.png"
        imageId="offscreen"
        alt="offscreen image"
      />
    </div>,
  );
  await act(async () => {});
  expect(dimensions).toHaveBeenCalledWith("offscreen");
  expect(observers).toHaveLength(1);
  expect(observers[0].options).toEqual({
    root: getByTestId("scroll"),
    rootMargin: "400px 0px",
  });
  expect(
    screen
      .getByRole("status")
      .parentElement?.style.getPropertyValue("--image-ratio"),
  ).toBe(String(480 / 270));
  intersect(observers[0], false);
  expect(loadAsset).not.toHaveBeenCalled();
  expect(decode).not.toHaveBeenCalled();
  expect(interval).not.toHaveBeenCalled();
});

test("entering the preload range loads once and preserves original-image clicks", async () => {
  const observers = observeVisibility();
  const onImageClick = jest.fn();
  render(
    <ChatImage
      src="https://fixture/nearby.png"
      alt="nearby image"
      onImageClick={onImageClick}
      requestDurationMs={2500}
    />,
  );
  expect(loadAsset).not.toHaveBeenCalled();
  intersect(observers[0]);
  const image = await screen.findByAltText("nearby image");
  expect(loadAsset).toHaveBeenCalledTimes(1);
  expect(decode).toHaveBeenCalledTimes(1);
  expect(observers[0].observer.disconnect).toHaveBeenCalled();
  expect(screen.getByText("请求耗时 00:02")).toBeInTheDocument();
  fireEvent.click(image);
  expect(onImageClick).toHaveBeenCalledWith(image.getAttribute("src"));
  expect(image).toHaveAttribute("role", "button");
  expect(image).toHaveAttribute("tabindex", "0");
  fireEvent.keyDown(image, { key: "Enter" });
  fireEvent.keyDown(image, { key: " " });
  expect(onImageClick).toHaveBeenCalledTimes(3);
  expect(
    onImageClick.mock.calls.every(([src]) => src === image.getAttribute("src")),
  ).toBe(true);
  intersect(observers[0], false);
  intersect(observers[0]);
  expect(loadAsset).toHaveBeenCalledTimes(1);
  expect(decode).toHaveBeenCalledTimes(1);
});

test("a waiting image reuses a preview decoded by another visible instance", async () => {
  const observers = observeVisibility();
  const src = "https://fixture/shared-waiting.png";
  render(<ChatImage src={src} alt="waiting shared image" />);
  render(<ChatImage src={src} alt="visible shared image" />);
  intersect(observers[1]);
  const visible = await screen.findByAltText("visible shared image");
  intersect(observers[0]);
  expect(screen.getByAltText("waiting shared image").getAttribute("src")).toBe(
    visible.getAttribute("src"),
  );
  expect(loadAsset).toHaveBeenCalledTimes(1);
  expect(decode).toHaveBeenCalledTimes(1);
});

test("unmounting a waiting image disconnects and ignores stale intersections", () => {
  const observers = observeVisibility();
  const view = render(
    <ChatImage src="https://fixture/unmounted.png" alt="unmounted image" />,
  );
  view.unmount();
  expect(observers[0].observer.disconnect).toHaveBeenCalled();
  intersect(observers[0]);
  expect(loadAsset).not.toHaveBeenCalled();
  expect(decode).not.toHaveBeenCalled();
});

test("changing source discards the old observer and only loads the new source", async () => {
  const observers = observeVisibility();
  const view = render(
    <ChatImage src="https://fixture/before.png" alt="changing image" />,
  );
  view.rerender(
    <ChatImage src="https://fixture/after.png" alt="changing image" />,
  );
  expect(observers[0].observer.disconnect).toHaveBeenCalled();
  intersect(observers[0]);
  expect(loadAsset).not.toHaveBeenCalled();
  intersect(observers[1]);
  await screen.findByAltText("changing image");
  expect(loadAsset).toHaveBeenCalledTimes(1);
  expect(loadAsset).toHaveBeenCalledWith(
    "https://fixture/after.png",
    undefined,
    false,
    expect.any(Function),
  );
});

test("an in-flight download does not begin decoding after unmount", async () => {
  const observers = observeVisibility();
  const clear = jest.spyOn(window, "clearInterval");
  let resolve!: (blob: Blob) => void;
  loadAsset.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  const view = render(
    <ChatImage src="https://fixture/pending.png" alt="pending image" />,
  );
  intersect(observers[0]);
  view.unmount();
  expect(clear).toHaveBeenCalled();
  await act(async () => resolve(new Blob(["late image"])));
  expect(decode).not.toHaveBeenCalled();
});

test("failed visible images still retry immediately with cache invalidation", async () => {
  const observers = observeVisibility();
  loadAsset.mockRejectedValueOnce(new Error("download failed"));
  render(<ChatImage src="https://fixture/retry.png" alt="retried image" />);
  intersect(observers[0]);
  const retry = await screen.findByRole("button", { name: "重新加载图片" });
  fireEvent.click(retry);
  await screen.findByAltText("retried image");
  expect(loadAsset).toHaveBeenCalledTimes(2);
  expect(loadAsset).toHaveBeenLastCalledWith(
    "https://fixture/retry.png",
    undefined,
    true,
    expect.any(Function),
  );
});
