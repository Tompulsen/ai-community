import { jest } from "@jest/globals";
import {
  createMaterialUpload,
  type MaterialUploadSnapshot,
} from "../app/utils/material-upload";
import type { ParsedFile } from "../app/utils/file-upload";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function image(name: string) {
  return new File(["image bytes"], name, { type: "image/png" });
}

function documentFile(name: string) {
  return new File(["document bytes"], name, { type: "application/pdf" });
}

function parsed(file: File): ParsedFile {
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    content: `data:${file.type};base64,Zml4dHVyZQ==`,
    isText: false,
  };
}

function loaders() {
  return {
    loadImage: jest
      .fn<(file: File) => Promise<string>>()
      .mockImplementation(async (file) => `data:image/png;${file.name}`),
    loadFile: jest
      .fn<(file: File) => Promise<ParsedFile>>()
      .mockImplementation(async (file) => parsed(file)),
    imageLimitError: "最多上传 5 张图片",
  };
}

function signal() {
  return new AbortController().signal;
}

test("publishes every item immediately and keeps cached snapshots immutable while loading serially", async () => {
  const options = loaders();
  const first = deferred<string>();
  const second = deferred<ParsedFile>();
  options.loadImage.mockReturnValue(first.promise);
  options.loadFile.mockReturnValue(second.promise);
  const upload = createMaterialUpload(options);
  const changes: MaterialUploadSnapshot[] = [];
  const unsubscribe = upload.subscribe(() =>
    changes.push(upload.getSnapshot()),
  );
  const batch = upload.add([image("first.png"), documentFile("second.pdf")]);
  const pending = upload.getSnapshot();
  expect(pending.pending).toBe(2);
  expect(pending.items.map(({ name, status }) => [name, status])).toEqual([
    ["first.png", "processing"],
    ["second.pdf", "processing"],
  ]);
  expect(upload.getSnapshot()).toBe(pending);
  expect(options.loadImage).toHaveBeenCalledTimes(1);
  expect(options.loadFile).not.toHaveBeenCalled();
  first.resolve("data:image/png;base64,Zmlyc3Q=");
  await Promise.resolve();
  expect(upload.getSnapshot().pending).toBe(1);
  expect(pending.pending).toBe(2);
  expect(pending.items[0].status).toBe("processing");
  expect(options.loadFile).toHaveBeenCalledTimes(1);
  second.resolve(parsed(documentFile("second.pdf")));
  await batch;
  const ready = upload.getSnapshot();
  expect(ready.pending).toBe(0);
  expect(ready.images[0].id).toBe(ready.items[0].id);
  expect(ready.files[0].id).toBe(ready.items[1].id);
  expect(changes).toHaveLength(3);
  unsubscribe();
  expect(await upload.wait(signal())).toEqual({
    images: ["data:image/png;base64,Zmlyc3Q="],
    files: [parsed(documentFile("second.pdf"))],
  });
});

test("one draft's pending work does not block or mutate another draft", async () => {
  const slowOptions = loaders();
  const slowImage = deferred<string>();
  slowOptions.loadImage.mockReturnValue(slowImage.promise);
  const first = createMaterialUpload(slowOptions);
  const second = createMaterialUpload(loaders());
  const firstBatch = first.add([image("slow.png")]);
  await second.add([documentFile("ready.pdf")]);
  expect(second.getSnapshot().pending).toBe(0);
  expect(first.getSnapshot().pending).toBe(1);
  slowImage.resolve("data:image/png;slow");
  await firstBatch;
  expect(second.getSnapshot().items).toHaveLength(1);
});

test("removing in-flight and queued items prevents them from returning or being read", async () => {
  const options = loaders();
  const slow = deferred<string>();
  options.loadImage.mockReturnValue(slow.promise);
  const upload = createMaterialUpload(options);
  const batch = upload.add([
    image("running.png"),
    image("queued.png"),
    documentFile("keep.pdf"),
  ]);
  const [running, queued] = upload.getSnapshot().items;
  upload.remove(running.id);
  upload.remove(queued.id);
  slow.resolve("data:image/png;removed");
  await batch;
  expect(options.loadImage).toHaveBeenCalledTimes(1);
  expect(options.loadFile).toHaveBeenCalledTimes(1);
  expect(upload.getSnapshot().items.map(({ name }) => name)).toEqual([
    "keep.pdf",
  ]);
  expect((await upload.wait(signal())).images).toEqual([]);
});

test("failures settle the batch, preserve success and retry only the failed raw file", async () => {
  const options = loaders();
  options.loadFile.mockRejectedValueOnce(new Error("Document reading failed"));
  const upload = createMaterialUpload(options);
  await upload.add([image("ready.png"), documentFile("retry.pdf")]);
  expect(upload.getSnapshot().pending).toBe(0);
  expect(upload.getSnapshot().images).toHaveLength(1);
  expect(upload.getSnapshot().items[1]).toMatchObject({
    status: "failed",
    error: "Document reading failed",
  });
  await expect(upload.wait(signal())).rejects.toThrow(
    "Document reading failed",
  );
  upload.retry();
  upload.retry();
  const ready = await upload.wait(signal());
  expect(ready.images).toHaveLength(1);
  expect(ready.files).toHaveLength(1);
  expect(options.loadImage).toHaveBeenCalledTimes(1);
  expect(options.loadFile).toHaveBeenCalledTimes(2);
});

