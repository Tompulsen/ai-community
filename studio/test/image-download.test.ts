import { downloadImage } from "../app/utils/image-download";
import { jest } from "@jest/globals";

describe("image file downloads", () => {
  const click = jest.fn();
  const revoke = jest.fn();
  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:download"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revoke,
    });
    jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        click({ href: this.href, filename: this.download });
      });
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["original-image"], { type: "image/png" }),
    } as Response);
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    click.mockClear();
    revoke.mockClear();
  });
  it("downloads cross-origin images as a blob via the existing proxy", async () => {
    await downloadImage("https://images.example.com/a.png?signature=abc");
    expect(fetch).toHaveBeenCalledWith(
      "/studio/api/proxy-image?url=" +
        encodeURIComponent("https://images.example.com/a.png?signature=abc"),
    );
    expect(click).toHaveBeenCalledWith({
      href: "blob:download",
      filename: "image.png",
    });
    expect(revoke).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(revoke).toHaveBeenCalledWith("blob:download");
  });
  it("fetches local data URLs directly", async () => {
    const src = "data:image/png;base64,YQ==";
    await downloadImage(src, "test.jpg");
    expect(fetch).toHaveBeenCalledWith(src);
    expect(click).toHaveBeenCalledWith({
      href: "blob:download",
      filename: "test.png",
    });
  });
  it("rejects failed/non-image responses without navigation", async () => {
    jest.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 502 } as Response);
    await expect(downloadImage("https://example.com/image")).rejects.toThrow();
    jest.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(["error"], { type: "text/html" }),
    } as Response);
    await expect(downloadImage("/bad-image")).rejects.toThrow();
    await expect(downloadImage("javascript:alert(1)")).rejects.toThrow();
    expect(click).not.toHaveBeenCalled();
  });
});
