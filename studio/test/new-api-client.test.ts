/** @jest-environment node */

import { jest } from "@jest/globals";
import {
  constants,
  createDecipheriv,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  assertSameOrigin,
  getAuthenticatedSession,
  loginCredentials,
  publicSession,
} from "../app/lib/new-api/client";
import {
  SESSION_COOKIE,
  createSession,
  readSessionById,
  saveSession,
} from "../app/lib/new-api/session";

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
  accessToken: "old-access-token-a",
  accessExpiresAt: 1,
  refreshToken: "old-refresh-token-a",
  upstreamSessionId: "upstream-session-a",
  selectedTokenId: 23,
  selectedKey: "sk-relay-a",
};

function request(id?: string, extraHeaders?: HeadersInit) {
  const headers = new Headers({
    host: "chat.example.test",
    origin: "https://chat.example.test",
  });
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  if (id) headers.set("cookie", `${SESSION_COOKIE}=${id}`);
  return new NextRequest("https://chat.example.test/api/account", {
    method: "POST",
    headers,
  });
}

function refreshedResponse(overrideUser = user) {
  return Response.json(
    {
      success: true,
      data: {
        access_token: "rotated-access-token-a",
        access_expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: overrideUser,
        session: { sid: "rotated-upstream-session-a" },
      },
    },
    {
      headers: {
        "set-cookie":
          "new_api_refresh=rotated-refresh-token-a; Path=/api/user/auth; HttpOnly; Secure",
      },
    },
  );
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    NEW_API_BASE_URL: "https://accounts.example.test",
    NEW_API_PUBLIC_URL: "https://accounts.example.test",
    NEW_API_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    NEW_API_REDIS_URL: "",
  };
  global.fetch = jest.fn<typeof fetch>();
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env = originalEnv;
});

