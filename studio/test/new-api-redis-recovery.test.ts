/** @jest-environment node */

import { jest } from "@jest/globals";

type RedisOptions = {
  retryStrategy: (attempt: number) => number | null;
};

const instances: MockRedis[] = [];
class MockRedis {
  status = "ready";
  get = jest
    .fn<(key: string) => Promise<string | null>>()
    .mockResolvedValue(null);
  on = jest.fn();
  disconnect = jest.fn();

  constructor(
    public url: string,
    public options: RedisOptions,
  ) {
    instances.push(this);
  }
}

jest.unstable_mockModule("ioredis", () => ({ default: MockRedis }));

type SessionModule = typeof import("../app/lib/new-api/session");
let sessions: SessionModule;
const originalEnv = process.env;

function state() {
  return (
    globalThis as typeof globalThis & {
      __octopusNewApiSessions: {
        memory: Map<string, { value: string; expires: number }>;
        locks: Map<string, Promise<void>>;
        redis?: MockRedis;
      };
    }
  ).__octopusNewApiSessions;
}

beforeAll(async () => {
  sessions = await import("../app/lib/new-api/session");
});

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: "production",
    NEW_API_BASE_URL: "https://accounts.example.test",
    NEW_API_PUBLIC_URL: "https://accounts.example.test",
    NEW_API_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    NEW_API_REDIS_URL: "redis://mock-redis.invalid:6379",
  };
  state().redis = undefined;
  state().memory.clear();
  state().locks.clear();
  instances.length = 0;
});

afterEach(() => {
  process.env = originalEnv;
  state().redis = undefined;
  state().memory.clear();
  state().locks.clear();
});

describe("New API durable session connection recovery", () => {
  test("recreates a permanently ended Redis client on the next request", async () => {
    const id = "a".repeat(43);
    await sessions.readSessionById(id);
    const ended = instances[0];
    ended.status = "end";

    await expect(sessions.readSessionById(id)).resolves.toBeNull();

    expect(instances).toHaveLength(2);
    expect(ended.get).toHaveBeenCalledTimes(1);
    expect(instances[1].get).toHaveBeenCalledWith("octopus:new-api:" + id);
  });

  test("reuses a Redis client that is already reconnecting", async () => {
    const id = "a".repeat(43);
    await sessions.readSessionById(id);
    instances[0].status = "reconnecting";

    await sessions.readSessionById(id);

    expect(instances).toHaveLength(1);
    expect(instances[0].get).toHaveBeenCalledTimes(2);
  });

  test("permits only three delayed reconnect attempts", async () => {
    await sessions.readSessionById("a".repeat(43));
    const retry = instances[0].options.retryStrategy;
    const delays = [retry(1), retry(2), retry(3)];

    expect(
      delays.every((delay) => typeof delay === "number" && delay > 0),
    ).toBe(true);
    expect(delays[1]).toBeGreaterThan(delays[0]!);
    expect(delays[2]).toBeGreaterThan(delays[1]!);
    expect(retry(4)).toBeNull();
    expect(retry(10)).toBeNull();
  });

  test("does not use a local memory session if durable storage is unavailable", async () => {
    const id = "a".repeat(43);
    await sessions.readSessionById(id);
    const failure = new Error("Simulated Redis connection unavailable");
    instances[0].get.mockRejectedValueOnce(failure);
    state().memory.set(id, {
      value: "a-local-entry-that-must-not-be-read",
      expires: Date.now() + 60000,
    });

    await expect(sessions.readSessionById(id)).rejects.toBe(failure);
    expect(instances).toHaveLength(1);
  });
});
