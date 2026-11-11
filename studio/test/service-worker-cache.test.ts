/** @jest-environment node */
import { jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";

const origin = "https://audit.example";

function worker() {
  const stores = new Map<string, Map<string, Response>>();
  const handlers = new Map<string, (event: any) => void>();
  const key = (request: Request | string) =>
    typeof request === "string" ? new URL(request, origin).href : request.url;
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name)!;
    return {
      keys: async () => [...entries.keys()].map((url) => new Request(url)),
      put: async (request: Request | string, response: Response) => {
        entries.set(key(request), response.clone());
      },
      match: async (request: Request | string) =>
        entries.get(key(request))?.clone(),
      delete: async (request: Request | string) => entries.delete(key(request)),
      addAll: async (requests: string[]) => {
        for (const request of requests) {
          entries.set(key(request), new Response(`precache:${request}`));
        }
      },
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: Request | string) => {
      for (const entries of stores.values()) {
        const response = entries.get(key(request));
        if (response) return response.clone();
      }
    },
  };
  const fetch = jest.fn<typeof globalThis.fetch>();
  const claim = jest.fn(async () => {
    expect(stores.has("octopus-runtime-v4")).toBe(false);
  });
  runInNewContext(readFileSync(resolve("public/serviceWorker.js"), "utf8"), {
    self: {
      location: new URL(origin),
      addEventListener: (name: string, handler: (event: any) => void) =>
        handlers.set(name, handler),
      clients: { claim },
      skipWaiting() {},
    },
    caches,
    fetch,
    Request,
    Response,
    URL,
    crypto: webcrypto,
    Uint8Array,
    console: { log() {}, warn() {} },
  });
  const dispatch = async (request: Request) => {
    let response: Promise<Response | undefined> | undefined;
    const pending: Promise<unknown>[] = [];
    handlers.get("fetch")!({
      request,
      respondWith(value: Promise<Response | undefined>) {
        response = value;
      },
      waitUntil(value: Promise<unknown>) {
        pending.push(value);
      },
    });
    const result = response ? await response : undefined;
    while (pending.length) await Promise.all(pending.splice(0));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    return { intercepted: response !== undefined, response: result };
  };
  return { stores, caches, fetch, handlers, claim, dispatch };
}

test.each(["/api/new-api/bootstrap", "/api/new-api/session", "/api/config"])(
  "never intercepts API navigation or HTML-accept requests: %s",
  async (pathname) => {
    const sw = worker();
    const cache = await sw.caches.open("octopus-runtime-v5");
    await cache.put(origin + pathname, Response.json({ user: { id: 7 } }));
    for (const options of [
      { mode: "navigate" },
      { mode: "cors", headers: new Headers({ Accept: "text/html" }) },
    ]) {
      const request = {
        url: origin + pathname,
        method: "GET",
        ...options,
      } as Request;
      expect((await sw.dispatch(request)).intercepted).toBe(false);
    }
    expect(sw.fetch).not.toHaveBeenCalled();
  },
);

test("installation keeps UI and install icons available offline", async () => {
  const sw = worker();
  let complete!: Promise<unknown>;
  sw.handlers.get("install")!({
    waitUntil(value: Promise<unknown>) {
      complete = value;
    },
  });
  await complete;
  sw.fetch.mockRejectedValue(new Error("offline"));
  for (const pathname of [
    "/ui-logo-64.png",
    "/ui-logo-128.png",
    "/ui-logo-192.png",
    "/macos.png",
    "/apple-touch-icon.png",
    "/android-chrome-192x192.png",
    "/android-chrome-512x512.png",
  ]) {
    const result = await sw.dispatch(new Request(origin + pathname));
    expect(await result.response!.text()).toBe(`precache:${pathname}`);
  }
  expect(sw.fetch).not.toHaveBeenCalled();
});

test("activation removes old page caches and stray API entries while preserving attachments", async () => {
  const sw = worker();
  const old = await sw.caches.open("octopus-runtime-v4");
  await old.put(origin + "/api/new-api/session", Response.json({ user: 7 }));
  const retained = await sw.caches.open("octopus-static-v5");
  await retained.put(
    origin + "/api/new-api/bootstrap",
    Response.json({ user: 7 }),
  );
  await retained.put(origin + "/macos.png", new Response("icon"));
  const legacy = await sw.caches.open("chatgpt-next-web-cache");
  await legacy.put(origin + "/api/new-api/session", Response.json({ user: 7 }));
  await legacy.put(
    origin + "/api/cache/legacy.png",
    new Response("legacy image"),
  );
  const files = await sw.caches.open("chatgpt-next-web-file");
  await files.put(origin + "/api/cache/file.png", new Response("image"));
  let complete!: Promise<unknown>;
  sw.handlers.get("activate")!({
    waitUntil(value: Promise<unknown>) {
      complete = value;
    },
  });
  await complete;
  expect(sw.claim).toHaveBeenCalledTimes(1);
  expect(sw.stores.has("octopus-runtime-v4")).toBe(false);
  expect(
    await retained.match(origin + "/api/new-api/bootstrap"),
  ).toBeUndefined();
  expect(await legacy.match(origin + "/api/new-api/session")).toBeUndefined();
  expect(await (await retained.match(origin + "/macos.png"))!.text()).toBe(
    "icon",
  );
  for (const name of ["legacy", "file"]) {
    const result = await sw.dispatch(
      new Request(origin + `/api/cache/${name}.png`),
    );
    expect(await result.response!.text()).toBe(
      name === "legacy" ? "legacy image" : "image",
    );
  }
});

