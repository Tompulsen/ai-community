import assert from "node:assert/strict";
import { readImageStream, imageResultUrl } from "../app/utils/image-response";
import {
  imageOutputParams,
  imagePromptLength,
  validateImagePrompt,
} from "../app/utils/image-params";

const encode = new TextEncoder();
function streamResponse(text: string) {
  const bytes = encode.encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7)
          controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
function event(type: string, fields: Record<string, unknown>) {
  return `event: ${type}\r\ndata: ${JSON.stringify({
    type,
    ...fields,
  })}\r\n\r\n`;
}

async function main() {
  const previews: string[] = [];
  const image = await readImageStream(
    streamResponse(
      ": keep-alive\r\n\r\n" +
        event("image_generation.partial_image", {
          b64_json: "PREVIEW",
          output_format: "jpeg",
        }) +
        event("image_generation.completed", {
          b64_json: "FINAL",
          output_format: "webp",
        }) +
        "data: [DONE]\r\n\r\n",
    ),
    (url) => previews.push(url),
  );
  assert.deepEqual(previews, ["data:image/jpeg;base64,PREVIEW"]);
  assert.equal(image, "data:image/webp;base64,FINAL");
  assert.equal(
    await readImageStream(
      streamResponse(
        event("image_edit.completed", { b64_json: "EDIT" }).trimEnd(),
      ),
    ),
    "data:image/png;base64,EDIT",
  );
  await assert.rejects(
    readImageStream(
      streamResponse(
        event("image_generation.partial_image", { b64_json: "ONLY_PREVIEW" }),
      ),
    ),
    /未收到最终图片/,
  );
  let cancelled = false;
  const errorResponse = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          encode.encode(event("error", { message: "upstream failed" })),
        );
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(readImageStream(errorResponse), /upstream failed/);
  assert(cancelled);
  assert.equal(errorResponse.body!.locked, false);

  let previewReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    previewReady = resolve;
  });
  let producer!: ReadableStreamDefaultController<Uint8Array>;
  const delayedResponse = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        producer = controller;
      },
    }),
  );
  let finished = false;
  const pending = readImageStream(delayedResponse, () => previewReady()).then(
    (url) => {
      finished = true;
      return url;
    },
  );
  producer.enqueue(
    encode.encode(
      event("image_generation.partial_image", { b64_json: "EARLY" }),
    ),
  );
  await ready;
  assert.equal(finished, false, "preview must render before completion");
  producer.enqueue(
    encode.encode(event("image_generation.completed", { b64_json: "LATE" })),
  );
  producer.close();
  assert.equal(await pending, "data:image/png;base64,LATE");
  const responsesImage = await readImageStream(
    streamResponse(
      event("response.image_generation_call.partial_image", {
        partial_image_b64: "P",
      }) +
        event("response.completed", {
          response: {
            output: [{ type: "image_generation_call", result: "R" }],
          },
        }),
    ),
  );
  assert.equal(responsesImage, "data:image/png;base64,R");
  assert.equal(
    imageResultUrl({ data: [{ b64_json: "RAW" }], output_format: "jpeg" }),
    "data:image/jpeg;base64,RAW",
  );
  assert.equal(imageOutputParams({}).output_compression, undefined);
  assert.equal(imageOutputParams({}).partial_images, undefined);
  assert.equal(
    imageOutputParams({ imageOutputFormat: "jpeg", imageOutputCompression: 0 })
      .output_compression,
    0,
  );
  assert.equal(
    imageOutputParams({
      imageOutputFormat: "jpeg",
      imageBackground: "transparent",
    }).output_format,
    "png",
  );
  assert.equal(
    imageOutputParams({ imageStream: true, imagePartialImages: 3 })
      .partial_images,
    3,
  );
  assert.equal(imagePromptLength("图😀"), 2);
  validateImagePrompt("😀".repeat(32000));
  assert.throws(() => validateImagePrompt("图".repeat(32001)), /32,000/);
  console.log(
    JSON.stringify({
      fragmentedSse: true,
      previewBeforeFinal: true,
      edits: true,
      responses: true,
      truncatedStream: true,
      errorCancellation: true,
      outputParams: true,
      unicodeLimit: true,
      result: "passed",
    }),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
