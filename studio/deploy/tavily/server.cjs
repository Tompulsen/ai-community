const http = require("node:http");
const { createHash, randomUUID, timingSafeEqual } = require("node:crypto");

const MODELS = {
  "tavily-quick": "basic",
  "tavily-deep": "advanced",
};
const MAX_BODY_BYTES = 16000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function failure(message, status = 400, code = "invalid_request_error") {
  return Object.assign(new Error(message), { status, code });
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readInput(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const finish = (error) => {
      clearTimeout(timer);
      req.removeListener("data", data);
      req.removeListener("end", end);
      req.removeListener("error", rejectInput);
      req.removeListener("aborted", rejectInput);
      if (error) {
        req.resume();
        reject(error);
      }
    };
    const rejectInput = () => finish(failure("Request body interrupted"));
    const data = (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish(failure("Request body too large", 413));
      } else {
        chunks.push(chunk);
      }
    };
    const end = () => {
      finish();
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(failure("Invalid JSON"));
      }
    };
    const timer = setTimeout(
      () => finish(failure("Request body timed out", 408)),
      10000,
    );
    req.on("data", data);
    req.once("end", end);
    req.once("error", rejectInput);
    req.once("aborted", rejectInput);
  });
}

async function readUpstream(response) {
  if (!response.body) throw failure("Search returned no data");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE_BYTES) throw failure("Search response too large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function sourcesFrom(data) {
  if (!Array.isArray(data?.results)) throw failure("Invalid search response");
  const seen = new Set();
  return data.results
    .flatMap((item) => {
      if (typeof item?.url !== "string" || item.url.length > 2048) return [];
      let url;
      try {
        url = new URL(item.url);
      } catch {
        return [];
      }
      const text = (value, length) =>
        typeof value === "string"
          ? value
              .replace(/<[^>]*>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, length)
          : "";
      const title = text(item.title, 300);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        !title ||
        seen.has(url.href)
      )
        return [];
      seen.add(url.href);
      return [{ title, url: url.href, snippet: text(item.content, 1000) }];
    })
    .slice(0, 6);
}

