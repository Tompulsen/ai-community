/** @jest-environment node */
import { jest } from "@jest/globals";
import { NextRequest, NextResponse } from "next/server";
import { GET, POST } from "../app/api/new-api/[...path]/route";
import { initializeLoginAuto } from "../app/lib/new-api/model-groups";
import { resolveWebSearchCredentials } from "../app/lib/new-api/relay";
import {
  createSession,
  readSessionById,
  SESSION_COOKIE,
} from "../app/lib/new-api/session";

const originalEnv = process.env;
const user = {
  id: 7,
  username: "fixture",
  display_name: "Fixture",
  group: "default",
  quota: 100,
  used_quota: 0,
  request_count: 0,
};
const key = (id: number, group: string, auto_groups: string[] = []) => ({
  id,
  name: `key-${id}`,
  group,
  status: 1,
  expired_time: -1,
  unlimited_quota: true,
  remain_quota: 0,
  auto_groups,
});
let keys: ReturnType<typeof key>[];
let creates: any[];
let ambiguous: "none" | "committed" | "missing";
let rejectCreate = false;
let renameFailure: "none" | "committed" | "missing";
let visible = true;
let listPageSize = 100;
let afterCreate = () => {};
let missingTokenStatus = 404;
let nextTokenId = 200;

function req(route: string, id?: string, group?: string) {
  return new NextRequest(`https://chat.test/api/new-api/${route}`, {
    method: group === undefined ? "GET" : "POST",
    headers: {
      origin: "https://chat.test",
      host: "chat.test",
      "Content-Type": "application/json",
      "X-New-Api-User": "7",
      ...(id ? { cookie: `${SESSION_COOKIE}=${id}` } : {}),
    },
    ...(group === undefined ? {} : { body: JSON.stringify({ group }) }),
  });
}
const context = (route: string) => ({
  params: Promise.resolve({ path: route.split("/") }),
});
const ok = (data?: unknown) => Response.json({ success: true, data });
async function session(selectedTokenId = 100) {
  return createSession(req("session"), NextResponse.json({}), {
    user,
    accessToken: "private-account-key",
    refreshToken: "private-refresh",
    accessExpiresAt: Date.now() / 1000 + 3600,
    selectedTokenId,
    selectedKey: `sk-secret-${selectedTokenId}`,
  });
}
const select = (id: string, group: string) =>
  POST(req("model-groups/select", id, group), context("model-groups/select"));

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    NEW_API_BASE_URL: "https://accounts.test",
    NEW_API_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    NEW_API_REDIS_URL: "",
  };
  (globalThis as any).__octopusModelGroups?.clear();
  keys = [key(100, "")];
  creates = [];
  ambiguous = "none";
  rejectCreate = false;
  renameFailure = "none";
  visible = true;
  listPageSize = 100;
  afterCreate = () => {};
  missingTokenStatus = 404;
  nextTokenId = 200;
  global.fetch = jest.fn<typeof fetch>(async (input, options) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/user/self") return ok(user);
    if (url.pathname === "/api/user/self/groups")
      return ok({
        premium: { ratio: 2 },
        economy: { ratio: 1 },
        auto: { ratio: "auto" },
      });
    if (url.pathname === "/api/token/" && options?.method === "POST") {
      const body = JSON.parse(String(options.body));
      creates.push(body);
      if (rejectCreate)
        return Response.json(
          { success: false, message: "密钥数量已达上限" },
          { status: 400 },
        );
      if (ambiguous !== "missing")
        keys.push({
          ...body,
          ...key(nextTokenId++, body.group),
          name: body.name,
        });
      afterCreate();
      if (ambiguous !== "none") throw new Error("Connection lost after POST");
      return ok();
    }
    if (url.pathname === "/api/token/" && options?.method === "PUT") {
      const body = JSON.parse(String(options.body));
      const token = keys.find((item) => item.id === body.id);
      if (!token) return Response.json({ success: false }, { status: 404 });
      if (renameFailure !== "missing") Object.assign(token, body);
      if (renameFailure !== "none")
        throw new Error("Connection lost during rename");
      return ok();
    }
    if (url.pathname === "/api/token/") {
      const items = visible ? keys : keys.filter((item) => item.id === 100);
      const offset = (Number(url.searchParams.get("p")) - 1) * listPageSize;
      return ok({
        total: items.length,
        items: items.slice(offset, offset + listPageSize),
      });
    }
    const match = /^\/api\/token\/(\d+)(\/key)?$/.exec(url.pathname);
    if (match) {
      const token = keys.find((item) => item.id === Number(match[1]));
      if (!token)
        return Response.json(
          { success: false, message: "record not found" },
          { status: missingTokenStatus },
        );
      return ok(match[2] ? { key: `secret-${token.id}` } : token);
    }
    throw new Error(`Unexpected upstream ${url.pathname}`);
  });
});
afterEach(() => {
  process.env = originalEnv;
  jest.restoreAllMocks();
});

