/** @jest-environment node */
import { generatedImageUrls, imageResultUrl, imageResultUrls, readImageStream } from "../app/utils/image-response";

const images = Array.from({ length: 4 }, (_, index) => ({
  url: `https://media.test/image-${index}`,
  b64_json: "",
}));

test("keeps all returned image URLs and preserves the single-image helper", () => {
  expect(imageResultUrls({ data: images })).toEqual(images.map((image) => image.url));
  expect(imageResultUrl({ data: images })).toBe(images[0].url);
});

test("handles mixed URL and Base64 results with root output format", () => {
  expect(imageResultUrls({
    output_format: "webp",
    data: [images[0], { b64_json: "YWJj" }, null, {}, { url: "" }],
  })).toEqual([images[0].url, "data:image/webp;base64,YWJj"]);
});

test("manual save retry extracts separate URLs from the complete four-image message", () => {
  const urls = images.map((image) => image.url);
  const markdown = urls.map((url) => `![Generated Image](${url})`).join("\n\n");
  expect(generatedImageUrls(markdown)).toEqual(urls);
  expect(generatedImageUrls(`![Generated Image](${urls[0]})`)).toEqual([urls[0]]);
  expect(generatedImageUrls(markdown + "\n\nunrelated text")).toEqual([]);
});

test.each(["single-batch", "individual-events"])(
  "%s keeps every final image through fragmented SSE",
  async (mode) => {
    const finals = mode === "single-batch"
      ? [{ type: "image_generation.completed", data: images }]
      : images.map((image) => ({ type: "image_generation.completed", ...image }));
    const body = new TextEncoder().encode(
      finals.map((value) => `data: ${JSON.stringify(value)}\r\n\r\n`).join("") + "data: [DONE]\r\n\r\n",
    );
    const response = new Response(new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < body.length; offset += 7)
          controller.enqueue(body.slice(offset, offset + 7));
        controller.close();
      },
    }));
    let delivered: string[] = [];
    await readImageStream(response, undefined, (urls) => { delivered = urls; });
    expect(delivered).toEqual(images.map((image) => image.url));
  },
);
