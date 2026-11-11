import { jest } from "@jest/globals";

const values = new Map<IDBValidKey, unknown>();
const transaction = jest.fn();
const createStore = jest.fn(() => transaction);
const get = jest.fn(async (key: IDBValidKey, store: unknown) => {
  expect(store).toBeDefined();
  return values.get(key);
});
jest.unstable_mockModule("idb-keyval", () => ({
  createStore, get,
  set: async (key: IDBValidKey, value: unknown, store: unknown) => { expect(store).toBeDefined(); values.set(key, value); },
  del: async (key: IDBValidKey, store: unknown) => { expect(store).toBeDefined(); values.delete(key); },
  clear: async (store: unknown) => { expect(store).toBeDefined(); values.clear(); },
}));
const studio = await import("../app/utils/studio-keyval");

test("history and attachment transactions share a studio-only database", async () => {
  const callback = () => Promise.resolve();
  studio.studioStore("readwrite", callback);
  expect(createStore).toHaveBeenCalledWith("community-studio", "keyval");
  expect(transaction).toHaveBeenCalledWith("readwrite", callback);
  await studio.set("octopus:user-1:chat", "private-one");
  await studio.set("octopus:user-2:chat", "private-two");
  expect(await studio.get("octopus:user-1:chat")).toBe("private-one");
  expect(get).toHaveBeenCalledWith("octopus:user-1:chat", studio.studioStore);
  await studio.del("octopus:user-1:chat");
  expect(await studio.get("octopus:user-2:chat")).toBe("private-two");
  await studio.clear();
  expect(values.size).toBe(0);
  expect(createStore).toHaveBeenCalledTimes(1);
});