describe("New API authenticated account sessions", () => {
  test("produces a decryptable v2 encrypted password without a plaintext field", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    jest.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        success: true,
        data: {
          enabled: true,
          kid: "test-encryption-key",
          public_key: publicKey.export({ type: "spki", format: "pem" }),
        },
      }),
    );
    const encrypted = await loginCredentials(
      "account-a",
      "private-password",
      true,
    );

    expect(encrypted).not.toHaveProperty("password");
    expect(encrypted).toMatchObject({
      username: "account-a",
      encryption_key_id: "test-encryption-key",
    });
    if (
      !("password_encrypted" in encrypted) ||
      typeof encrypted.password_encrypted !== "string"
    ) {
      throw new Error("Expected encrypted login credentials");
    }
    const [version, wrapped, iv, ciphertext] =
      encrypted.password_encrypted.split(".");
    expect(version).toBe("v2");
    const secret = privateDecrypt(
      {
        key: privateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
        oaepLabel: Buffer.from("password-v2"),
      },
      Buffer.from(wrapped, "base64"),
    );
    const data = Buffer.from(ciphertext, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      secret,
      Buffer.from(iv, "base64"),
    );
    decipher.setAAD(Buffer.from("password-v2:test-encryption-key"));
    decipher.setAuthTag(data.subarray(-16));
    const password = Buffer.concat([
      decipher.update(data.subarray(0, -16)),
      decipher.final(),
    ]).toString("utf8");
    expect(password).toBe("private-password");
  });

  test("requires login before making an upstream request", async () => {
    await expect(getAuthenticatedSession(request())).rejects.toMatchObject({
      status: 401,
      code: "NEW_API_LOGIN_REQUIRED",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("never treats an incomplete MFA flow as an authenticated account", async () => {
    const created = await createSession(request(), NextResponse.json({}), {
      flowToken: "uncompleted-mfa-flow",
      flowExpiresAt: Math.floor(Date.now() / 1000) + 300,
    });

    await expect(
      getAuthenticatedSession(request(created.id)),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("reuses a valid account session without refreshing credentials", async () => {
    const created = await createSession(request(), NextResponse.json({}), {
      ...credentials,
      accessExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    expect(
      (await getAuthenticatedSession(request(created.id))).session,
    ).toEqual(created.session);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("accepts the expected account ID without changing a valid session", async () => {
    const created = await createSession(request(), NextResponse.json({}), {
      ...credentials,
      accessExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    const authenticated = await getAuthenticatedSession(
      request(created.id, { "x-new-api-user": String(user.id) }),
    );

    expect(authenticated.session).toEqual(created.session);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("model proxies reuse only one Request snapshot while account mutations read afresh", async () => {
    const created = await createSession(request(), NextResponse.json({}), {
      ...credentials,
      accessExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    const req = request(created.id);
    const first = getAuthenticatedSession(req, true);
    const second = getAuthenticatedSession(req, true);
    expect(second).toBe(first);
    expect((await first).session.selectedTokenId).toBe(23);
    await saveSession(created.id, {
      ...created.session,
      selectedTokenId: 24,
      selectedKey: "sk-other-key",
      version: created.session.version + 1,
    });
    expect((await getAuthenticatedSession(req)).session.selectedTokenId).toBe(
      24,
    );
    expect(
      (await getAuthenticatedSession(request(created.id), true)).session
        .selectedTokenId,
    ).toBe(24);
  });

  test.each(["29", "0", "017", "17.0", "not-a-user"])(
    "rejects stale or invalid account expectation %s before refreshing and preserves the current session",
    async (expectedUser) => {
      const created = await createSession(
        request(),
        NextResponse.json({}),
        credentials,
      );

      await expect(
        getAuthenticatedSession(
          request(created.id, { "x-new-api-user": expectedUser }),
        ),
      ).rejects.toMatchObject({
        status: 409,
        code: "NEW_API_ACCOUNT_CHANGED",
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(await readSessionById(created.id)).toEqual(created.session);
    },
  );

  test("refreshes a rotating credential only once for simultaneous requests", async () => {
    const created = await createSession(
      request(),
      NextResponse.json({}),
      credentials,
    );
    jest.mocked(fetch).mockResolvedValueOnce(refreshedResponse());

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        getAuthenticatedSession(request(created.id)),
      ),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = jest.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://accounts.example.test/api/user/auth/refresh");
    expect(options?.method).toBe("POST");
    const headers = new Headers(options?.headers);
    expect(headers.get("cookie")).toBe("new_api_refresh=old-refresh-token-a");
    expect(headers.get("x-auth-session")).toBe("upstream-session-a");
    for (const { session } of results) {
      expect(session.accessToken).toBe("rotated-access-token-a");
      expect(session.refreshToken).toBe("rotated-refresh-token-a");
      expect(session.selectedKey).toBe("sk-relay-a");
      expect(session.version).toBe(created.session.version + 1);
    }
    expect((await readSessionById(created.id))?.refreshToken).toBe(
      "rotated-refresh-token-a",
    );
  });

  test("invalidates a session when refresh returns another user's identity", async () => {
    const created = await createSession(
      request(),
      NextResponse.json({}),
      credentials,
    );
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(refreshedResponse({ ...user, id: 99 }));

    await expect(
      getAuthenticatedSession(request(created.id)),
    ).rejects.toMatchObject({ status: 401 });
    expect(await readSessionById(created.id)).toBeNull();
  });

  test("removes invalid refresh credentials after an upstream 401", async () => {
    const created = await createSession(
      request(),
      NextResponse.json({}),
      credentials,
    );
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        Response.json(
          { success: false, message: "Refresh session expired" },
          { status: 401 },
        ),
      );

    await expect(
      getAuthenticatedSession(request(created.id)),
    ).rejects.toMatchObject({ status: 401 });
    expect(await readSessionById(created.id)).toBeNull();
  });

  test("preserves a session after a temporary upstream network failure", async () => {
    const created = await createSession(
      request(),
      NextResponse.json({}),
      credentials,
    );
    jest.mocked(fetch).mockRejectedValueOnce(new Error("Network unavailable"));

    await expect(
      getAuthenticatedSession(request(created.id)),
    ).rejects.toMatchObject({ status: 502 });
    expect((await readSessionById(created.id))?.refreshToken).toBe(
      credentials.refreshToken,
    );
  });

  test("public account data never includes login or model credentials", async () => {
    const created = await createSession(
      request(),
      NextResponse.json({}),
      credentials,
    );
    const publicData = publicSession(created.session);

    expect(publicData).toEqual({
      authenticated: true,
      user,
      selectedTokenId: credentials.selectedTokenId,
    });
    const json = JSON.stringify(publicData);
    for (const secret of [
      credentials.accessToken,
      credentials.refreshToken,
      credentials.selectedKey,
      credentials.upstreamSessionId,
    ]) {
      expect(json).not.toContain(secret);
    }
  });
});

describe("New API browser mutation origin checks", () => {
  test("accepts a same-origin browser request", () => {
    expect(() => assertSameOrigin(request())).not.toThrow();
  });

  test("rejects absent, opaque, and unrelated origins", () => {
    for (const origin of [
      "",
      "null",
      "https://attacker.example.test",
      "https://chat.example.test.attacker.test",
      "https://chat.example.test:8443",
    ]) {
      expect(() => assertSameOrigin(request(undefined, { origin }))).toThrow(
        expect.objectContaining({ status: 403, code: "NEW_API_CSRF" }),
      );
    }
  });

  test("rejects cross-site Fetch Metadata even when the Origin header matches", () => {
    expect(() =>
      assertSameOrigin(request(undefined, { "sec-fetch-site": "cross-site" })),
    ).toThrow(expect.objectContaining({ status: 403, code: "NEW_API_CSRF" }));
  });
});
