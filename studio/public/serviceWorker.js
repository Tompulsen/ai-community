const CHATGPT_NEXT_WEB_CACHE = "chatgpt-next-web-cache";
const CHATGPT_NEXT_WEB_FILE_CACHE = "chatgpt-next-web-file";
const STATIC_CACHE = "octopus-static-v5";
const RUNTIME_CACHE = "octopus-runtime-v5";
const MAX_RUNTIME_ENTRIES = 120;
let runtimeWrites = Promise.resolve();
const IS_LOCAL_PREVIEW = ["localhost", "127.0.0.1", "[::1]"].includes(
  self.location.hostname,
);

const STATIC_ASSETS = [
  "/",
  "/site.webmanifest",
  "/macos.png",
  "/ui-logo-64.png",
  "/ui-logo-128.png",
  "/ui-logo-192.png",
  "/favicon.ico",
  "/favicon-32x32.png",
  "/favicon-16x16.png",
  "/apple-touch-icon.png",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
];

const CACHEABLE_PATTERNS = ["/_next/static/", "/icons/", "/fonts/"];

let a = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
let nanoid = (e = 21) => {
  let t = "",
    r = crypto.getRandomValues(new Uint8Array(e));
  for (let n = 0; n < e; n++) t += a[63 & r[n]];
  return t;
};
self.addEventListener("activate", function (event) {
  console.log("ServiceWorker activated.");
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter(
              (name) =>
                (IS_LOCAL_PREVIEW &&
                  (name.startsWith("octopus-static-") ||
                    name.startsWith("octopus-runtime-"))) ||
                (name.startsWith("octopus-") &&
                  name !== STATIC_CACHE &&
                  name !== RUNTIME_CACHE) ||
                name === "octopus-static-v1" ||
                name === "octopus-runtime-v1",
            )
            .map((name) => caches.delete(name)),
        )
          .then(() => caches.keys())
          .then((remainingNames) =>
            Promise.all(
              remainingNames
                .filter((name) =>
                  [
                    STATIC_CACHE,
                    RUNTIME_CACHE,
                    CHATGPT_NEXT_WEB_CACHE,
                  ].includes(name),
                )
                .map(async (name) => {
                  const cache = await caches.open(name);
                  const requests = await cache.keys();
                  await Promise.all(
                    requests
                      .filter((request) => {
                        const url = new URL(request.url);
                        return isApiUrl(url) && !isAttachmentUrl(url);
                      })
                      .map((request) => cache.delete(request)),
                  );
                }),
            ),
          );
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    Promise.all([
      IS_LOCAL_PREVIEW
        ? Promise.resolve()
        : caches
            .open(STATIC_CACHE)
            .then((cache) =>
              cache
                .addAll(STATIC_ASSETS)
                .catch((e) =>
                  console.warn("[SW] Precache partial failure:", e),
                ),
            ),
      caches.open(CHATGPT_NEXT_WEB_CACHE).then(() => {}),
      caches.open(CHATGPT_NEXT_WEB_FILE_CACHE).then(() => {}),
    ]),
  );
});
function jsonify(data) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
}

async function upload(request, url) {
  const formData = await request.formData();
  const file = formData.getAll("file")[0];
  let ext = file.name.split(".").pop();
  if (ext === "blob") {
    ext = file.type.split("/").pop();
  }
  const fileUrl = `${url.origin}/api/cache/${nanoid()}.${ext}`;
  const cache = await caches.open(CHATGPT_NEXT_WEB_FILE_CACHE);
  await cache.put(
    new Request(fileUrl),
    new Response(file, {
      headers: {
        "content-type": file.type,
        "content-length": file.size,
        "cache-control": "no-cache",
        server: "ServiceWorker",
      },
    }),
  );
  return jsonify({ code: 0, data: fileUrl });
}

async function remove(request, url) {
  const cache = await caches.open(CHATGPT_NEXT_WEB_FILE_CACHE);
  const res = await cache.delete(request.url);
  return jsonify({ code: 0 });
}

