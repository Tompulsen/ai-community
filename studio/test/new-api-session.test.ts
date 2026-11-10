/** @jest-environment node */

import { jest } from "@jest/globals";
import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  getSessionId,
  readSession,
  readSessionById,
  saveSession,
  withSessionLock,
} from "../app/lib/new-api/session";
import {
  getNewApiConfig,
  requireNewApiConfig,
} from "../app/lib/new-api/config";

const originalEnv = process.env;
const user = {
  id: 17,
  username: "account-a",
  display_name: "Account A",
  quota: 100,
  used_quota: 20,
  request_count: 2,
  group: "default",
};
const credentials = {
  user,
  accessToken: "private-access-token-a",
  accessExpiresAt: Math.floor(Date.now() / 1000) + 3600,
  refreshToken: "private-refresh-token-a",
  upstreamSessionId: "upstream-session-a",
  selectedTokenId: 23,
  selectedKey: "sk-private-relay-key-a",
};

function request(id?: string, url = "https://chat.example.test/api/account") {
  const headers = new Headers({ host: new URL(url).host });
  if (id) headers.set("cookie", `${SESSION_COOKIE}=${id}`);
  return new NextRequest(url, { headers });
}

function memoryStore() {
  return (
    globalThis as typeof globalThis & {
      __octopusNewApiSessions: {
        memory: Map<string, { value: string; expires: number }>;
        locks: Map<string, Promise<void>>;
      };
    }
  ).__octopusNewApiSessions;
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    NEW_API_BASE_URL: "https://accounts.example.test",
    NEW_API_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    NEW_API_REDIS_URL: "",
  };
  memoryStore().memory.clear();
  memoryStore().locks.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env = originalEnv;
  memoryStore().memory.clear();
  memoryStore().locks.clear();
});

describe("New API session configuration", () => {
  test("fails closed in production without a durable session store", () => {
    process.env = { ...process.env, NODE_ENV: "production" };

    expect(getNewApiConfig().configured).toBe(false);
    expect(() => requireNewApiConfig()).toThrow(
      expect.objectContaining({ status: 503 }),
    );
  });

  test("rejects a short encryption secret", () => {
    process.env.NEW_API_SESSION_SECRET = "too-short";

    expect(() => requireNewApiConfig()).toThrow(
      expect.objectContaining({ status: 503 }),
    );
  });

  test("accepts only a fixed HTTP(S) upstream origin", () => {
    for (const value of [
      "https://user:password@accounts.example.test",
      "https://accounts.example.test/custom/path",
      "https://accounts.example.test?redirect=elsewhere",
      "file:///etc/passwd",
    ]) {
      process.env.NEW_API_BASE_URL = value;
      expect(() => getNewApiConfig()).toThrow();
    }
  });
});

