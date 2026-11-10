import { jest } from "@jest/globals";

const toast = jest.fn();
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showToast: toast,
}));
const { copyImageToClipboard } = await import("../app/utils/image-clipboard");
const write = jest.fn<(items: ClipboardItem[]) => Promise<void>>();
let data: Record<string, Promise<Blob>>;
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const originalItem = Object.getOwnPropertyDescriptor(
  globalThis,
  "ClipboardItem",
);

beforeEach(() => {
  toast.mockClear();
  write.mockReset().mockImplementation(async () => {
    await data["image/png"];
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write },
  });
  Object.defineProperty(globalThis, "ClipboardItem", {
    configurable: true,
    value: class {
      constructor(items: Record<string, Promise<Blob>>) {
        data = items;
      }
    },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const [target, key, descriptor] of [
    [navigator, "clipboard", originalClipboard],
    [globalThis, "ClipboardItem", originalItem],
  ] as const) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
});

test("starts writing immediately and copies PNG bytes instead of text", async () => {
  let resolve!: (blob: Blob) => void;
  const blob = new Blob(["png"], { type: "image/png" });
  const pending = new Promise<Blob>((done) => {
    resolve = done;
  });
  const result = copyImageToClipboard(() => pending);
  expect(write).toHaveBeenCalledTimes(1);
  resolve(blob);
  await expect(result).resolves.toBe(true);
  await expect(data["image/png"]).resolves.toBe(blob);
  expect(toast).toHaveBeenCalledWith("图片已复制");
});

test.each(["image/jpeg", "image/webp"])(
  "converts %s to clipboard PNG and releases the bitmap",
  async (type) => {
    const close = jest.fn();
    const bitmap = { width: 640, height: 480, close };
    const png = new Blob(["png"], { type: "image/png" });
    const oldBitmap = Object.getOwnPropertyDescriptor(
      globalThis,
      "createImageBitmap",
    );
    Object.defineProperty(globalThis, "createImageBitmap", {
      configurable: true,
      value: jest.fn(async () => bitmap),
    });
    const draw = jest.fn();
    jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({
        drawImage: draw,
      } as unknown as CanvasRenderingContext2D);
    jest
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((done) => done(png));
    try {
      await expect(
        copyImageToClipboard(async () => new Blob(["jpg"], { type })),
      ).resolves.toBe(true);
      await expect(data["image/png"]).resolves.toBe(png);
      expect(draw).toHaveBeenCalledWith(bitmap, 0, 0);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      if (oldBitmap)
        Object.defineProperty(globalThis, "createImageBitmap", oldBitmap);
      else Reflect.deleteProperty(globalThis, "createImageBitmap");
    }
  },
);

test("failed reads report failure without copying a URL or reporting success", async () => {
  await expect(
    copyImageToClipboard(async () => {
      throw new Error("failed");
    }),
  ).resolves.toBe(false);
  expect(toast).toHaveBeenCalledTimes(1);
  expect(toast).toHaveBeenCalledWith("复制图片失败，请下载图片后使用");
});

test("unsupported clipboard does not load an image", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {},
  });
  const load = jest.fn<() => Promise<Blob>>();
  await expect(copyImageToClipboard(load)).resolves.toBe(false);
  expect(load).not.toHaveBeenCalled();
});