function isCacheableAsset(url) {
  return CACHEABLE_PATTERNS.some((pattern) => url.pathname.startsWith(pattern));
}
function isApiUrl(url) {
  return url.pathname === "/api" || url.pathname.startsWith("/api/");
}
function isAttachmentUrl(url) {
  return /^\/api\/cache(?:\/|$)/.test(url.pathname);
}
function canCache(response) {
  return (
    response &&
    response.ok &&
    !/(?:^|,)\s*(?:private|no-store)\b/i.test(
      response.headers.get("cache-control") || "",
    )
  );
}

function saveResponse(event, name, response) {
  const copy = response.clone();
  const write = async () => {
    const cache = await caches.open(name);
    await cache.put(event.request, copy);
    if (name === RUNTIME_CACHE) {
      const requests = await cache.keys();
      await Promise.all(
        requests
          .slice(0, Math.max(0, requests.length - MAX_RUNTIME_ENTRIES))
          .map((request) => cache.delete(request)),
      );
    }
  };
  const saving =
    name === RUNTIME_CACHE
      ? (runtimeWrites = runtimeWrites.catch(() => {}).then(write))
      : write();
  event.waitUntil(
    saving.catch((error) => console.warn("[SW] Cache write failed:", error)),
  );
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  if (isAttachmentUrl(url)) {
    if ("GET" == e.request.method) {
      e.respondWith(caches.match(e.request));
    }
    if ("POST" == e.request.method) {
      e.respondWith(upload(e.request, url));
    }
    if ("DELETE" == e.request.method) {
      e.respondWith(remove(e.request, url));
    }
    return;
  }

  // Authenticated API responses must never enter the shared page cache.
  if (isApiUrl(url)) return;

  // Development chunks keep the same URLs across edits; cached HTML and JS
  // can belong to different builds. Keep only the attachment cache locally.
  if (IS_LOCAL_PREVIEW) return;

  if (e.request.method === "GET") {
    if (
      url.pathname !== "/" &&
      STATIC_ASSETS.some((asset) => url.pathname === asset)
    ) {
      e.respondWith(
        caches.match(e.request).then((cached) => {
          return (
            cached ||
            fetch(e.request).then((response) => {
              if (canCache(response)) {
                saveResponse(e, STATIC_CACHE, response);
              }
              return response;
            })
          );
        }),
      );
      return;
    }

    if (isCacheableAsset(url)) {
      e.respondWith(
        caches.match(e.request).then((cached) => {
          // Production Next assets have versioned URLs; reuse them without revalidation.
          if (cached && url.pathname.startsWith("/_next/static/"))
            return cached;
          const fetchPromise = fetch(e.request)
            .then((response) => {
              if (canCache(response)) {
                saveResponse(e, RUNTIME_CACHE, response);
              }
              return response;
            })
            .catch(() => cached);
          if (cached) e.waitUntil(fetchPromise.then(() => {}));
          return cached || fetchPromise;
        }),
      );
      return;
    }

    if (
      e.request.mode === "navigate" ||
      (e.request.headers.get("accept") || "").includes("text/html")
    ) {
      e.respondWith(
        fetch(e.request)
          .then((response) => {
            if (
              canCache(response) &&
              /^text\/html(?:;|$)/i.test(
                response.headers.get("content-type") || "",
              )
            ) {
              saveResponse(e, RUNTIME_CACHE, response);
            }
            return response;
          })
          .catch(() =>
            caches
              .match(e.request)
              .then((cached) => cached || caches.match("/")),
          ),
      );
      return;
    }

    e.respondWith(
      caches.match(e.request).then((cached) => {
        const fetchPromise = fetch(e.request)
          .then((response) => {
            if (canCache(response) && response.type === "basic") {
              saveResponse(e, RUNTIME_CACHE, response);
            }
            return response;
          })
          .catch(() => cached);
        if (cached) e.waitUntil(fetchPromise.then(() => {}));
        return cached || fetchPromise;
      }),
    );
  }
});
