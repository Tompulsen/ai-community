import { z } from "zod";
import { dailyFreshness } from "./ai-daily-cache";

const API = "/studio/api/ai-daily";
const STORAGE_KEY = "octopus:ai-daily:v1";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const webUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.port
    );
  });
const aihotUrl = webUrl.refine(
  (value) => new URL(value).hostname === "aihot.news",
);
const attribution = z.object({ name: z.string(), url: webUrl }).optional();
const links = z.object({
  aihot: aihotUrl,
  original: webUrl.optional(),
});
const item = z.object({
  title: z.string(),
  summary: z.string().nullish(),
  source: z.object({ name: z.string() }),
  links,
  publishedAt: z.string().nullish(),
  attribution,
});
export const dailyIndexSchema = z.object({
  schemaVersion: z.literal(1),
  items: z.array(
    z.object({
      date,
      leadTitle: z.string().nullable(),
      leadParagraph: z.string().nullable(),
      links: z.object({ aihot: aihotUrl }),
      attribution,
    }),
  ),
});
export const dailyReportSchema = z.object({
  schemaVersion: z.literal(1),
  report: z.object({
    date,
    links: z.object({ aihot: aihotUrl }),
    attribution,
    lead: z
      .object({
        title: z.string().nullable(),
        leadParagraph: z.string().nullable(),
      })
      .nullable(),
    sections: z.array(z.object({ label: z.string(), items: z.array(item) })),
    flashes: z.array(item).optional(),
  }),
});
export type DailyEntry = z.infer<typeof dailyIndexSchema>["items"][number];
export type DailyReport = z.infer<typeof dailyReportSchema>["report"];

type CachedDaily = { expires: number; value: unknown; etag: string | null };
const cache = new Map<string, CachedDaily>();
const pending = new Map<string, Promise<unknown>>();

function restore(path: string, schema: z.ZodType): CachedDaily | undefined {
  try {
    if (typeof sessionStorage === "undefined") return;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw || raw.length > 512_000) return;
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries) || entries.length > 16) return;
    const pair = entries.find(
      (item) => Array.isArray(item) && item[0] === path,
    );
    const entry = pair?.[1];
    if (
      !entry ||
      !Number.isFinite(entry.expires) ||
      entry.expires <= Date.now() ||
      entry.expires > Date.now() + 300_000 ||
      !(entry.etag === null || typeof entry.etag === "string")
    ) {
      return;
    }
    return { ...entry, value: schema.parse(entry.value) };
  } catch {
    // Storage can be unavailable in private browsing or when its quota is full.
    return;
  }
}

function remember(path: string, entry: CachedDaily) {
  for (const [key, saved] of cache) {
    if (saved.expires <= Date.now()) cache.delete(key);
  }
  cache.delete(path);
  if (entry.expires > Date.now()) {
    if (cache.size >= 16) cache.delete(cache.keys().next().value!);
    cache.set(path, entry);
  }
  try {
    if (typeof sessionStorage === "undefined") return;
    const serialized = JSON.stringify(Array.from(cache));
    if (serialized.length <= 512_000) {
      sessionStorage.setItem(STORAGE_KEY, serialized);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Reading the report must not depend on browser storage.
  }
}

async function read<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const saved = cache.get(path) ?? restore(path, schema);
  if (saved && !cache.has(path)) cache.set(path, saved);
  if (saved && saved.expires > Date.now()) return saved.value as T;
  if (pending.has(path)) return pending.get(path) as Promise<T>;
  const request = (async () => {
    const response = await fetch(API + path, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: saved?.etag ? { "If-None-Match": saved.etag } : {},
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok && !(response.status === 304 && saved)) {
      throw new Error(
        response.status === 429
          ? "日报服务繁忙，请稍后再试"
          : "日报暂时无法读取，请稍后重试",
      );
    }
    const value = schema.parse(
      response.status === 304 && saved ? saved.value : await response.json(),
    );
    remember(path, {
      expires: Date.now() + dailyFreshness(response.headers) * 1000,
      etag: response.headers.get("etag"),
      value,
    });
    return value;
  })();
  pending.set(path, request);
  try {
    return await request;
  } finally {
    pending.delete(path);
  }
}

export async function loadDailyIndex() {
  const result = await read("", dailyIndexSchema);
  return Array.from(
    new Map(result.items.map((entry) => [entry.date, entry])).values(),
  )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);
}

export async function loadDailyReport(value: string) {
  const requested = date.parse(value);
  const path = "?date=" + requested;
  const result = await read(
    path,
    dailyReportSchema.refine((data) => data.report.date === requested, {
      message: "日报日期不匹配，请稍后重试",
    }),
  );
  return result.report;
}
