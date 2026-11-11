/** @jest-environment node */

import { jest } from "@jest/globals";

const localBlob = jest.fn<() => Promise<Blob>>();
jest.unstable_mockModule("@/app/store/gallery", () => ({
  getImageBlob: localBlob,
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => "user-progress-test",
}));
const { fetchImageBlob, loadImageAsset, invalidateImageAsset } = await import(
  "../app/utils/image-asset"
);

describe("image download progress", () => {
  let source: string;
  let counter = 0;
  beforeEach(() => {
    source = `https://images.example.com/progress-${counter++}.png`;
    Object.defineProperty(global, "window", {
      configurable: true,
      value: { location: { href: "https://chat.example.com/" } },
    });
    let timestamp = 0;
    jest.spyOn(performance, "now").mockImplementation(() => (timestamp += 150));
    global.fetch = jest.fn<typeof fetch>();
    localBlob.mockReset();
  });
  afterEach(() => {
    invalidateImageAsset(source);
    jest.restoreAllMocks();
  });

  function response(headers: HeadersInit = {}) {
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(4));
          controller.enqueue(new Uint8Array(6));
          controller.close();
        },
      }),
      { headers: { "content-type": "image/png", ...headers } },
    );
  }

  it("reports actual received bytes to subscribers sharing one download", async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(response({ "content-length": "10" }));
    const first = jest.fn();
    const second = jest.fn();
    const [a, b] = await Promise.all([
      fetchImageBlob(source, first),
      fetchImageBlob(source, second),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a.size).toBe(10);
    expect(a.type).toBe("image/png");
    for (const listener of [first, second]) {
      expect(listener).toHaveBeenCalledWith({ loaded: 4, total: 10 });
      expect(listener).toHaveBeenLastCalledWith({ loaded: 10, total: 10 });
    }
    first.mockClear();
    await fetchImageBlob(source, second);
    expect(first).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    {},
    { "content-length": "invalid" },
    { "content-length": "2", "content-encoding": "gzip" },
  ] as Record<string, string>[])(
    "does not invent a percentage for unmeasurable transfers: %o",
    async (headers) => {
      jest.mocked(fetch).mockResolvedValueOnce(response(headers));
      const progress = jest.fn();
      await fetchImageBlob(source, progress);
      expect(progress).toHaveBeenCalledWith({ loaded: 4, total: undefined });
      expect(progress).toHaveBeenLastCalledWith({ loaded: 10, total: 10 });
    },
  );

  it("uses the decoded image size preserved by the streaming proxy", async () => {
    jest.mocked(fetch).mockResolvedValueOnce(
      response({
        "x-image-content-length": "10",
        "content-encoding": "gzip",
      }),
    );
    const progress = jest.fn();
    await fetchImageBlob(source, progress);
    expect(progress).toHaveBeenCalledWith({ loaded: 4, total: 10 });
  });

  it("reads saved images without a network download or download progress", async () => {
    const blob = new Blob(["saved"], { type: "image/png" });
    localBlob.mockResolvedValueOnce(blob);
    const progress = jest.fn();
    expect(await loadImageAsset(source, "saved-image", false, progress)).toBe(
      blob,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it("falls back to the source for missing local images and supports retry", async () => {
    localBlob.mockRejectedValueOnce(new Error("missing"));
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(new Response("unavailable", { status: 502 }));
    await expect(loadImageAsset(source, "missing-image")).rejects.toThrow();
    jest.mocked(fetch).mockResolvedValueOnce(response());
    expect((await loadImageAsset(source, "missing-image", true)).size).toBe(10);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps Base64 images local", async () => {
    const progress = jest.fn();
    const blob = await fetchImageBlob("data:image/png;base64,YQ==", progress);
    expect(blob.size).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it("propagates interrupted streams instead of completing progress", async () => {
    jest.mocked(fetch).mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("disconnected"));
          },
        }),
      ),
    );
    const progress = jest.fn();
    await expect(fetchImageBlob(source, progress)).rejects.toThrow(
      "disconnected",
    );
    expect(progress).not.toHaveBeenCalledWith({ loaded: 10, total: 10 });
  });
});
