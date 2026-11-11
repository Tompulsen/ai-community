import { jest } from "@jest/globals";

let heicModuleLoads = 0;
const convertHeic = jest.fn<typeof import("heic2any").default>();
jest.unstable_mockModule("heic2any", () => {
  heicModuleLoads++;
  return { default: convertHeic };
});
const { compressImage, uploadImage } = await import("../app/utils/chat");

const createObjectURL = jest.fn(() => "blob:compression-fixture");
const revokeObjectURL = jest.fn();
const drawImage = jest.fn();
const dimensions = { width: 3000, height: 2000 };
let decodeFailure: "error" | "abort" | undefined;
let canvases: HTMLCanvasElement[];
let encodingSizes: number[][];
const originalImage = globalThis.Image;
const cacheWindow = window as Window & { _SW_ENABLED?: boolean };
const originalSwEnabled = cacheWindow._SW_ENABLED;
const originalBitmap = Object.getOwnPropertyDescriptor(
  globalThis,
  "createImageBitmap",
);
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL",
);
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL",
);

function largeImage(type = "image/jpeg") {
  return new Blob([new Uint8Array(600 * 1024)], { type });
}

beforeEach(() => {
  convertHeic
    .mockReset()
    .mockResolvedValue(new Blob(["converted image"], { type: "image/jpeg" }));
  canvases = [];
  encodingSizes = [];
  dimensions.width = 3000;
  dimensions.height = 2000;
  decodeFailure = undefined;
  cacheWindow._SW_ENABLED = false;
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  drawImage.mockReset();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: class {
      naturalWidth = dimensions.width;
      naturalHeight = dimensions.height;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      set src(value: string) {
        if (value)
          queueMicrotask(() => {
            if (decodeFailure === "error") this.onerror?.();
            else if (decodeFailure === "abort") this.onabort?.();
            else this.onload?.();
          });
      }
    },
  });
  jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(function (this: HTMLCanvasElement) {
      canvases.push(this);
      return { drawImage } as unknown as CanvasRenderingContext2D;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext);
  jest
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation(function (this: HTMLCanvasElement, callback, type) {
      encodingSizes.push([this.width, this.height]);
      queueMicrotask(() => callback(new Blob(["encoded image"], { type })));
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(globalThis, "Image", { value: originalImage });
  if (originalBitmap)
    Object.defineProperty(globalThis, "createImageBitmap", originalBitmap);
  else
    delete (globalThis as unknown as Record<string, unknown>).createImageBitmap;
  cacheWindow._SW_ENABLED = originalSwEnabled;
  for (const [key, descriptor] of [
    ["createObjectURL", originalCreateObjectURL],
    ["revokeObjectURL", originalRevokeObjectURL],
  ] as const) {
    if (descriptor) Object.defineProperty(URL, key, descriptor);
    else delete (URL as unknown as Record<string, unknown>)[key];
  }
});

test("small images retain their original bytes without canvas encoding", async () => {
  const original = new Blob(["original bytes"], { type: "image/png" });
  const result = await compressImage(original, 512 * 1024);
  expect(result).toBe(`data:image/png;base64,${btoa("original bytes")}`);
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  expect(heicModuleLoads).toBe(0);
  expect(convertHeic).not.toHaveBeenCalled();
});

test.each(["image/jpeg", "image/png"])(
  "%s uses asynchronous encoding and releases image resources",
  async (type) => {
    const synchronousEncode = jest.spyOn(
      HTMLCanvasElement.prototype,
      "toDataURL",
    );
    const result = await compressImage(largeImage(type), 512 * 1024);
    expect(result).toMatch(
      type === "image/png" ? /^data:image\/png;/ : /^data:image\/webp;/,
    );
    expect(synchronousEncode).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:compression-fixture");
    expect(canvases[0].width).toBe(0);
    expect(canvases[0].height).toBe(0);
  },
);

test("unsupported WebP falls back to JPEG without dropping PNG transparency", async () => {
  jest
    .mocked(HTMLCanvasElement.prototype.toBlob)
    .mockImplementationOnce((callback) =>
      queueMicrotask(() =>
        callback(new Blob(["unsupported format"], { type: "image/png" })),
      ),
    );
  const result = await compressImage(largeImage(), 512 * 1024);
  expect(result).toMatch(/^data:image\/jpeg;/);
  expect(
    jest
      .mocked(HTMLCanvasElement.prototype.toBlob)
      .mock.calls.map((call) => call[1]),
  ).toEqual(["image/webp", "image/jpeg"]);
});

test.each([
  [100, 10000],
  [1, 10000],
])(
  "thin %i x %i images are never enlarged or reduced to zero",
  async (width, height) => {
    dimensions.width = width;
    dimensions.height = height;
    await compressImage(largeImage("image/png"), 512 * 1024);
    for (const [outputWidth, outputHeight] of encodingSizes) {
      expect(outputWidth).toBeGreaterThanOrEqual(1);
      expect(outputHeight).toBeGreaterThanOrEqual(1);
      expect(outputWidth).toBeLessThanOrEqual(width);
      expect(outputHeight).toBeLessThanOrEqual(2048);
    }
  },
);

test("large photos retain useful dimensions instead of shrinking to a thumbnail", async () => {
  const original = new Blob([new Uint8Array(12 * 1024 * 1024)], {
    type: "image/png",
  });
  await compressImage(original, 512 * 1024);
  expect(encodingSizes[0][0]).toBeGreaterThanOrEqual(600);
  expect(encodingSizes[0][1]).toBeGreaterThanOrEqual(400);
});

test("native bitmap resizing is reused and its memory is released", async () => {
  const bitmap = { close: jest.fn() } as unknown as ImageBitmap;
  const resize = jest
    .fn<() => Promise<ImageBitmap>>()
    .mockResolvedValue(bitmap);
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: resize,
  });
  await compressImage(largeImage(), 512 * 1024);
  expect(resize).toHaveBeenCalledTimes(1);
  expect(drawImage.mock.calls[0][0]).toBe(bitmap);
  expect(bitmap.close).toHaveBeenCalledTimes(1);
});

