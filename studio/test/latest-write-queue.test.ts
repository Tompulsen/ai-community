import { jest } from "@jest/globals";
import {
  createDeferredWriteQueue,
  createLatestWriteQueue,
} from "../app/utils/latest-write-queue";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test("coalesces same-tick snapshots before starting a write", async () => {
  const values: number[] = [];
  const save = createLatestWriteQueue(async (value: number) => {
    values.push(value);
  });
  await Promise.all([save(1), save(2), save(3)]);
  expect(values).toEqual([3]);
});

test("keeps only the latest queued snapshot while storage is blocked", async () => {
  const first = deferred();
  const last = deferred();
  const values: number[] = [];
  const save = createLatestWriteQueue(async (value: number) => {
    values.push(value);
    await (value === 0 ? first.promise : last.promise);
  });
  const writing = save(0);
  await Promise.resolve();
  const writes = Array.from({ length: 1000 }, (_, index) => save(index + 1));
  expect(values).toEqual([0]);
  first.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(values).toEqual([0, 1000]);
  let finished = false;
  void writing.then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  last.resolve();
  await Promise.all([writing, ...writes]);
  expect(finished).toBe(true);
});

test("writes newer state even when an obsolete write fails", async () => {
  const blocked = deferred();
  const values: number[] = [];
  const save = createLatestWriteQueue(async (value: number) => {
    values.push(value);
    if (value === 1) await blocked.promise;
  });
  const writing = save(1);
  await Promise.resolve();
  const next = save(2);
  blocked.reject(new Error("obsolete write failed"));
  await Promise.all([writing, next]);
  expect(values).toEqual([1, 2]);
});

test("propagates the latest failure and accepts future writes", async () => {
  const save = createLatestWriteQueue(async (value: number) => {
    if (value === 1) throw new Error("storage failed");
  });
  await expect(save(1)).rejects.toThrow("storage failed");
  await expect(save(2)).resolves.toBeUndefined();
});

describe("deferred snapshots", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("saves the latest streaming checkpoint without postponing indefinitely", async () => {
    const values: number[] = [];
    const save = createDeferredWriteQueue(async (value: number) => {
      values.push(value);
    }, 250);
    const first = save(1);
    await jest.advanceTimersByTimeAsync(200);
    const latest = save(2);
    await jest.advanceTimersByTimeAsync(50);
    await Promise.all([first, latest]);
    expect(values).toEqual([2]);
  });

  test("completion and explicit flush bypass the checkpoint delay", async () => {
    const values: number[] = [];
    const save = createDeferredWriteQueue(async (value: number) => {
      values.push(value);
    }, 250);
    const first = save(1);
    await save(2, true);
    await first;
    expect(values).toEqual([2]);
    const next = save(3);
    await save.flush();
    await next;
    expect(values).toEqual([2, 3]);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a final snapshot arriving during a write starts immediately after it", async () => {
    const blocked = deferred();
    const values: number[] = [];
    const save = createDeferredWriteQueue(async (value: number) => {
      values.push(value);
      if (value === 1) await blocked.promise;
    }, 250);
    const first = save(1, true);
    const final = save(2, true);
    blocked.resolve();
    await Promise.all([first, final]);
    expect(values).toEqual([1, 2]);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("reports the latest failure and supports a later retry", async () => {
    const save = createDeferredWriteQueue(async (value: number) => {
      if (value === 1) throw new Error("storage failed");
    }, 250);
    await expect(save(1, true)).rejects.toThrow("storage failed");
    await expect(save(2, true)).resolves.toBeUndefined();
  });
});