function createTavilyServer({
  apiKey,
  apiKeys,
  proxyKey,
  fetchImpl = fetch,
  timeoutMs = 25000,
} = {}) {
  const keys = [
    ...new Set(
      (apiKeys?.trim() || apiKey || "").split(/[\s,]+/).filter(Boolean),
    ),
  ].map((key) => ({ key, availableAt: 0 }));
  if (!keys.length || !proxyKey?.trim() || proxyKey.length < 32) {
    throw new Error(
      "Set TAVILY_API_KEY or TAVILY_API_KEYS and a TAVILY_PROXY_KEY of at least 32 characters",
    );
  }
  let nextKey = 0;
  const digest = (value) => createHash("sha256").update(value).digest();
  const expectedKey = digest(`Bearer ${proxyKey}`);
  return http.createServer(async (req, res) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.once("aborted", abort);
    res.once("close", abort);
    let timer;
    try {
      if (req.url === "/healthz" && req.method === "GET") {
        return json(res, 200, { status: "ok" });
      }
      if (
        !timingSafeEqual(digest(req.headers.authorization || ""), expectedKey)
      ) {
        req.resume();
        throw failure("Invalid API key", 401, "invalid_api_key");
      }
      if (req.url === "/v1/models" && req.method === "GET") {
        return json(res, 200, {
          object: "list",
          data: Object.keys(MODELS).map((id) => ({
            id,
            object: "model",
            created: 0,
            owned_by: "tavily",
          })),
        });
      }
      if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
        req.resume();
        throw failure("Endpoint not found", 404);
      }
      const input = await readInput(req);
      if (
        typeof input?.model !== "string" ||
        !Object.hasOwn(MODELS, input.model)
      )
        throw failure("Unknown search model");
      if (input.stream !== undefined && typeof input.stream !== "boolean") {
        throw failure("stream must be a boolean");
      }
      if (input.n !== undefined && input.n !== 1)
        throw failure("Only n=1 is supported");
      const message = Array.isArray(input.messages)
        ? input.messages.findLast((message) => message?.role === "user")
        : undefined;
      const query = (
        typeof message?.content === "string"
          ? message.content
          : Array.isArray(message?.content)
          ? message.content
              .filter((part) => part?.type === "text")
              .map((part) => part.text || "")
              .join("\n")
          : ""
      ).trim();
      if (!query || query.length > 2000)
        throw failure("A user query of 1-2000 characters is required");
      if (controller.signal.aborted) throw failure("Request cancelled");
      timer = setTimeout(abort, timeoutMs);
      let sources;
      try {
        const start = nextKey;
        for (let offset = 0; offset < keys.length; offset++) {
          const index = (start + offset) % keys.length;
          const entry = keys[index];
          if (entry.availableAt > Date.now()) continue;
          if (controller.signal.aborted) throw failure("Request cancelled");
          nextKey = (index + 1) % keys.length;
          const response = await fetchImpl("https://api.tavily.com/search", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${entry.key}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              query,
              search_depth: MODELS[input.model],
              auto_parameters: false,
              max_results: 6,
              include_answer: false,
              include_raw_content: false,
            }),
            redirect: "error",
            signal: controller.signal,
          });
          // Only explicit provider rejection can safely fail over to another key.
          if ([401, 429, 432, 433].includes(response.status)) {
            const now = Date.now();
            let availableAt = Infinity;
            if (response.status === 429) {
              const retryAfter =
                response.headers.get("retry-after")?.trim() || "";
              const retryAt = /^\d+$/.test(retryAfter)
                ? now + Number(retryAfter) * 1000
                : /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
                    retryAfter,
                  )
                ? Date.parse(retryAfter)
                : NaN;
              availableAt = Number.isFinite(retryAt)
                ? Math.max(now + 1000, retryAt)
                : now + 60000;
            } else if (response.status !== 401) {
              availableAt = now + 5 * 60000;
            }
            entry.availableAt = Math.max(entry.availableAt, availableAt);
            await response.body?.cancel();
            continue;
          }
          if (!response.ok) {
            await response.body?.cancel();
            throw failure("Tavily search failed");
          }
          sources = sourcesFrom(await readUpstream(response));
          break;
        }
        if (!sources) throw failure("No Tavily key available");
      } catch {
        // A terminal 400 prevents the relay's default 5xx retry from replaying a paid search.
        throw failure(
          "Search unavailable; check API keys, credits, rate limits, or connectivity",
          400,
          "tavily_search_failed",
        );
      }
      const content = JSON.stringify({
        provider: "Tavily",
        coverage: "search-snippets",
        sources,
      });
      const common = {
        id: `chatcmpl-${randomUUID()}`,
        created: Math.floor(Date.now() / 1000),
        model: input.model,
      };
      // One accounting unit lets older relays settle fixed-price requests; these are not LLM tokens.
      const usage = { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 };
      if (res.destroyed) return;
      if (input.stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        });
        const chunk = (choices, extra = {}) =>
          `data: ${JSON.stringify({
            ...common,
            object: "chat.completion.chunk",
            choices,
            ...extra,
          })}\n\n`;
        res.end(
          chunk([
            {
              index: 0,
              delta: { role: "assistant", content },
              finish_reason: null,
            },
          ]) +
            chunk([{ index: 0, delta: {}, finish_reason: "stop" }]) +
            chunk([], { usage }) +
            "data: [DONE]\n\n",
        );
      } else {
        json(res, 200, {
          ...common,
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
          usage,
        });
      }
    } catch (error) {
      if (!res.destroyed && !res.headersSent) {
        json(res, error.status || 500, {
          error: {
            message: error.status
              ? error.message
              : "Search service unavailable",
            type: error.code || "server_error",
            code: error.code || "server_error",
          },
        });
      }
    } finally {
      clearTimeout(timer);
      req.removeListener("aborted", abort);
      res.removeListener("close", abort);
    }
  });
}

module.exports = { createTavilyServer };

if (require.main === module) {
  const server = createTavilyServer({
    apiKey: process.env.TAVILY_API_KEY,
    apiKeys: process.env.TAVILY_API_KEYS,
    proxyKey: process.env.TAVILY_PROXY_KEY,
  });
  server.listen(Number(process.env.PORT || 18093), "0.0.0.0", () => {
    console.log(
      `Tavily compatibility service listening on ${server.address().port}`,
    );
  });
}
