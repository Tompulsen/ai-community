import { jest } from "@jest/globals";

const values = new Map<string, string>();
const read = jest.fn<(key: string) => Promise<string | undefined>>();
const write = jest.fn<(key: string, value: string) => Promise<void>>();
const remove = jest.fn<(key: string) => Promise<void>>();
jest.unstable_mockModule("idb-keyval", () => ({
  get: read,
  set: write,
  del: remove,
  clear: async () => values.clear(),
}));
jest.unstable_mockModule("@/app/utils", () => ({
  safeLocalStorage: () => localStorage,
}));
const { indexedDBStorage } = await import("../app/utils/indexedDB-storage");
const name = "octopus:user-7:chat";
const marker = `${name}:local-storage-fallback`;
const snapshot = (revision: number) =>
  JSON.stringify({ state: { _hasHydrated: true, revision } });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  values.clear();
  localStorage.clear();
  read.mockReset().mockImplementation(async (key) => values.get(key));
  write.mockReset().mockImplementation(async (key, value) => {
    values.set(key, value);
  });
  remove.mockReset().mockImplementation(async (key) => {
    values.delete(key);
  });
});

test("reloads the latest fallback after an IndexedDB write fails", async () => {
  values.set(name, snapshot(1));
  write.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
  await indexedDBStorage.setItem(name, snapshot(2));
  expect(localStorage.getItem(marker)).not.toBeNull();
  await expect(indexedDBStorage.getItem(name)).resolves.toBe(snapshot(2));
});

test("keeps IndexedDB precedence for unmarked legacy fallback copies", async () => {
  values.set(name, snapshot(2));
  localStorage.setItem(name, snapshot(1));
  await expect(indexedDBStorage.getItem(name)).resolves.toBe(snapshot(2));
});

test("uses an unmarked fallback when IndexedDB reads fail", async () => {
  localStorage.setItem(name, snapshot(2));
  read.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
  await expect(indexedDBStorage.getItem(name)).resolves.toBe(snapshot(2));
});

test("successful writes retire the previous fallback and its marker", async () => {
  write.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
  await indexedDBStorage.setItem(name, snapshot(1));
  await indexedDBStorage.setItem(name, snapshot(2));
  expect(localStorage.getItem(name)).toBeNull();
  expect(localStorage.getItem(marker)).toBeNull();
  await expect(indexedDBStorage.getItem(name)).resolves.toBe(snapshot(2));
});

test("an earlier successful write cannot discard a newer failed write", async () => {
  const blocked = deferred();
  write
    .mockImplementationOnce(async (key, value) => {
      await blocked.promise;
      values.set(key, value);
    })
    .mockRejectedValueOnce(new Error("IndexedDB unavailable"));
  const first = indexedDBStorage.setItem(name, snapshot(1));
  await Promise.resolve();
  const latest = indexedDBStorage.setItem(name, snapshot(2));
  blocked.resolve();
  await Promise.all([first, latest]);
  expect(values.get(name)).toBe(snapshot(1));
  await expect(indexedDBStorage.getItem(name)).resolves.toBe(snapshot(2));
});

test("does not clear a newer fallback saved by another document", async () => {
  const blocked = deferred();
  localStorage.setItem(name, snapshot(1));
  localStorage.setItem(marker, "previous-document");
  write.mockImplementationOnce(async (key, value) => {
    await blocked.promise;
    values.set(key, value);
  });
  const saving = indexedDBStorage.setItem(name, snapshot(2));
  await Promise.resolve();
  localStorage.setItem(name, snapshot(3));
  localStorage.setItem(marker, "newer-document");
  blocked.resolve();
  await saving;
  await expect(indexedDBStorage.getItem(name)).resolves.toBe(snapshot(3));
});

test("removing a store removes its fallback without touching other stores", async () => {
  values.set(name, snapshot(1));
  localStorage.setItem(name, snapshot(1));
  localStorage.setItem(marker, "failed-write");
  const otherName = "octopus:user-8:chat";
  values.set(otherName, snapshot(2));
  localStorage.setItem(otherName, snapshot(2));
  localStorage.setItem(`${otherName}:local-storage-fallback`, "other-marker");
  await indexedDBStorage.removeItem(name);
  expect(values.has(name)).toBe(false);
  expect(localStorage.getItem(name)).toBeNull();
  expect(localStorage.getItem(marker)).toBeNull();
  expect(values.get(otherName)).toBe(snapshot(2));
  expect(localStorage.getItem(otherName)).toBe(snapshot(2));
  expect(localStorage.getItem(`${otherName}:local-storage-fallback`)).toBe(
    "other-marker",
  );
});