describe("New API opaque browser sessions", () => {
  test("stores credentials encrypted and exposes only a secure opaque cookie", async () => {
    const response = NextResponse.json({});
    const created = await createSession(request(), response, credentials);
    const cookie = response.headers.get("set-cookie") || "";
    const stored = memoryStore().memory.get(created.id)?.value || "";

    expect(created.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie).toContain(`${SESSION_COOKIE}=${created.id}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Path=/");
    for (const secret of [
      credentials.accessToken,
      credentials.refreshToken,
      credentials.selectedKey,
    ]) {
      expect(cookie).not.toContain(secret);
      expect(stored).not.toContain(secret);
    }
    expect(await readSession(request(created.id))).toEqual(created.session);
  });

  test("rejects malformed and unknown session IDs", async () => {
    for (const value of [
      "short",
      "../session",
      "a".repeat(44),
      "a".repeat(43),
    ]) {
      const req = request(value);
      expect(await readSession(req)).toBeNull();
    }
    expect(getSessionId(request("a".repeat(43)))).toBe("a".repeat(43));
    expect(getSessionId(request("../session"))).toBeNull();
  });

  test("rejects tampered encrypted session data", async () => {
    const created = await createSession(
      request(),
      NextResponse.json({}),
      credentials,
    );
    const stored = memoryStore().memory.get(created.id)!;
    stored.value = "tampered-" + stored.value;

    expect(await readSessionById(created.id)).toBeNull();
  });

  test("cannot decrypt credentials after the secret changes", async () => {
    const created = await createSession(
      request(),
      NextResponse.json({}),
      credentials,
    );
    process.env.NEW_API_SESSION_SECRET =
      "different-test-secret-with-more-than-32-characters";

    expect(await readSessionById(created.id)).toBeNull();
  });

  test("enforces the session expiry even if the storage entry still exists", async () => {
    const id = "a".repeat(43);
    const now = Math.floor(Date.now() / 1000);
    await saveSession(id, {
      ...credentials,
      createdAt: now - 600,
      expiresAt: now - 1,
      version: 1,
    });
    expect(memoryStore().memory.has(id)).toBe(true);

    expect(await readSessionById(id)).toBeNull();
  });

  test("rotates the session ID on login and invalidates the previous session", async () => {
    const previous = await createSession(request(), NextResponse.json({}), {
      flowToken: "temporary-mfa-flow",
      flowExpiresAt: Math.floor(Date.now() / 1000) + 300,
    });
    const response = NextResponse.json({});
    const current = await createSession(
      request(previous.id),
      response,
      credentials,
    );

    expect(current.id).not.toBe(previous.id);
    expect(await readSessionById(previous.id)).toBeNull();
    expect(await readSessionById(current.id)).toEqual(current.session);
  });

  test("limits an incomplete MFA session to five minutes", async () => {
    const response = NextResponse.json({});
    const created = await createSession(request(), response, {
      flowToken: "temporary-mfa-flow",
      flowExpiresAt: Math.floor(Date.now() / 1000) + 300,
    });

    expect(created.session.expiresAt - created.session.createdAt).toBe(300);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=300");
    expect(created.session.accessToken).toBeUndefined();
  });

  test("deletes server credentials and expires the browser cookie on logout", async () => {
    const created = await createSession(
      request(),
      NextResponse.json({}),
      credentials,
    );
    const response = NextResponse.json({});
    await deleteSession(request(created.id), response);

    expect(await readSessionById(created.id)).toBeNull();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("New API session mutation serialization", () => {
  test("does not revive the previous session when login rotates during a refresh", async () => {
    const previous = await createSession(
      request(),
      NextResponse.json({}),
      credentials,
    );
    let finishRefresh!: () => void;
    let refreshStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      refreshStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const refresh = withSessionLock(previous.id, async () => {
      const current = (await readSessionById(previous.id))!;
      refreshStarted();
      await gate;
      await saveSession(previous.id, {
        ...current,
        accessToken: "refreshed-previous-access-token",
        version: current.version + 1,
      });
    });
    await started;

    const rotatingRequest = request(previous.id);
    const originalGet = rotatingRequest.cookies.get.bind(
      rotatingRequest.cookies,
    );
    let rotationReachedPreviousCookie!: () => void;
    const reachedCookie = new Promise<void>((resolve) => {
      rotationReachedPreviousCookie = resolve;
    });
    jest.spyOn(rotatingRequest.cookies, "get").mockImplementation((...args) => {
      rotationReachedPreviousCookie();
      return originalGet(...args);
    });
    const rotation = createSession(
      rotatingRequest,
      NextResponse.json({}),
      credentials,
    );
    await reachedCookie;
    finishRefresh();
    await Promise.all([refresh, rotation]);

    expect(await readSessionById(previous.id)).toBeNull();
  });

  test("does not revive a deleted session when logout overlaps a refresh", async () => {
    const created = await createSession(
      request(),
      NextResponse.json({}),
      credentials,
    );
    let finishRefresh!: () => void;
    let refreshStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      refreshStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const refresh = withSessionLock(created.id, async () => {
      const current = (await readSessionById(created.id))!;
      refreshStarted();
      await gate;
      await saveSession(created.id, {
        ...current,
        accessToken: "refreshed-previous-access-token",
        version: current.version + 1,
      });
    });
    await started;
    const logout = deleteSession(request(created.id), NextResponse.json({}));
    finishRefresh();
    await Promise.all([refresh, logout]);

    expect(await readSessionById(created.id)).toBeNull();
  });

  test("serializes mutations for the same session", async () => {
    const actions: string[] = [];
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const first = withSessionLock("account-a", async () => {
      actions.push("first-start");
      await blocked;
      actions.push("first-end");
    });
    const second = withSessionLock("account-a", async () => {
      actions.push("second");
    });
    await Promise.resolve();
    expect(actions).toEqual(["first-start"]);

    unblock();
    await Promise.all([first, second]);
    expect(actions).toEqual(["first-start", "first-end", "second"]);
  });

  test("releases a session lock after an operation fails", async () => {
    await expect(
      withSessionLock("account-a", async () => {
        throw new Error("expected mutation failure");
      }),
    ).rejects.toThrow("expected mutation failure");

    await expect(
      withSessionLock("account-a", async () => "next mutation"),
    ).resolves.toBe("next mutation");
  });

  test("keeps different users independent", async () => {
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const first = withSessionLock("account-a", () => blocked);
    await expect(
      withSessionLock("account-b", async () => "account-b-ready"),
    ).resolves.toBe("account-b-ready");
    unblock();
    await first;
  });
});
