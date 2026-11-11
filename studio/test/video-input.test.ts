import { jest } from "@jest/globals";
import {
  prepareVideoContent,
  prepareVideoMessages,
  videoSampleTimes,
  type VideoInputOptions,
} from "../app/utils/video-input";
import type { MultimodalContent, RequestMessage } from "../app/client/api";
import type { ChatApiFormat } from "../app/utils/chat-api-format";

const SOURCE = "data:video/mp4;base64,dmlkZW8=";
const JPEG = "data:image/jpeg;base64,aW1hZ2U=";
const createObjectURL = jest.fn(() => "blob:video-input-fixture");
const revokeObjectURL = jest.fn();
const drawImage = jest.fn();
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL",
);
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL",
);
let videos: HTMLVideoElement[];
let canvases: HTMLCanvasElement[];
let soughtTimes: number[];
let captures: { time: number; width: number; height: number }[];
let duration: number;
let width: number;
let height: number;
let stall: "metadata" | "seek" | undefined;
let fail: "load" | "seek" | undefined;
let metadataReady: number;
let loads: jest.Mock[];
let pauses: jest.Mock[];

function options(
  overrides: Partial<VideoInputOptions> = {},
): VideoInputOptions {
  return {
    model: "gpt-6.1-sol",
    format: "chat-completions",
    signal: new AbortController().signal,
    ...overrides,
  };
}

function videoPart(source = SOURCE): MultimodalContent {
  return { type: "video_url", video_url: { url: source } };
}

function images(content: RequestMessage["content"]) {
  if (!Array.isArray(content)) throw new Error("Expected content parts");
  return content.filter((part) => part.type === "image_url");
}

