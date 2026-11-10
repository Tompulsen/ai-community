/** @jest-environment node */
import { jest } from "@jest/globals";
import { NextRequest } from "next/server";
import { GET } from "../app/api/ai-daily/route";
import {
  dailyIndexSchema,
  loadDailyIndex,
  loadDailyReport,
} from "../app/utils/ai-daily";
import { dailyFreshness } from "../app/utils/ai-daily-cache";

const originalFetch = global.fetch;
const fetchMock = jest.fn<typeof fetch>();
let now = Math.floor(Date.now() / 1000) * 1000;
const entry = {
  date: "2026-10-27",
  leadTitle: "模型动态",
  leadParagraph: "当期导语",
  links: { aihot: "https://aihot.news/daily/2026-10-27" },
};

beforeEach(() => {
  now += 600_000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  global.fetch = fetchMock;
  fetchMock.mockReset();
});
afterEach(() => {
  jest.restoreAllMocks();
  Reflect.deleteProperty(globalThis, "sessionStorage");
});
afterAll(() => {
  global.fetch = originalFetch;
});

test("failed index requests can retry; successful requests deduplicate and cache", async () => {
  fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
  await expect(loadDailyIndex()).rejects.toThrow("暂时无法读取");
  fetchMock.mockResolvedValueOnce(
    Response.json({
      schemaVersion: 1,
      items: [{ ...entry, date: "2026-10-26" }, entry, entry],
    }),
  );
  const [first, second] = await Promise.all([
    loadDailyIndex(),
    loadDailyIndex(),
  ]);
  expect(first.map((item) => item.date)).toEqual(["2026-10-27", "2026-10-26"]);
  expect(second).toEqual(first);
  await expect(loadDailyIndex()).resolves.toEqual(first);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/studio/api/ai-daily",
    expect.objectContaining({
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }),
  );
});

test("daily links reject script URLs and unexpected provider domains", () => {
  for (const aihot of ["javascript:alert(1)", "https://example.com/daily"]) {
    expect(() =>
      dailyIndexSchema.parse({
        schemaVersion: 1,
        items: [{ ...entry, links: { aihot } }],
      }),
    ).toThrow();
  }
});