test.each(["private", "no-store", "public, max-age=0, private", "No-Store"])(
  "does not save private/no-store page responses: %s",
  async (directive) => {
    const sw = worker();
    sw.fetch.mockResolvedValue(
      new Response("<!doctype html><p>private</p>", {
        headers: { "Content-Type": "text/html", "Cache-Control": directive },
      }),
    );
    const result = await sw.dispatch(
      new Request(origin + "/", {
        headers: { Accept: "text/html" },
      }),
    );
    expect(result.response?.ok).toBe(true);
    expect(await sw.caches.match(origin + "/")).toBeUndefined();
  },
);

test("public pages still cache and work offline", async () => {
  const sw = worker();
  sw.fetch.mockResolvedValueOnce(
    new Response("<!doctype html><p>public</p>", {
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": "public, max-age=60",
      },
    }),
  );
  const request = new Request(origin + "/", {
    headers: { Accept: "text/html" },
  });
  await sw.dispatch(request);
  expect(await sw.caches.match(request)).toBeDefined();
  sw.fetch.mockRejectedValueOnce(new Error("offline"));
  expect(await (await sw.dispatch(request)).response!.text()).toContain(
    "public",
  );
});

test("attachment upload, read and deletion still use the local file cache", async () => {
  const sw = worker();
  const data = new FormData();
  data.append(
    "file",
    new Blob(["fixture image"], { type: "image/png" }),
    "photo.png",
  );
  const upload = await sw.dispatch(
    new Request(origin + "/api/cache", {
      method: "POST",
      body: data,
    }),
  );
  const { data: url } = await upload.response!.json();
  expect(url).toMatch(/^https:\/\/audit\.example\/api\/cache\/.+\.png$/);
  expect(await (await sw.dispatch(new Request(url))).response!.text()).toBe(
    "fixture image",
  );
  await sw.dispatch(new Request(url, { method: "DELETE" }));
  expect(await sw.caches.match(url)).toBeUndefined();
  expect(sw.fetch).not.toHaveBeenCalled();
});

test("cross-origin requests are left to the browser", async () => {
  const sw = worker();
  const request = new Request("https://other.example/api/cache/file.png");
  expect((await sw.dispatch(request)).intercepted).toBe(false);
});

test("versioned Next chunks reuse their cache without another network request", async () => {
  const sw = worker();
  sw.fetch.mockResolvedValue(
    new Response("chunk", {
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    }),
  );
  const request = new Request(origin + "/_next/static/chunks/chat-123abc.js");
  expect(await (await sw.dispatch(request)).response!.text()).toBe("chunk");
  expect(await (await sw.dispatch(request)).response!.text()).toBe("chunk");
  expect(sw.fetch).toHaveBeenCalledTimes(1);
});

test("runtime cache evicts old responses without touching local attachments", async () => {
  const sw = worker();
  const cache = await sw.caches.open("octopus-runtime-v5");
  for (let index = 0; index < 120; index++) {
    await cache.put(
      origin + `/_next/static/chunks/old-${index}.js`,
      new Response(String(index)),
    );
  }
  const files = await sw.caches.open("chatgpt-next-web-file");
  await files.put(origin + "/api/cache/original.png", new Response("original"));
  sw.fetch.mockResolvedValue(new Response("new chunk"));
  await sw.dispatch(new Request(origin + "/_next/static/chunks/new-build.js"));
  expect((await cache.keys()).length).toBe(120);
  expect(
    await cache.match(origin + "/_next/static/chunks/old-0.js"),
  ).toBeUndefined();
  expect(
    await cache.match(origin + "/_next/static/chunks/new-build.js"),
  ).toBeDefined();
  expect(
    await (await files.match(origin + "/api/cache/original.png"))!.text(),
  ).toBe("original");
});

test("cache quota failure does not fail a successful resource response", async () => {
  const sw = worker();
  const originalOpen = sw.caches.open;
  sw.caches.open = async (name) => ({
    ...(await originalOpen(name)),
    put: async () => {
      throw new Error("QuotaExceededError");
    },
  });
  sw.fetch.mockResolvedValue(new Response("usable chunk"));
  const result = await sw.dispatch(
    new Request(origin + "/_next/static/chunks/quota.js"),
  );
  expect(await result.response!.text()).toBe("usable chunk");
});
