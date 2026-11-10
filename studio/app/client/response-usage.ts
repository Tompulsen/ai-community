import type { ChatResponseUsage } from "./api";
import type { ChatApiFormat } from "../utils/chat-api-format";
import type { ChatFetch } from "../utils/reasoning-fallback";

type JsonObject = Record<string, unknown>;
const fields = ["inputTokens", "outputTokens", "cachedInputTokens"] as const;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function validUsage(usage: ChatResponseUsage): ChatResponseUsage | undefined {
  const result: ChatResponseUsage = {};
  for (const field of fields) {
    const value = count(usage[field]);
    if (value !== undefined) result[field] = value;
  }
  if (
    result.inputTokens !== undefined &&
    result.cachedInputTokens !== undefined &&
    result.cachedInputTokens > result.inputTokens
  )
    delete result.cachedInputTokens;
  return Object.keys(result).length ? result : undefined;
}

function payloadUsage(format: ChatApiFormat, value: unknown) {
  const payload = object(value);
  if (!payload) return;
  if (format === "gemini") return object(payload.usageMetadata);
  if (format === "claude")
    return object(payload.usage) ?? object(object(payload.message)?.usage);
  return object(payload.usage) ?? object(object(payload.response)?.usage);
}

function normalizeUsage(
  format: ChatApiFormat,
  usage: JsonObject,
): ChatResponseUsage | undefined {
  if (format === "claude") {
    const input = count(usage.input_tokens);
    const cacheRead = count(usage.cache_read_input_tokens);
    const cacheWrite = count(usage.cache_creation_input_tokens);
    const invalidCache = [
      "cache_read_input_tokens",
      "cache_creation_input_tokens",
    ].some((field) => field in usage && count(usage[field]) === undefined);
    return validUsage({
      inputTokens:
        input === undefined || invalidCache
          ? undefined
          : input + (cacheRead ?? 0) + (cacheWrite ?? 0),
      outputTokens: count(usage.output_tokens),
      cachedInputTokens: cacheRead,
    });
  }
  if (format === "gemini") {
    const candidates = count(usage.candidatesTokenCount);
    const thoughts = count(usage.thoughtsTokenCount);
    return validUsage({
      inputTokens: count(usage.promptTokenCount),
      outputTokens:
        candidates === undefined ||
        ("thoughtsTokenCount" in usage && thoughts === undefined)
          ? undefined
          : candidates + (thoughts ?? 0),
      cachedInputTokens: count(usage.cachedContentTokenCount),
    });
  }
  const inputDetails = object(
    format === "responses"
      ? usage.input_tokens_details
      : usage.prompt_tokens_details,
  );
  return validUsage({
    inputTokens: count(
      format === "responses" ? usage.input_tokens : usage.prompt_tokens,
    ),
    outputTokens: count(
      format === "responses" ? usage.output_tokens : usage.completion_tokens,
    ),
    cachedInputTokens: count(inputDetails?.cached_tokens),
  });
}

export function extractResponseUsage(
  format: ChatApiFormat,
  value: unknown,
): ChatResponseUsage | undefined {
  const usage = payloadUsage(format, value);
  return usage ? normalizeUsage(format, usage) : undefined;
}

export function createResponseUsageReporter(
  format: ChatApiFormat,
  onUsage?: (usage: ChatResponseUsage) => void,
) {
  const completed: ChatResponseUsage[] = [];
  let current: ChatResponseUsage = {};
  let reportedFields: JsonObject = {};
  let previous: ChatResponseUsage = {};

  return {
    update(value: unknown) {
      const raw = payloadUsage(format, value);
      if (!raw) return;
      // Merge cumulative fields before validation so explicit bad values clear old counters.
      const detailsKey =
        format === "responses"
          ? "input_tokens_details"
          : "prompt_tokens_details";
      const details = object(raw[detailsKey]);
      reportedFields = {
        ...reportedFields,
        ...raw,
        ...(details
          ? {
              [detailsKey]: {
                ...object(reportedFields[detailsKey]),
                ...details,
              },
            }
          : {}),
      };
      current = normalizeUsage(format, reportedFields) ?? {};
      const rounds = [...completed, current];
      const snapshot: ChatResponseUsage = {};
      for (const field of fields) {
        if (rounds.every((round) => round[field] !== undefined))
          snapshot[field] = count(
            rounds.reduce((total, round) => total + round[field]!, 0),
          );
      }
      const next = validUsage(snapshot) ?? {};
      if (fields.every((field) => previous[field] === next[field])) return;
      previous = next;
      onUsage?.({ ...next });
    },
    nextRound() {
      completed.push(current);
      current = {};
      reportedFields = {};
      if (fields.some((field) => previous[field] !== undefined)) {
        previous = {};
        onUsage?.({});
      }
    },
  };
}

export async function readJsonResponseUsage(
  response: Response,
  report: (value: unknown) => void,
) {
  if (
    !response.ok ||
    !/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(
      response.headers.get("content-type") ?? "",
    )
  )
    return;
  try {
    report(await response.clone().json());
  } catch {}
}

function withoutUsage(body: JsonObject) {
  const streamOptions = { ...object(body.stream_options) };
  delete streamOptions.include_usage;
  const next = { ...body };
  if (Object.keys(streamOptions).length) next.stream_options = streamOptions;
  else delete next.stream_options;
  return JSON.stringify(next);
}

function unsupportedUsage(value: unknown) {
  const payload = object(value);
  const error = object(payload?.error);
  const message =
    typeof payload?.error === "string"
      ? payload.error
      : typeof error?.message === "string"
      ? error.message
      : "";
  const parameter = error?.param ?? error?.field;
  const named =
    (typeof parameter === "string" &&
      /^(?:stream_options(?:\.include_usage)?|include_usage)$/.test(
        parameter,
      )) ||
    /\b(?:stream_options|include_usage)\b/.test(message);
  const rejection = `${message} ${error?.code ?? ""}`;
  return (
    named &&
    /unsupported|unknown|unrecognized|not\s+(?:support(?:ed)?|allowed|permitted)|extra.+not permitted/i.test(
      rejection,
    ) &&
    !/quota|balance|rate.?limit|api.?key|auth|context|额度|余额|密钥/i.test(
      rejection,
    )
  );
}

export function createUsageFallbackFetch(
  fetcher: ChatFetch,
  isCurrent?: () => boolean,
): ChatFetch {
  let unsupported = false;
  return async (url, init) => {
    let body: JsonObject | undefined;
    try {
      body =
        typeof init?.body === "string"
          ? object(JSON.parse(init.body))
          : undefined;
    } catch {}
    const includesUsage = object(body?.stream_options)?.include_usage === true;
    const request =
      unsupported && includesUsage && body
        ? { ...init, body: withoutUsage(body) }
        : init;
    const response = await fetcher(url, request);
    if (
      unsupported ||
      !includesUsage ||
      !body ||
      (response.status !== 400 && response.status !== 422) ||
      init?.signal?.aborted ||
      isCurrent?.() === false
    )
      return response;
    let failure: unknown;
    try {
      failure = await response.clone().json();
    } catch {
      return response;
    }
    if (
      !unsupportedUsage(failure) ||
      init?.signal?.aborted ||
      isCurrent?.() === false
    )
      return response;
    unsupported = true;
    try {
      void response.body?.cancel().catch(() => {});
    } catch {}
    return fetcher(url, { ...init, body: withoutUsage(body) });
  };
}