const loginCredentials = () => ({
  user,
  accessToken: "private-login-access",
  refreshToken: "private-login-refresh",
  accessExpiresAt: Date.now() / 1000 + 3600,
  upstreamSessionId: "login-upstream-session",
});

test("login provisions and selects an unlimited permanent Auto key for an empty account", async () => {
  keys = [];
  const selected = await initializeLoginAuto(req("login"), loginCredentials());
  expect(selected).toEqual({
    selectedTokenId: 200,
    selectedKey: "sk-secret-200",
  });
  expect(keys[0]).toMatchObject({
    name: "系统创建",
    group: "auto",
    auto_groups: [],
    unlimited_quota: true,
    expired_time: -1,
  });
  expect(creates).toHaveLength(1);
});

test("simultaneous logins reuse one Auto key and deletion does not create a replacement", async () => {
  keys = [];
  const results = await Promise.all([
    initializeLoginAuto(req("login"), loginCredentials()),
    initializeLoginAuto(req("login"), loginCredentials()),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0].selectedTokenId).toBe(200);
  expect(creates).toHaveLength(1);
  keys = [];
  await expect(
    initializeLoginAuto(req("login"), loginCredentials()),
  ).rejects.toThrow();
  expect(creates).toHaveLength(1);
});

test("login does not create another key when an existing account already has keys", async () => {
  expect(await initializeLoginAuto(req("login"), loginCredentials())).toEqual(
    {},
  );
  expect(creates).toHaveLength(0);
});

test("login reconciles an ambiguous creation without issuing a second POST", async () => {
  keys = [];
  ambiguous = "committed";
  const result = await initializeLoginAuto(req("login"), loginCredentials());
  expect(result.selectedTokenId).toBe(200);
  expect(creates).toHaveLength(1);
  expect(
    (await initializeLoginAuto(req("login"), loginCredentials()))
      .selectedTokenId,
  ).toBe(200);
  expect(creates).toHaveLength(1);
});

test("login preserves an unresolved creation record when the response is lost", async () => {
  keys = [];
  ambiguous = "missing";
  await expect(
    initializeLoginAuto(req("login"), loginCredentials()),
  ).rejects.toThrow("待确认");
  await expect(
    initializeLoginAuto(req("login"), loginCredentials()),
  ).rejects.toThrow("待确认");
  expect(creates).toHaveLength(1);
});

test("login cannot provision Auto when the account has no Auto permission", async () => {
  keys = [];
  const original = jest.mocked(fetch).getMockImplementation()!;
  jest
    .mocked(fetch)
    .mockImplementation((input, options) =>
      new URL(String(input)).pathname === "/api/user/self/groups"
        ? Promise.resolve(ok({ default: { ratio: 1 } }))
        : original(input, options),
    );
  await expect(
    initializeLoginAuto(req("login"), loginCredentials()),
  ).rejects.toThrow("分组不可用");
  expect(creates).toHaveLength(0);
});

test("browsing returns groups and the selected group without any writes or secrets", async () => {
  const account = await session();
  const response = await GET(
    req("model-groups", account.id),
    context("model-groups"),
  );
  const data = await response.json();
  expect(response.status).toBe(200);
  expect(data.data.selectedGroup).toBe("");
  expect(data.data.groups.map((item: any) => item.id)).toEqual([
    "auto",
    "premium",
    "economy",
  ]);
  expect(JSON.stringify(data)).not.toMatch(/secret|private|key-100/);
  expect(creates).toHaveLength(0);
});