beforeEach(() => {
  duration = 24;
  width = 1920;
  height = 1080;
  metadataReady = 2;
  stall = undefined;
  fail = undefined;
  videos = [];
  canvases = [];
  soughtTimes = [];
  captures = [];
  loads = [];
  pauses = [];
  createObjectURL.mockReset().mockReturnValue("blob:video-input-fixture");
  revokeObjectURL.mockReset();
  drawImage.mockReset();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  const createElement = document.createElement.bind(document);
  jest
    .spyOn(document, "createElement")
    .mockImplementation(
      (name: string, elementOptions?: ElementCreationOptions) => {
        const element = createElement(name, elementOptions);
        if (name === "canvas") canvases.push(element as HTMLCanvasElement);
        if (name !== "video") return element;
        const video = element as HTMLVideoElement;
        let readyState = 0;
        let currentTime = 0;
        let seeking = false;
        videos.push(video);
        Object.defineProperties(video, {
          duration: { get: () => duration },
          videoWidth: { get: () => width },
          videoHeight: { get: () => height },
          readyState: { get: () => readyState },
          seeking: { get: () => seeking },
          currentTime: {
            get: () => currentTime,
            set: (time) => {
              currentTime = time;
              soughtTimes.push(time);
              seeking = true;
              readyState = 1;
              if (stall === "seek") return;
              queueMicrotask(() => {
                if (fail === "seek") {
                  video.dispatchEvent(new Event("error"));
                  return;
                }
                seeking = false;
                readyState = 2;
                video.dispatchEvent(new Event("seeked"));
              });
            },
          },
        });
        const load = jest.fn(() => {
          if (!video.hasAttribute("src") || stall === "metadata") return;
          queueMicrotask(() => {
            if (fail === "load") {
              video.dispatchEvent(new Event("error"));
              return;
            }
            readyState = metadataReady;
            video.dispatchEvent(new Event("loadedmetadata"));
            if (metadataReady < 2)
              queueMicrotask(() => {
                readyState = 2;
                video.dispatchEvent(new Event("loadeddata"));
              });
          });
        });
        const pause = jest.fn();
        loads.push(load);
        pauses.push(pause);
        video.load = load;
        video.pause = pause;
        return video;
      },
    );
  jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(
      () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
    );
  jest
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockImplementation(function (this: HTMLCanvasElement) {
      const video = drawImage.mock.calls.at(-1)?.[0] as HTMLVideoElement;
      captures.push({
        time: video.currentTime,
        width: this.width,
        height: this.height,
      });
      return JPEG;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  for (const [key, descriptor] of [
    ["createObjectURL", originalCreateObjectURL],
    ["revokeObjectURL", originalRevokeObjectURL],
  ] as const) {
    if (descriptor) Object.defineProperty(URL, key, descriptor);
    else delete (URL as unknown as Record<string, unknown>)[key];
  }
});

function expectReleased() {
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:video-input-fixture");
  for (const [index, video] of videos.entries()) {
    expect(pauses[index]).toHaveBeenCalledTimes(1);
    expect(loads[index]).toHaveBeenCalledTimes(2);
    expect(video.hasAttribute("src")).toBe(false);
  }
  for (const canvas of canvases) {
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  }
}

test("samples across the full video duration while avoiding its exact end", () => {
  const times = videoSampleTimes(120);
  expect(times).toHaveLength(12);
  expect(times[0]).toBe(0);
  expect(times.at(-1)).toBeCloseTo(119.95);
  expect(times.every((time) => time >= 0 && time < 120)).toBe(true);
  for (let index = 1; index < times.length; index++)
    expect(times[index] - times[index - 1]).toBeCloseTo(119.95 / 11);
  expect(videoSampleTimes(0.01).at(-1)).toBeLessThan(0.01);
  expect(videoSampleTimes(10, 1)).toEqual([5]);
});

test.each([0, -1, NaN, Infinity])(
  "invalid video duration %s fails explicitly",
  (invalid) => {
    expect(() => videoSampleTimes(invalid)).toThrow("视频时长");
  },
);

test.each<ChatApiFormat>(["responses", "claude", "chat-completions"])(
  "%s converts video to timed JPEGs and preserves unrelated content",
  async (format) => {
    const text: MultimodalContent = { type: "text", text: "这个怎么样" };
    const audio: MultimodalContent = {
      type: "input_audio",
      input_audio: { data: "YXVkaW8=", format: "wav" },
    };
    const input = [text, videoPart(), audio];
    const before = JSON.stringify(input);
    const result = await prepareVideoContent(input, options({ format }));
    expect(JSON.stringify(input)).toBe(before);
    expect(result).not.toBe(input);
    expect(images(result)).toHaveLength(12);
    expect(images(result).every((part) => part.image_url?.url === JPEG)).toBe(
      true,
    );
    expect(Array.isArray(result) && result.at(-1)).toBe(audio);
    expect(Array.isArray(result) && result[0]).toBe(text);
    expect(JSON.stringify(result)).not.toContain("video_url");
    expect(JSON.stringify(result)).toContain("离散采样");
    expect(JSON.stringify(result)).toContain("单独提供的音频附件可独立分析");
    expect(JSON.stringify(result)).toContain("时间戳 00:00.000");
    expect(JSON.stringify(result)).toContain("时间戳 00:23.950");
    expect(captures.map(({ time }) => time)).toEqual(
      videoSampleTimes(duration),
    );
    expect(
      captures.every(({ width, height }) => width === 1024 && height === 576),
    ).toBe(true);
    expect(videos[0].crossOrigin).toBe("anonymous");
    expect(videos[0].muted).toBe(true);
    expectReleased();
  },
);

test.each([
  "gpt-4o",
  "chatgpt-4o-latest",
  "openai/gpt-6.1-sol",
  "o1",
  "o3-mini",
  "o4-mini",
  "anthropic/claude-sonnet-4",
])("recognized chat model %s receives video frames", async (model) => {
  const result = await prepareVideoContent(
    [videoPart()],
    options({ model, maxFrames: 2 }),
  );
  expect(images(result)).toHaveLength(2);
});

test.each([
  ["gemini", "gpt-6.1-sol"],
  ["gemini", "gemini-3-pro"],
  ["chat-completions", "gemini-3-pro"],
  ["chat-completions", "qwen3-vl"],
  ["chat-completions", "some-other-model"],
] as [ChatApiFormat, string][])(
  "%s with %s retains native video content",
  async (format, model) => {
    const input = [videoPart()];
    expect(await prepareVideoContent(input, options({ format, model }))).toBe(
      input,
    );
    const messages: RequestMessage[] = [{ role: "user", content: input }];
    expect(
      await prepareVideoMessages(messages, options({ format, model })),
    ).toBe(messages);
    expect(videos).toHaveLength(0);
    expect(createObjectURL).not.toHaveBeenCalled();
  },
);

test("non-video strings and content arrays retain their original references", async () => {
  expect(await prepareVideoContent("Hello", options())).toBe("Hello");
  const content: MultimodalContent[] = [
    { type: "text", text: "Hello" },
    { type: "image_url", image_url: { url: JPEG } },
  ];
  expect(await prepareVideoContent(content, options())).toBe(content);
  const messages: RequestMessage[] = [{ role: "user", content }];
  expect(await prepareVideoMessages(messages, options())).toBe(messages);
  expect(videos).toHaveLength(0);
});

test("initial frame waits for loadeddata even when time zero triggers no seek", async () => {
  metadataReady = 1;
  duration = 2;
  const result = await prepareVideoContent([videoPart()], options());
  expect(images(result)).toHaveLength(3);
  expect(captures[0].time).toBe(0);
  expect(soughtTimes[0]).toBeGreaterThan(0);
  expectReleased();
});

test("small or portrait videos retain their aspect ratio without enlargement", async () => {
  width = 200;
  height = 400;
  await prepareVideoContent([videoPart()], options({ maxFrames: 1 }));
  expect(captures[0]).toMatchObject({ width: 200, height: 400 });
  width = 1080;
  height = 1920;
  await prepareVideoContent([videoPart()], options({ maxFrames: 1 }));
  expect(captures[1]).toMatchObject({ width: 576, height: 1024 });
});

test("pre-aborted requests reject before decoding any data", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    prepareVideoContent([videoPart()], options({ signal: controller.signal })),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(videos).toHaveLength(0);
  expect(createObjectURL).not.toHaveBeenCalled();
});

test.each(["metadata", "seek"] as const)(
  "cancellation during %s rejects and releases all resources",
  async (phase) => {
    stall = phase;
    const controller = new AbortController();
    const pending = prepareVideoContent(
      [videoPart()],
      options({ signal: controller.signal }),
    );
    const result = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    if (phase === "seek") {
      for (let attempt = 0; attempt < 12 && soughtTimes.length === 0; attempt++)
        await Promise.resolve();
      expect(soughtTimes).toHaveLength(1);
    }
    controller.abort();
    await result;
    expectReleased();
  },
);

test("cancellation during frame encoding cannot return partial video content", async () => {
  const controller = new AbortController();
  jest.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(() => {
    controller.abort();
    return JPEG;
  });
  await expect(
    prepareVideoContent([videoPart()], options({ signal: controller.signal })),
  ).rejects.toMatchObject({ name: "AbortError" });
  expectReleased();
});

test.each(["load", "seek"] as const)(
  "a video %s error rejects instead of silently stripping the video",
  async (phase) => {
    fail = phase;
    await expect(prepareVideoContent([videoPart()], options())).rejects.toThrow(
      "视频无法读取或解码",
    );
    expectReleased();
  },
);

test("remote CORS and decoding errors do not expose private video URLs", async () => {
  fail = "load";
  const source = "https://private.example/video.mp4?signature=secret";
  await expect(
    prepareVideoContent([videoPart(source)], options()),
  ).rejects.toThrow("CORS");
  await expect(
    prepareVideoContent([videoPart(source)], options()),
  ).rejects.not.toThrow("secret");
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  expect(videos.every((video) => !video.hasAttribute("src"))).toBe(true);
});

test.each([
  "invalid-duration",
  "no-picture",
  "no-context",
  "tainted",
  "encoding",
])("%s rejects and cleans up decoded media", async (failure) => {
  if (failure === "invalid-duration") duration = Infinity;
  if (failure === "no-picture") width = 0;
  if (failure === "no-context")
    jest.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
  if (failure === "tainted")
    drawImage.mockImplementation(() => {
      throw new DOMException("secret URL", "SecurityError");
    });
  if (failure === "encoding")
    jest
      .mocked(HTMLCanvasElement.prototype.toDataURL)
      .mockReturnValue("data:,");
  await expect(prepareVideoContent([videoPart()], options())).rejects.toThrow();
  expectReleased();
});

test("metadata timeout rejects and releases its temporary Blob URL", async () => {
  jest.useFakeTimers();
  stall = "metadata";
  const pending = prepareVideoContent([videoPart()], options());
  const result = expect(pending).rejects.toThrow("超时");
  await jest.advanceTimersByTimeAsync(15_000);
  await result;
  expectReleased();
  expect(jest.getTimerCount()).toBe(0);
});

test("invalid base64 or absent video content fails without returning text only", async () => {
  await expect(
    prepareVideoContent(
      [videoPart("data:video/mp4;base64,invalid%%%")],
      options(),
    ),
  ).rejects.toThrow("视频数据格式无效");
  await expect(
    prepareVideoContent([{ type: "video_url" }], options()),
  ).rejects.toThrow("视频地址无效");
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(drawImage).not.toHaveBeenCalled();
});

test("request-level preparation shares 36 frames across all videos serially", async () => {
  const messages: RequestMessage[] = [
    { role: "system", content: "Inspect these videos" },
    {
      role: "user",
      content: [videoPart(), videoPart(), videoPart()],
    },
    { role: "assistant", content: "Next" },
    { role: "user", content: [videoPart()] },
  ];
  let activeDecoders = 0;
  let maximumDecoders = 0;
  const create = createObjectURL.getMockImplementation()!;
  createObjectURL.mockImplementation(() => {
    activeDecoders++;
    maximumDecoders = Math.max(maximumDecoders, activeDecoders);
    return create();
  });
  revokeObjectURL.mockImplementation(() => activeDecoders--);
  const before = JSON.stringify(messages);
  const result = await prepareVideoMessages(messages, options());
  expect(JSON.stringify(messages)).toBe(before);
  expect(result[0]).toBe(messages[0]);
  expect(result[2]).toBe(messages[2]);
  expect(result[1]).not.toBe(messages[1]);
  expect(images(result[1].content)).toHaveLength(27);
  expect(images(result[3].content)).toHaveLength(9);
  expect(maximumDecoders).toBe(1);
  expect(activeDecoders).toBe(0);
  expectReleased();
});

test("too many videos fail before starting resource-intensive decoding", async () => {
  await expect(
    prepareVideoMessages(
      [
        {
          role: "user",
          content: Array.from({ length: 37 }, () => videoPart()),
        },
      ],
      options(),
    ),
  ).rejects.toThrow("超过 36 个");
  expect(videos).toHaveLength(0);
});

test("a valid 7MB frame below the request budget is preserved", async () => {
  const image =
    JPEG.slice(0, JPEG.indexOf(",") + 1) + "A".repeat(7 * 1024 * 1024);
  jest.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue(image);
  const result = await prepareVideoContent(
    [videoPart()],
    options({ maxFrames: 1 }),
  );
  expect(images(result)).toEqual([
    { type: "image_url", image_url: { url: image } },
  ]);
  expectReleased();
});

test.each(["AAAA", "AAA=", "AA=="])(
  "valid Base64 padding %s is preserved",
  async (payload) => {
    const image = JPEG.slice(0, JPEG.indexOf(",") + 1) + payload;
    jest.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue(image);
    const result = await prepareVideoContent(
      [videoPart()],
      options({ maxFrames: 1 }),
    );
    expect(images(result)[0].image_url?.url).toBe(image);
    expectReleased();
  },
);

test("request-level image bytes share the same 12MB limit across messages", async () => {
  jest
    .mocked(HTMLCanvasElement.prototype.toDataURL)
    .mockReturnValue(`data:image/jpeg;base64,${"A".repeat(7 * 1024 * 1024)}`);
  await expect(
    prepareVideoMessages(
      [
        { role: "user", content: [videoPart()] },
        { role: "user", content: [videoPart()] },
      ],
      options({ maxFrames: 1 }),
    ),
  ).rejects.toThrow("超过 12MB");
  expect(videos).toHaveLength(2);
  expectReleased();
});

test("inline images across messages exceed the budget before any video decoding starts", async () => {
  fail = "load";
  const image = `data:image/png;base64,${"A".repeat(7 * 1024 * 1024)}`;
  await expect(
    prepareVideoMessages(
      [
        { role: "user", content: [videoPart()] },
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: image } }],
        },
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: image } }],
        },
      ],
      options({ maxFrames: 1 }),
    ),
  ).rejects.toThrow("超过 12MB");
  expect(videos).toHaveLength(0);
  expect(canvases).toHaveLength(0);
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(drawImage).not.toHaveBeenCalled();
});

test("sampled frames share their budget with inline images in later messages", async () => {
  const image = `data:image/png;base64,${"A".repeat(7 * 1024 * 1024)}`;
  jest
    .mocked(HTMLCanvasElement.prototype.toDataURL)
    .mockReturnValue(`data:image/jpeg;base64,${"A".repeat(6 * 1024 * 1024)}`);
  await expect(
    prepareVideoMessages(
      [
        { role: "user", content: [videoPart()] },
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: image } }],
        },
      ],
      options({ maxFrames: 1 }),
    ),
  ).rejects.toThrow("超过 12MB");
  expect(videos).toHaveLength(1);
  expectReleased();
});

test.each(["invalid%%%", "AAAA===", "A", "", "AA=A", "=AAA", "AAAA===="])(
  "invalid frame payload %s still fails below the request budget",
  async (payload) => {
    jest
      .mocked(HTMLCanvasElement.prototype.toDataURL)
      .mockReturnValue(`data:image/jpeg;base64,${payload}`);
    await expect(
      prepareVideoContent([videoPart()], options({ maxFrames: 1 })),
    ).rejects.toThrow("视频画面编码失败");
    expectReleased();
  },
);