test("a wait observes all queued items before reporting a failed preparation", async () => {
  const options = loaders();
  const remaining = deferred<ParsedFile>();
  options.loadImage.mockRejectedValue(new Error("Image failed"));
  options.loadFile.mockReturnValue(remaining.promise);
  const upload = createMaterialUpload(options);
  const batch = upload.add([image("bad.png"), documentFile("good.pdf")]);
  const waiting = upload.wait(signal());
  const rejected = expect(waiting).rejects.toThrow("Image failed");
  await Promise.resolve();
  expect(upload.getSnapshot().pending).toBe(1);
  remaining.resolve(parsed(documentFile("good.pdf")));
  await batch;
  await rejected;
  expect(upload.getSnapshot().files).toHaveLength(1);
});

test("image limits reserve processing slots, and removal releases a slot for retry", async () => {
  const options = loaders();
  const first = deferred<string>();
  options.loadImage.mockReturnValueOnce(first.promise);
  const upload = createMaterialUpload(options);
  const batch = upload.add(
    Array.from({ length: 6 }, (_, index) => image(`${index + 1}.png`)),
  );
  expect(upload.getSnapshot().pending).toBe(5);
  expect(upload.getSnapshot().items[5]).toMatchObject({
    status: "failed",
    error: options.imageLimitError,
  });
  upload.remove(upload.getSnapshot().items[1].id);
  upload.retry();
  expect(upload.getSnapshot().pending).toBe(5);
  first.resolve("data:image/png;first");
  await batch;
  expect((await upload.wait(signal())).images).toHaveLength(5);
  expect(options.loadImage.mock.calls.map(([file]) => file.name)).toEqual([
    "1.png",
    "3.png",
    "4.png",
    "5.png",
    "6.png",
  ]);
});

test("aborting a wait rejects promptly, cancels queued reads and ignores stale completion", async () => {
  const options = loaders();
  const inFlight = deferred<string>();
  options.loadImage.mockReturnValueOnce(inFlight.promise);
  const upload = createMaterialUpload(options, {
    images: ["data:image/png;initial"],
    files: [],
  });
  const batch = upload.add([image("slow.png"), documentFile("queued.pdf")]);
  const controller = new AbortController();
  const waiting = upload.wait(controller.signal);
  const rejected = expect(waiting).rejects.toMatchObject({
    name: "AbortError",
  });
  controller.abort();
  await rejected;
  await batch;
  expect(upload.getSnapshot().pending).toBe(0);
  expect(options.loadFile).not.toHaveBeenCalled();
  inFlight.resolve("data:image/png;discarded");
  await Promise.resolve();
  expect(upload.getSnapshot().images.map(({ url }) => url)).toEqual([
    "data:image/png;initial",
  ]);
});

test("explicit retry after cancellation runs once and cannot be overwritten by the old result", async () => {
  const options = loaders();
  const old = deferred<string>();
  options.loadImage.mockReturnValueOnce(old.promise);
  const upload = createMaterialUpload(options);
  const firstBatch = upload.add([image("retry.png")]);
  upload.cancel();
  upload.cancel();
  await firstBatch;
  upload.retry();
  upload.retry();
  old.resolve("data:image/png;stale");
  expect((await upload.wait(signal())).images).toEqual([
    "data:image/png;retry.png",
  ]);
  expect(options.loadImage).toHaveBeenCalledTimes(2);
});

test("an already aborted wait cancels preparation without subscribing indefinitely", async () => {
  const options = loaders();
  const first = deferred<string>();
  options.loadImage.mockReturnValue(first.promise);
  const upload = createMaterialUpload(options);
  const batch = upload.add([image("slow.png"), documentFile("never.pdf")]);
  const controller = new AbortController();
  controller.abort();
  await expect(upload.wait(controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  await batch;
  first.resolve("data:image/png;ignored");
  await Promise.resolve();
  expect(options.loadFile).not.toHaveBeenCalled();
  expect(upload.getSnapshot().images).toEqual([]);
});

test("initial materials are ready, carry stable ids and do not retain raw values in item metadata", async () => {
  const options = loaders();
  const initialFile = parsed(documentFile("initial.pdf"));
  const upload = createMaterialUpload(options, {
    images: ["data:image/png;base64,aW5pdGlhbA=="],
    files: [initialFile],
  });
  const initial = upload.getSnapshot();
  expect(initial.pending).toBe(0);
  expect(initial.items.every(({ status }) => status === "ready")).toBe(true);
  expect(initial.items[1]).not.toHaveProperty("content");
  expect(initial.items[1]).not.toHaveProperty("raw");
  expect(initial.files[0].file).not.toBe(initialFile);
  expect(await upload.wait(signal())).toEqual({
    images: ["data:image/png;base64,aW5pdGlhbA=="],
    files: [initialFile],
  });
  upload.retry();
  upload.remove("absent-id");
  upload.cancel();
  expect(upload.getSnapshot()).toBe(initial);
  expect(options.loadImage).not.toHaveBeenCalled();
  expect(options.loadFile).not.toHaveBeenCalled();
});