test("loads groups and the selected key concurrently", async () => {
  const account = await session();
  const upstream = jest.mocked(fetch).getMockImplementation()!;
  let finishGroups!: () => void;
  let tokenStarted!: () => void;
  const started = new Promise<void>((resolve) => (tokenStarted = resolve));
  jest.mocked(fetch).mockImplementation(async (input, options) => {
    const pathname = new URL(String(input)).pathname;
    if (pathname === "/api/user/self/groups")
      await new Promise<void>((resolve) => (finishGroups = resolve));
    if (pathname === "/api/token/100") tokenStarted();
    return upstream(input, options);
  });
  const pending = GET(req("model-groups", account.id), context("model-groups"));
  try {
    await started;
  } finally {
    finishGroups();
  }
  expect((await pending).status).toBe(200);
});

test("creates once, selects, reuses across devices and preserves the initial default key", async () => {
  const first = await session();
  const second = await session();
  const response = await select(first.id, "premium");
  const result = await response.json();
  expect(response.status).toBe(200);
  const id = result.data.selectedTokenId;
  expect((await readSessionById(first.id))?.selectedKey).toBe(
    `sk-secret-${id}`,
  );
  expect((await readSessionById(second.id))?.selectedTokenId).toBe(100);
  expect(creates).toHaveLength(1);
  expect(creates[0]).toMatchObject({
    group: "premium",
    unlimited_quota: true,
    expired_time: -1,
    model_limits_enabled: false,
  });
  expect(JSON.stringify(result)).not.toMatch(/secret|private/);
  expect((await select(second.id, "premium")).status).toBe(200);
  expect((await readSessionById(second.id))?.selectedTokenId).toBe(id);
  expect((await select(first.id, "")).status).toBe(200);
  expect((await readSessionById(first.id))?.selectedTokenId).toBe(100);
  expect(creates).toHaveLength(1);
});