test("unsupported native bitmap resizing falls back to the decoded image", async () => {
  const resize = jest
    .fn<() => Promise<ImageBitmap>>()
    .mockRejectedValue(new Error("bitmap resizing is unavailable"));
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: resize,
  });
  await expect(compressImage(largeImage(), 512 * 1024)).resolves.toMatch(
    /^data:image\/webp;/,
  );
  expect(drawImage).toHaveBeenCalledTimes(1);
  expect(revokeObjectURL).toHaveBeenCalledTimes(1);
});

test.each(["error", "abort"] as const)(
  "image decoding %s rejects and releases its object URL",
  async (failure) => {
    decodeFailure = failure;
    await expect(compressImage(largeImage(), 512 * 1024)).rejects.toThrow(
      failure === "abort" ? "aborted" : "decoded",
    );
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  },
);

test.each(["throw", "null", "draw"] as const)(
  "a canvas %s failure rejects rather than leaving processing pending",
  async (failure) => {
    if (failure === "draw") {
      drawImage.mockImplementation(() => {
        throw new Error("draw failed");
      });
    } else {
      jest.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(() => {
        if (failure === "throw") throw new Error("encoding failed");
      });
      if (failure === "null")
        jest
          .mocked(HTMLCanvasElement.prototype.toBlob)
          .mockImplementation((callback) =>
            queueMicrotask(() => callback(null)),
          );
    }
    await expect(compressImage(largeImage(), 512 * 1024)).rejects.toThrow();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(canvases[0].width).toBe(0);
    expect(canvases[0].height).toBe(0);
  },
);

test.each(["error", "abort"] as const)(
  "FileReader %s rejects for the data URL result",
  async (failure) => {
    jest
      .spyOn(FileReader.prototype, "readAsDataURL")
      .mockImplementation(function (this: FileReader) {
        queueMicrotask(() => this.dispatchEvent(new ProgressEvent(failure)));
      });
    await expect(compressImage(largeImage(), 512 * 1024)).rejects.toThrow(
      failure === "abort" ? "aborted" : "read",
    );
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  },
);

test("the compression retry count remains bounded", async () => {
  jest
    .mocked(HTMLCanvasElement.prototype.toBlob)
    .mockImplementation((callback, type) =>
      queueMicrotask(() =>
        callback(new Blob([new Uint8Array(2048)], { type })),
      ),
    );
  await compressImage(largeImage("image/png"), 1024);
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(15);
  expect(
    encodingSizes.every(([width, height]) => width >= 1 && height >= 1),
  ).toBe(true);
});

test("optional SW caching consumes its rejected branch while upload still rejects", async () => {
  cacheWindow._SW_ENABLED = true;
  decodeFailure = "error";
  await expect(uploadImage(largeImage())).rejects.toThrow("decoded");
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("HEIC uploads load the converter on demand and share it across uploads", async () => {
  const heic = new Blob(["heic bytes"], { type: "image/heic" });
  const results = await Promise.all([
    compressImage(heic, 512 * 1024),
    compressImage(heic, 512 * 1024),
  ]);
  expect(results).toEqual([
    `data:image/jpeg;base64,${btoa("converted image")}`,
    `data:image/jpeg;base64,${btoa("converted image")}`,
  ]);
  expect(heicModuleLoads).toBe(1);
  expect(convertHeic).toHaveBeenCalledTimes(2);
  expect(convertHeic).toHaveBeenCalledWith({
    blob: heic,
    toType: "image/jpeg",
  });
});

test("HEIC conversion failures can be retried without reloading the converter", async () => {
  const heic = new Blob(["heic bytes"], { type: "image/heic" });
  convertHeic.mockRejectedValueOnce(new Error("invalid HEIC image"));
  await expect(compressImage(heic, 512 * 1024)).rejects.toThrow(
    "invalid HEIC image",
  );
  await expect(compressImage(heic, 512 * 1024)).resolves.toBe(
    `data:image/jpeg;base64,${btoa("converted image")}`,
  );
  expect(heicModuleLoads).toBe(1);
});

test("HEIC converter array results preserve the existing first-image behavior", async () => {
  convertHeic.mockResolvedValueOnce([
    new Blob(["first image"], { type: "image/jpeg" }),
    new Blob(["second image"], { type: "image/jpeg" }),
  ]);
  await expect(
    compressImage(new Blob(["heic bytes"], { type: "image/heic" }), 512 * 1024),
  ).resolves.toBe(`data:image/jpeg;base64,${btoa("first image")}`);
});
