/** @jest-environment node */

import { modelBodyLimit, readRequestBody } from "../app/utils/request-body";

function streamingRequest(chunks: Uint8Array[], length?: string): Request {
  return new Request("http://localhost/upload", {
    method: "POST",
    headers: length ? { "content-length": length } : {},
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit);
}

test.each([undefined, "1", "9"])(
  "enforces actual cumulative bytes despite content-length %s",
  async (length) => {
    const req = streamingRequest([Buffer.alloc(5), Buffer.alloc(5)], length);
    await expect(readRequestBody(req, 9)).rejects.toMatchObject({
      status: 413,
    });
  },
);

test("rejects declared oversized bodies before reading", async () => {
  const req = streamingRequest([], "100");
  await expect(readRequestBody(req, 9)).rejects.toMatchObject({ status: 413 });
});

test("preserves raw multipart bytes at the exact limit", async () => {
  const bytes = Buffer.from([0, 255, 13, 10, 128, 1]);
  const body = await readRequestBody(streamingRequest([bytes]), bytes.length);
  expect(body?.equals(bytes)).toBe(true);
});

test("retains the 20 MiB video workflow after base64 encoding", async () => {
  const encoded = Buffer.alloc(20 * 1024 * 1024).toString("base64");
  const bytes = Buffer.from(JSON.stringify({ video: encoded }));
  const body = await readRequestBody(
    streamingRequest([bytes]),
    modelBodyLimit("responses"),
  );
  expect(body?.equals(bytes)).toBe(true);
  expect(modelBodyLimit("images/edits")).toBe(64 * 1024 * 1024);
  expect(modelBodyLimit("async-images/v1/edits")).toBe(64 * 1024 * 1024);
});

test("upload deadline is not blocked by a hanging stream cancellation", async () => {
  const req = new Request("http://localhost/upload", {
    method: "POST",
    body: new ReadableStream({
      pull: () => new Promise(() => {}),
      cancel: () => new Promise(() => {}),
    }),
    duplex: "half",
  } as RequestInit);
  await expect(readRequestBody(req, 9, 10)).rejects.toMatchObject({
    status: 408,
  });
});

test("broken and aborted streams fail instead of forwarding empty bodies", async () => {
  const req = new Request("http://localhost/upload", {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        controller.error(new Error("broken"));
      },
    }),
    duplex: "half",
  } as RequestInit);
  await expect(readRequestBody(req, 9)).rejects.toMatchObject({ status: 400 });
  const controller = new AbortController();
  controller.abort();
  const aborted = new Request("http://localhost/upload", {
    method: "POST",
    body: "test",
    signal: controller.signal,
  });
  await expect(readRequestBody(aborted, 9)).rejects.toMatchObject({
    status: 400,
  });
});