test("reports validate dates, permit empty issues and never cache a mismatched issue", async () => {
  await expect(loadDailyReport("../../items")).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
  const report = {
    date: "2026-10-26",
    links: entry.links,
    lead: null,
    sections: [],
    flashes: [],
  };
  fetchMock.mockResolvedValueOnce(Response.json({ schemaVersion: 1, report }));
  await expect(loadDailyReport(entry.date)).rejects.toThrow("日期不匹配");
  fetchMock.mockResolvedValueOnce(
    Response.json({
      schemaVersion: 1,
      report: { ...report, date: entry.date },
    }),
  );
  await expect(loadDailyReport(entry.date)).resolves.toMatchObject({
    date: entry.date,
    sections: [],
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("daily endpoint rejects invalid calendar dates and arbitrary paths", async () => {
  for (const date of ["2026-02-30", "../../items", "https://example.com"]) {
    const response = await GET(
      new NextRequest(
        "https://chat.example.test/api/ai-daily?date=" +
          encodeURIComponent(date),
      ),
    );
    expect(response.status).toBe(400);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

test("daily endpoint preserves provider attribution without forwarding user credentials", async () => {
  const payload = {
    schemaVersion: 1,
    items: [entry],
    notice: { message: "服务说明" },
  };
  fetchMock.mockResolvedValueOnce(Response.json(payload));
  const response = await GET(
    new NextRequest("https://chat.example.test/api/ai-daily", {
      headers: {
        authorization: "Bearer private-token",
        cookie: "session=private-session",
      },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(payload);
  expect(response.headers.get("cache-control")).toContain("max-age=60");
  expect(fetchMock).toHaveBeenCalledWith(
    "https://aihot.news/api/v1/dailies?limit=7",
    expect.objectContaining({
      headers: { Accept: "application/json", "User-Agent": "aihot-api/2.0.0" },
      redirect: "error",
      cache: "no-store",
    }),
  );
});

const reportPayload = (date: string) => ({
  schemaVersion: 1,
  report: { date, links: entry.links, lead: null, sections: [] },
});
const dailyRequest = (date: string, etag?: string) =>
  new NextRequest("https://chat.example.test/api/ai-daily?date=" + date, {
    headers: etag ? { "If-None-Match": etag } : {},
  });

test("freshness accounts for provider age and rejects private or stale responses", () => {
  expect(
    dailyFreshness(
      new Headers({ "Cache-Control": "public, max-age=300", Age: "120" }),
    ),
  ).toBe(180);
  expect(
    dailyFreshness(
      new Headers({
        "Cache-Control": "public, max-age=300",
        Date: new Date(now - 200_000).toUTCString(),
        Age: "120",
      }),
    ),
  ).toBe(100);
  for (const control of ["private, max-age=300", "no-store", "no-cache"]) {
    expect(dailyFreshness(new Headers({ "Cache-Control": control }))).toBe(0);
  }
  expect(
    dailyFreshness(new Headers({ "Cache-Control": "max-age=60", Age: "90" })),
  ).toBe(0);
});

test("server deduplicates reads, retains report freshness and returns bodyless 304", async () => {
  const date = "2026-10-21";
  fetchMock.mockResolvedValueOnce(
    Response.json(reportPayload(date), {
      headers: { "Cache-Control": "public, max-age=300", Age: "100" },
    }),
  );
  const [first, second] = await Promise.all([
    GET(dailyRequest(date)),
    GET(dailyRequest(date)),
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await first.json()).toEqual(await second.json());
  expect(first.headers.get("cache-control")).toContain("max-age=200");
  now += 10_000;
  const unchanged = await GET(
    dailyRequest(date, "W/" + first.headers.get("etag")!),
  );
  expect(unchanged.status).toBe(304);
  expect(await unchanged.text()).toBe("");
  expect(unchanged.headers.get("cache-control")).toContain("max-age=190");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("expired reports revalidate upstream and inherit policy on 304", async () => {
  const date = "2026-10-20";
  fetchMock.mockResolvedValueOnce(
    Response.json(reportPayload(date), {
      headers: { "Cache-Control": "public, max-age=60", ETag: 'W/"daily-v1"' },
    }),
  );
  await GET(dailyRequest(date));
  now += 61_000;
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
  const response = await GET(dailyRequest(date));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(reportPayload(date));
  expect(response.headers.get("cache-control")).toContain("max-age=60");
  expect(fetchMock).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({
      headers: expect.objectContaining({ "If-None-Match": 'W/"daily-v1"' }),
    }),
  );
});

test("expired reports never fall back to stale content and 429 preserves retry delay", async () => {
  const date = "2026-10-19";
  fetchMock.mockResolvedValueOnce(
    Response.json(reportPayload(date), {
      headers: { "Cache-Control": "public, max-age=60" },
    }),
  );
  await GET(dailyRequest(date));
  now += 61_000;
  fetchMock.mockResolvedValueOnce(
    new Response(null, { status: 429, headers: { "Retry-After": "30" } }),
  );
  const response = await GET(dailyRequest(date));
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("30");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).not.toContain('"report"');
});

test("provider no-store prevents server reuse", async () => {
  const date = "2026-10-18";
  fetchMock.mockImplementation(async () =>
    Response.json(reportPayload(date), {
      headers: { "Cache-Control": "no-store" },
    }),
  );
  await GET(dailyRequest(date));
  await GET(dailyRequest(date));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("browser reuses validated session data across module reload without extending freshness", async () => {
  const date = "2026-10-17";
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  fetchMock.mockResolvedValueOnce(
    Response.json(reportPayload(date), {
      headers: { "Cache-Control": "max-age=300", Age: "290" },
    }),
  );
  await loadDailyReport(date);
  let reloaded: typeof import("../app/utils/ai-daily");
  await jest.isolateModulesAsync(async () => {
    reloaded = await import("../app/utils/ai-daily");
  });
  await expect(reloaded!.loadDailyReport(date)).resolves.toMatchObject({
    date,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  now += 11_000;
  fetchMock.mockResolvedValueOnce(Response.json(reportPayload(date)));
  await reloaded!.loadDailyReport(date);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("invalid stored reports and unavailable storage do not block a fresh read", async () => {
  const date = "2026-10-16";
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: () =>
        JSON.stringify([
          ["?date=" + date, { expires: now + 60_000, value: {}, etag: null }],
        ]),
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    },
  });
  fetchMock.mockResolvedValueOnce(Response.json(reportPayload(date)));
  await expect(loadDailyReport(date)).resolves.toMatchObject({ date });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("browser revalidates an expired response with its ETag and accepts 304", async () => {
  const date = "2026-10-15";
  fetchMock.mockResolvedValueOnce(
    Response.json(reportPayload(date), {
      headers: { "Cache-Control": "max-age=60", ETag: '"browser-report"' },
    }),
  );
  await loadDailyReport(date);
  now += 61_000;
  fetchMock.mockResolvedValueOnce(
    new Response(null, {
      status: 304,
      headers: { "Cache-Control": "max-age=300", ETag: '"browser-report"' },
    }),
  );
  await expect(loadDailyReport(date)).resolves.toMatchObject({ date });
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/studio/api/ai-daily?date=" + date,
    expect.objectContaining({
      headers: { "If-None-Match": '"browser-report"' },
    }),
  );
  await loadDailyReport(date);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("daily endpoint does not cache upstream failure or expose internal errors", async () => {
  fetchMock.mockResolvedValueOnce(new Response("", { status: 429 }));
  const response = await GET(
    new NextRequest("https://chat.example.test/api/ai-daily"),
  );
  expect(response.status).toBe(429);
  expect(response.headers.get("cache-control")).toBe("no-store");
  fetchMock.mockRejectedValueOnce(
    new Error("sensitive infrastructure details"),
  );
  const failed = await GET(
    new NextRequest("https://chat.example.test/api/ai-daily"),
  );
  expect(failed.status).toBe(502);
  expect(await failed.text()).not.toContain("sensitive");
});
