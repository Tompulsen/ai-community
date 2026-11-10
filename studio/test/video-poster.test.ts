import { jest } from "@jest/globals";
import type { VideoResult } from "../app/store/video";

let owner = "user-7";
let active = true;
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => owner,
  isLocalWorkspaceActive: () => active,
}));
const { cachedVideoPoster, videoPosterCapture, extractVideoPoster } =
  await import("../app/utils/video-poster");
const result = { id: "one", url: "blob:one" } as VideoResult;
const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
const poster = "data:" + "image/jpeg;base64,cG9zdGVy";
const draw = jest.fn();
const pixels = jest.fn<(time: number) => Uint8ClampedArray>();
const readPixels = jest.fn();
const encode = jest.fn(() => poster);
const pauses = jest.fn();
const loads = jest.fn();
let decoders: HTMLVideoElement[];
let seeks: number[];
let duration: number;
let width: number;
let height: number;
let stall: "metadata" | "seek" | undefined;
let failure: "load" | "seek" | undefined;

function pixelData(first: number, second = first) {
  const data = new Uint8ClampedArray(32 * 32 * 4);
  for (let index = 0; index < data.length; index += 4) {
    const value = Math.floor(index / 64) % 2 ? first : second;
    data[index] = data[index + 1] = data[index + 2] = value;
    data[index + 3] = 255;
  }
  return data;
}

beforeEach(() => {
  owner = "user-7";
  active = true;
  duration = 6;
  width = 1920;
  height = 1080;
  stall = undefined;
  failure = undefined;
  decoders = [];
  seeks = [];
  draw.mockReset();
  pauses.mockReset();
  loads.mockReset();
  encode.mockReset().mockReturnValue(poster);
  pixels.mockReset().mockReturnValue(pixelData(80));
  readPixels.mockReset().mockImplementation(() => ({
    data: pixels(
      (draw.mock.calls.at(-1)?.[0] as HTMLVideoElement)?.currentTime || 0,
    ),
  }));
  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: draw,
    getImageData: readPixels,
  } as unknown as CanvasRenderingContext2D);
  jest
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockImplementation(encode);
  const create = document.createElement.bind(document);
  jest.spyOn(document, "createElement").mockImplementation((name: string) => {
    const element = create(name);
    if (name !== "video") return element;
    const decoder = element as HTMLVideoElement;
    let currentTime = 0;
    let readyState = 0;
    let seeking = false;
    decoders.push(decoder);
    Object.defineProperties(decoder, {
      duration: { get: () => duration },
      videoWidth: { get: () => width },
      videoHeight: { get: () => height },
      readyState: { get: () => readyState },
      seeking: { get: () => seeking },
      currentTime: {
        get: () => currentTime,
        set: (time: number) => {
          currentTime = time;
          seeks.push(time);
          readyState = 1;
          seeking = true;
          if (stall === "seek") return;
          queueMicrotask(() => {
            if (failure === "seek") {
              decoder.dispatchEvent(new Event("error"));
              return;
            }
            seeking = false;
            readyState = 2;
            decoder.dispatchEvent(new Event("seeked"));
            decoder.dispatchEvent(new Event("loadeddata"));
          });
        },
      },
    });
    decoder.pause = pauses;
    decoder.load = () => {
      loads();
      if (!decoder.hasAttribute("src") || stall === "metadata") return;
      queueMicrotask(() => {
        if (failure === "load") {
          decoder.dispatchEvent(new Event("error"));
          return;
        }
        readyState = 1;
        decoder.dispatchEvent(new Event("loadedmetadata"));
      });
    };
    return element;
  });
  window.dispatchEvent(new Event("local-data-maintenance"));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function expectReleased() {
  expect(pauses).toHaveBeenCalledTimes(1);
  expect(loads).toHaveBeenCalledTimes(2);
  expect(decoders[0].hasAttribute("src")).toBe(false);
}

test("captured frames are bounded and reused across views", () => {
  videoPosterCapture(result)(video);
  expect(cachedVideoPoster({ ...result })).toBe(poster);
  expect(draw).toHaveBeenCalledWith(video, 0, 0, 480, 270);
  videoPosterCapture(result)(video);
  expect(draw).toHaveBeenCalledTimes(1);
  const cached = cachedVideoPoster(result);
  window.dispatchEvent(
    new CustomEvent("new-api-session-changed", {
      detail: { userId: 7, tokenId: 20 },
    }),
  );
  expect(cachedVideoPoster(result)).toBe(cached);
});

test("late frame callbacks cannot refill posters after account or interface changes", () => {
  const context = jest.spyOn(HTMLCanvasElement.prototype, "getContext");
  const capture = videoPosterCapture(result);
  owner = "user-8";
  capture(video);
  expect(context).not.toHaveBeenCalled();
  owner = "user-7";
  window.dispatchEvent(new Event("model-source-changing"));
  capture(video);
  expect(context).not.toHaveBeenCalled();
  expect(cachedVideoPoster(result)).toBeUndefined();
});

