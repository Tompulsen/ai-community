import { jest } from "@jest/globals";
import type { GalleryImage } from "../app/store/gallery";

jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  initializeLocalWorkspace: async () => "user-7",
  isLocalWorkspaceActive: () => true,
  trackLocalWrite: (write: Promise<void>) => write,
}));
const { getImageMetadata } = await import("../app/store/gallery");
const originalIndexedDB = Object.getOwnPropertyDescriptor(
  globalThis,
  "indexedDB",
);
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL",
);

afterEach(() => {
  for (const [target, property, descriptor] of [
    [globalThis, "indexedDB", originalIndexedDB],
    [URL, "createObjectURL", originalCreateObjectURL],
  ] as const) {
    if (descriptor) Object.defineProperty(target, property, descriptor);
    else Reflect.deleteProperty(target, property);
  }
});

function readonlyGallery(record?: GalleryImage & { thumbnail?: Blob }) {
  const close = jest.fn();
  const get = jest.fn((id: IDBValidKey) => {
    const request = {
      result: record?.id === id ? record : undefined,
      onsuccess: undefined as (() => void) | undefined,
    };
    queueMicrotask(() => {
      request.onsuccess?.();
      queueMicrotask(() => tx.oncomplete?.());
    });
    return request;
  });
  const objectStore = jest.fn(() => ({ get }));
  const tx = { objectStore, oncomplete: undefined as (() => void) | undefined };
  const transaction = jest.fn(() => tx);
  const open = jest.fn(() => {
    const request = {
      result: { transaction, close },
      onsuccess: undefined as (() => void) | undefined,
    };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  });
  const createObjectURL = jest.fn();
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: { open },
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  return { open, transaction, objectStore, get, close, createObjectURL };
}

test("metadata reads only the requested account record without loading media or creating preview URLs", async () => {
  const record: GalleryImage & { thumbnail: Blob } = {
    id: "original-image",
    prompt: "Original prompt",
    model: "gpt-image-2.6",
    references: ["data:image/png;base64,YQ=="],
    sourceWorkId: "source-work",
    config: {
      providerName: "OpenAI",
      size: "16:9",
      quality: "high",
      imageOutputCompression: 0,
    },
    width: 1536,
    height: 1024,
    createdAt: 1,
    status: "success",
    imageData: "data:image/png;base64,Yg==",
    thumbnail: new Blob(["preview"]),
  };
  const fixture = readonlyGallery(record);
  const metadata = await getImageMetadata(record.id, "user-9");
  expect(metadata).toEqual({
    id: record.id,
    prompt: record.prompt,
    model: record.model,
    references: record.references,
    sourceWorkId: record.sourceWorkId,
    config: record.config,
    width: 1536,
    height: 1024,
    createdAt: 1,
    status: "success",
  });
  expect(fixture.open).toHaveBeenCalledWith("octopus-gallery-user-9", 3);
  expect(fixture.transaction).toHaveBeenCalledWith("images", "readonly");
  expect(fixture.objectStore).toHaveBeenCalledTimes(1);
  expect(fixture.objectStore).toHaveBeenCalledWith("images");
  expect(fixture.get).toHaveBeenCalledWith("original-image");
  expect(fixture.createObjectURL).not.toHaveBeenCalled();
  expect(fixture.close).toHaveBeenCalledTimes(1);
});

test("missing metadata stays absent and uses the current workspace by default", async () => {
  const fixture = readonlyGallery();
  expect(await getImageMetadata("missing")).toBeUndefined();
  expect(fixture.open).toHaveBeenCalledWith("octopus-gallery-user-7", 3);
  expect(fixture.createObjectURL).not.toHaveBeenCalled();
  expect(fixture.close).toHaveBeenCalledTimes(1);
});