test("concurrent sessions create one key for the same account and group", async () => {
  const a = await session();
  const b = await session();
  const responses = await Promise.all([
    select(a.id, "premium"),
    select(b.id, "premium"),
  ]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  expect(creates).toHaveLength(1);
  expect((await readSessionById(a.id))?.selectedTokenId).toBe(
    (await readSessionById(b.id))?.selectedTokenId,
  );
});

test("a late creation cannot overwrite a binding changed while it was in flight", async () => {
  const account = await session();
  afterCreate = () => {
    keys.push(key(500, "premium"));
    const bindings: Map<string, string> = (globalThis as any)
      .__octopusModelGroups;
    for (const [key, raw] of bindings)
      if (JSON.parse(raw).pendingName)
        bindings.set(key, JSON.stringify({ tokenId: 500 }));
  };
  expect((await select(account.id, "premium")).status).toBe(409);
  expect((await readSessionById(account.id))?.selectedTokenId).toBe(100);
  afterCreate = () => {};
  expect((await select(account.id, "premium")).status).toBe(200);
  expect((await readSessionById(account.id))?.selectedTokenId).toBe(500);
  expect(creates).toHaveLength(1);
});

test("recovers a committed creation after connection loss without repeating the POST", async () => {
  const account = await session();
  ambiguous = "committed";
  expect((await select(account.id, "premium")).status).toBe(200);
  expect(creates).toHaveLength(1);
});

test("unconfirmed creation stays pending across retries until the key becomes visible", async () => {
  const account = await session();
  visible = false;
  expect((await select(account.id, "premium")).status).toBe(409);
  expect((await select(account.id, "premium")).status).toBe(409);
  expect(creates).toHaveLength(1);
  visible = true;
  expect((await select(account.id, "premium")).status).toBe(200);
  expect(creates).toHaveLength(1);
});

test("a timeout before creation does not cause a second creation on retry", async () => {
  const account = await session();
  ambiguous = "missing";
  expect((await select(account.id, "premium")).status).toBe(409);
  expect((await select(account.id, "premium")).status).toBe(409);
  expect(creates).toHaveLength(1);
  // An explicit manual selection of a same-group key can repair the binding.
  keys.push(key(500, "premium"));
  const manual = await session(500);
  expect((await select(manual.id, "premium")).status).toBe(200);
  expect((await select(account.id, "premium")).status).toBe(200);
  expect((await readSessionById(account.id))?.selectedTokenId).toBe(500);
  expect(creates).toHaveLength(1);
});

test("explicit creation rejection is shown and permits a later corrected attempt", async () => {
  const account = await session();
  rejectCreate = true;
  const failed = await select(account.id, "premium");
  expect(failed.status).toBe(400);
  expect((await failed.json()).message).toBe("密钥数量已达上限");
  rejectCreate = false;
  expect((await select(account.id, "premium")).status).toBe(200);
});

test("renaming a bound key does not create or select a replacement", async () => {
  const account = await session();
  await select(account.id, "premium");
  const id = (await readSessionById(account.id))!.selectedTokenId;
  keys.find((item) => item.id === id)!.name = "renamed by user";
  await select(account.id, "");
  expect((await select(account.id, "premium")).status).toBe(200);
  expect((await readSessionById(account.id))?.selectedTokenId).toBe(id);
  expect(creates).toHaveLength(1);
});

test("new automatic keys finish with the exact system name without touching existing names", async () => {
  keys.push({ ...key(150, "premium"), name: "系统创建" });
  const account = await session();
  await select(account.id, "premium");
  const id = (await readSessionById(account.id))!.selectedTokenId;
  expect(id).not.toBe(150);
  expect(keys.find((token) => token.id === id)!.name).toBe("系统创建");
  expect(keys.find((token) => token.id === 100)!.name).toBe("key-100");
  expect(creates[0].name).toMatch(/^系统创建-[a-f0-9]{16}$/);
  expect(creates).toHaveLength(1);
});

test.each(["committed", "missing"] as const)(
  "recovers a %s rename without creating another key",
  async (failure) => {
    const account = await session();
    renameFailure = failure;
    expect((await select(account.id, "auto")).status).toBe(502);
    expect((await readSessionById(account.id))!.selectedTokenId).toBe(100);
    expect(creates).toHaveLength(1);
    renameFailure = "none";
    expect((await select(account.id, "auto")).status).toBe(200);
    const id = (await readSessionById(account.id))!.selectedTokenId;
    expect(keys.find((token) => token.id === id)!.name).toBe("系统创建");
    expect(creates).toHaveLength(1);
  },
);

test.each(["disabled", "expired", "exhausted", "moved"])(
  "%s bound keys fail without creating replacements",
  async (state) => {
    const account = await session();
    await select(account.id, "premium");
    const id = (await readSessionById(account.id))!.selectedTokenId;
    await select(account.id, "");
    const token = keys.find((item) => item.id === id)!;
    if (state === "disabled") token.status = 2;
    if (state === "expired") token.expired_time = 1;
    if (state === "exhausted") token.unlimited_quota = false;
    if (state === "moved") token.group = "economy";
    expect((await select(account.id, "premium")).status).toBe(409);
    expect(creates).toHaveLength(1);
    expect((await readSessionById(account.id))?.selectedTokenId).toBe(100);
  },
);

test.each([200, 404])(
  "explicit switching recovers a deleted binding with upstream status %s and reuses its replacement",
  async (status) => {
    const account = await session();
    await select(account.id, "premium");
    const deletedId = (await readSessionById(account.id))!.selectedTokenId;
    await select(account.id, "");
    keys = keys.filter((item) => item.id !== deletedId);
    missingTokenStatus = status;

    const results = await Promise.all([
      select(account.id, "premium"),
      select(account.id, "premium"),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(creates).toHaveLength(2);
    const selected = (await readSessionById(account.id))!.selectedTokenId;
    expect(keys.find((item) => item.id === selected)?.group).toBe("premium");
    await select(account.id, "");
    expect((await select(account.id, "premium")).status).toBe(200);
    expect(creates).toHaveLength(2);
  },
);

test("checks every page when resolving a newly created key", async () => {
  const account = await session();
  listPageSize = 1;
  keys.push(key(101, "economy"));
  expect((await select(account.id, "premium")).status).toBe(200);
  expect(
    jest.mocked(fetch).mock.calls.some(([url]) => String(url).includes("p=3")),
  ).toBe(true);
});

test.each(["admin-only", " premium"])(
  "rejects invalid group %s before creating",
  async (group) => {
    const account = await session();
    expect((await select(account.id, group)).status).toBe(400);
    expect(creates).toHaveLength(0);
  },
);

test("Auto creates a global-list key once and reuses it across sessions", async () => {
  const first = await session();
  const second = await session();
  expect((await select(first.id, "auto")).status).toBe(200);
  const tokenId = (await readSessionById(first.id))!.selectedTokenId;
  expect(keys.find((token) => token.id === tokenId)?.name).toBe("系统创建");
  expect(creates).toHaveLength(1);
  expect(creates[0]).toMatchObject({
    group: "auto",
    auto_groups: [],
    cross_group_retry: false,
  });
  expect((await select(second.id, "auto")).status).toBe(200);
  expect((await readSessionById(second.id))!.selectedTokenId).toBe(tokenId);
  expect(creates).toHaveLength(1);
});

test("Auto does not reuse or overwrite a manually selected custom combination", async () => {
  keys.push(key(150, "auto", ["premium"]));
  const account = await session(150);
  const response = await GET(
    req("model-groups", account.id),
    context("model-groups"),
  );
  expect((await response.json()).data.selectedAutoGroups).toEqual(["premium"]);
  expect((await select(account.id, "auto")).status).toBe(200);
  expect((await readSessionById(account.id))!.selectedTokenId).not.toBe(150);
  expect(keys.find((token) => token.id === 150)!.auto_groups).toEqual([
    "premium",
  ]);
  expect(creates).toHaveLength(1);
});

test("an Auto binding edited into a custom combination is not silently reused", async () => {
  const account = await session();
  await select(account.id, "auto");
  const tokenId = (await readSessionById(account.id))!.selectedTokenId;
  await select(account.id, "");
  keys.find((token) => token.id === tokenId)!.auto_groups = ["premium"];
  expect((await select(account.id, "auto")).status).toBe(409);
  expect(creates).toHaveLength(1);
});

test("Auto permission is checked before creating a key", async () => {
  const account = await session();
  const upstream = jest.mocked(fetch).getMockImplementation()!;
  jest
    .mocked(fetch)
    .mockImplementation((input, options) =>
      new URL(String(input)).pathname === "/api/user/self/groups"
        ? Promise.resolve(ok({ premium: { ratio: 2 } }))
        : upstream(input, options),
    );
  expect((await select(account.id, "auto")).status).toBe(400);
  expect(creates).toHaveLength(0);
});

test("unauthenticated group selection cannot create a key", async () => {
  expect((await select("", "premium")).status).toBe(401);
  expect(creates).toHaveLength(0);
});

test("search uses the existing system Auto key without changing chat selection", async () => {
  keys.push({ ...key(150, "auto"), name: "系统创建" });
  keys.push(key(151, "auto"));
  const account = await session(151);
  const before = await readSessionById(account.id);
  const credentials = await resolveWebSearchCredentials(
    req("search", account.id),
  );
  expect(credentials).toEqual({
    baseUrl: "https://accounts.test",
    apiKey: "sk-secret-150",
  });
  expect(await readSessionById(account.id)).toEqual(before);
  expect(creates).toHaveLength(0);
  expect((await select(account.id, "premium")).status).toBe(200);
  const switched = await readSessionById(account.id);
  expect(await resolveWebSearchCredentials(req("search", account.id))).toEqual(
    credentials,
  );
  expect(await readSessionById(account.id)).toEqual(switched);
  expect(creates).toHaveLength(1); // Only the explicitly selected chat group created a key.
});

test.each(["disabled", "expired", "quota", "edited"])(
  "a %s bound search key is never replaced or silently bypassed",
  async (reason) => {
    keys.push({ ...key(150, "auto"), name: "系统创建" });
    const account = await session();
    await resolveWebSearchCredentials(req("search", account.id));
    const system = keys.find((token) => token.id === 150)!;
    if (reason === "disabled") system.status = 2;
    if (reason === "expired") system.expired_time = 1;
    if (reason === "quota") {
      system.unlimited_quota = false;
      system.remain_quota = 0;
    }
    if (reason === "edited") system.auto_groups = ["premium"];
    keys.push({ ...key(160, "auto"), name: "系统创建" });
    await expect(
      resolveWebSearchCredentials(req("search", account.id)),
    ).rejects.toMatchObject({ status: 409 });
    expect(creates).toHaveLength(0);
    expect((await readSessionById(account.id))?.selectedTokenId).toBe(100);
  },
);

test.each([2])(
  "search refuses %s matching system keys without creating or changing any key",
  async (count) => {
    for (let index = 0; index < count; index++)
      keys.push({ ...key(150 + index, "auto"), name: "系统创建" });
    const account = await session();
    await expect(
      resolveWebSearchCredentials(req("search", account.id)),
    ).rejects.toMatchObject({ status: 409 });
    expect(creates).toHaveLength(0);
  },
);

test("search cannot bypass Auto group permissions", async () => {
  keys.push({ ...key(150, "auto"), name: "系统创建" });
  const account = await session();
  const original = jest.mocked(fetch).getMockImplementation()!;
  jest
    .mocked(fetch)
    .mockImplementation((input, options) =>
      new URL(String(input)).pathname === "/api/user/self/groups"
        ? Promise.resolve(ok({ premium: { ratio: 2 } }))
        : original(input, options),
    );
  await expect(
    resolveWebSearchCredentials(req("search", account.id)),
  ).rejects.toMatchObject({ status: 400 });
  expect(creates).toHaveLength(0);
});

test.each([200, 404])(
  "search recreates a deleted system key once across sessions with missing-token status %s",
  async (status) => {
    missingTokenStatus = status;
    keys.push({ ...key(150, "auto"), name: "系统创建" });
    const first = await session();
    const second = await session();
    await resolveWebSearchCredentials(req("search", first.id));
    keys = keys.filter((token) => token.id !== 150);
    const results = await Promise.all([
      resolveWebSearchCredentials(req("search", first.id)),
      resolveWebSearchCredentials(req("search", second.id)),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].apiKey).not.toBe("sk-secret-150");
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({
      group: "auto",
      auto_groups: [],
      cross_group_retry: false,
    });
    expect((await readSessionById(first.id))?.selectedTokenId).toBe(100);
    expect((await readSessionById(second.id))?.selectedTokenId).toBe(100);
  },
);

test("search provisions a missing system key and never repeats an ambiguous creation", async () => {
  const account = await session();
  ambiguous = "committed";
  const credentials = await resolveWebSearchCredentials(
    req("search", account.id),
  );
  expect(creates).toHaveLength(1);
  expect(await resolveWebSearchCredentials(req("search", account.id))).toEqual(
    credentials,
  );
  expect(creates).toHaveLength(1);
});

test("search waits for an uncertain creation without issuing duplicate POSTs", async () => {
  const account = await session();
  ambiguous = "missing";
  await expect(
    resolveWebSearchCredentials(req("search", account.id)),
  ).rejects.toThrow("待确认");
  await expect(
    resolveWebSearchCredentials(req("search", account.id)),
  ).rejects.toThrow("待确认");
  expect(creates).toHaveLength(1);
});

test("search provisioning and later Auto chat selection reuse one system key", async () => {
  const account = await session();
  const credentials = await resolveWebSearchCredentials(
    req("search", account.id),
  );
  expect(creates).toHaveLength(1);
  expect((await select(account.id, "auto")).status).toBe(200);
  expect((await readSessionById(account.id))?.selectedKey).toBe(
    credentials.apiKey,
  );
  expect(creates).toHaveLength(1);
});

test("Auto chat provisioning and later search reuse one system key", async () => {
  const account = await session();
  expect((await select(account.id, "auto")).status).toBe(200);
  const chat = await readSessionById(account.id);
  expect(
    (await resolveWebSearchCredentials(req("search", account.id))).apiKey,
  ).toBe(chat?.selectedKey);
  expect(await readSessionById(account.id)).toEqual(chat);
  expect(creates).toHaveLength(1);
});

test("search replacement repairs only the matching deleted chat binding", async () => {
  const account = await session();
  await select(account.id, "auto");
  const oldId = (await readSessionById(account.id))!.selectedTokenId;
  await resolveWebSearchCredentials(req("search", account.id));
  await select(account.id, "premium");
  keys = keys.filter((token) => token.id !== oldId);
  const replacement = await resolveWebSearchCredentials(
    req("search", account.id),
  );
  const count = creates.length;
  expect((await select(account.id, "auto")).status).toBe(200);
  expect((await readSessionById(account.id))?.selectedKey).toBe(
    replacement.apiKey,
  );
  expect(creates).toHaveLength(count);
});

test.each(["committed", "missing"] as const)(
  "search replacement survives a %s rename failure and repairs the Auto binding",
  async (failure) => {
    const account = await session();
    await select(account.id, "auto");
    const oldId = (await readSessionById(account.id))!.selectedTokenId;
    await resolveWebSearchCredentials(req("search", account.id));
    await select(account.id, "premium");
    keys = keys.filter((token) => token.id !== oldId);
    renameFailure = failure;
    await expect(
      resolveWebSearchCredentials(req("search", account.id)),
    ).rejects.toThrow();
    renameFailure = "none";
    const count = creates.length;
    const credentials = await resolveWebSearchCredentials(
      req("search", account.id),
    );
    expect((await select(account.id, "auto")).status).toBe(200);
    expect((await readSessionById(account.id))?.selectedKey).toBe(
      credentials.apiKey,
    );
    expect(creates).toHaveLength(count);
  },
);