test("black first frames do not poison the reusable poster cache", () => {
  pixels.mockReturnValueOnce(pixelData(0));
  const capture = videoPosterCapture(result);
  capture(video);
  expect(cachedVideoPoster(result)).toBeUndefined();
  capture(video);
  expect(cachedVideoPoster(result)).toBe(poster);
});

test("inactive workspaces neither expose nor capture posters", () => {
  active = false;
  videoPosterCapture(result)(video);
  expect(draw).not.toHaveBeenCalled();
  expect(cachedVideoPoster({ ...result, coverUrl: poster })).toBeUndefined();
});

test("extracts a later usable frame without playing the decoder", async () => {
  pixels.mockImplementation((time) =>
    time < 1 ? pixelData(0) : pixelData(80),
  );
  const play = jest.spyOn(HTMLMediaElement.prototype, "play");
  expect(
    await extractVideoPoster("blob:video", new AbortController().signal),
  ).toEqual({ poster, duration: 6 });
  expect(seeks).toEqual([0.5, 1.5]);
  expect(draw).toHaveBeenLastCalledWith(decoders[0], 0, 0, 480, 270);
  expect(play).not.toHaveBeenCalled();
  expectReleased();
});

test("tries at most three frames and leaves all-black videos without a cover", async () => {
  pixels.mockReturnValue(pixelData(0));
  expect(
    await extractVideoPoster("blob:video", new AbortController().signal),
  ).toBeUndefined();
  expect(seeks).toEqual([0.5, 1.5, 3]);
  expect(encode).not.toHaveBeenCalled();
  expectReleased();
});

test("preserves dark scenes with visible texture instead of skipping them", async () => {
  pixels.mockReturnValue(pixelData(5, 15));
  expect(
    await extractVideoPoster("blob:video", new AbortController().signal),
  ).toEqual({ poster, duration: 6 });
  expect(seeks).toEqual([0.5]);
  expectReleased();
});

test("bounds portrait covers and does not seek past very short videos", async () => {
  duration = 0.01;
  width = 2160;
  height = 11520;
  expect(
    await extractVideoPoster("blob:video", new AbortController().signal),
  ).toEqual({ poster, duration });
  expect(seeks.every((time) => time >= 0 && time < duration)).toBe(true);
  expect(draw).toHaveBeenCalledWith(decoders[0], 0, 0, 90, 480);
  expectReleased();
});

test.each(["load", "seek"] as const)(
  "a %s failure releases its independent decoder",
  async (phase) => {
    failure = phase;
    await expect(
      extractVideoPoster("blob:video", new AbortController().signal),
    ).rejects.toThrow("could not be decoded");
    expectReleased();
  },
);

test("cross-origin canvas failures are surfaced without retaining the decoder", async () => {
  readPixels.mockImplementationOnce(() => {
    throw new DOMException("Canvas is tainted", "SecurityError");
  });
  await expect(
    extractVideoPoster(
      "https://media.test/video.mp4",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ name: "SecurityError" });
  expectReleased();
});

test.each(["metadata", "seek"] as const)(
  "a stalled %s phase times out and removes pending timers",
  async (phase) => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
    stall = phase;
    const extraction = expect(
      extractVideoPoster("blob:video", new AbortController().signal),
    ).rejects.toThrow("timed out");
    await jest.advanceTimersByTimeAsync(12_001);
    await extraction;
    expect(jest.getTimerCount()).toBe(0);
    expectReleased();
  },
);

test.each(["metadata", "seek"] as const)(
  "cancelling during %s removes its media and event listeners",
  async (phase) => {
    stall = phase;
    const controller = new AbortController();
    const extraction = expect(
      extractVideoPoster("blob:video", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    if (phase === "seek")
      for (let attempt = 0; attempt < 10 && seeks.length === 0; attempt++)
        await Promise.resolve();
    const remove = jest.spyOn(decoders[0], "removeEventListener");
    controller.abort();
    await extraction;
    expect(remove).toHaveBeenCalledWith("seeked", expect.any(Function));
    expectReleased();
  },
);

test("pre-aborted extraction never creates a media decoder", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    extractVideoPoster("blob:video", controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(decoders).toHaveLength(0);
});

test("cancellation during frame encoding cannot return its stale cover", async () => {
  const controller = new AbortController();
  encode.mockImplementationOnce(() => {
    controller.abort();
    return poster;
  });
  await expect(
    extractVideoPoster("blob:video", controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expectReleased();
});

test.each([0, NaN, Infinity])(
  "invalid duration %s cannot produce a cover",
  async (invalid) => {
    duration = invalid;
    await expect(
      extractVideoPoster("blob:video", new AbortController().signal),
    ).rejects.toThrow("Invalid video cover metadata");
    expectReleased();
  },
);
