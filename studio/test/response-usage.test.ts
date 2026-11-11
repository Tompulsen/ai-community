/** @jest-environment node */
import { jest } from "@jest/globals";
import {
  createResponseUsageReporter,
  createUsageFallbackFetch,
  extractResponseUsage,
  readJsonResponseUsage,
} from "../app/client/response-usage";
import { createReasoningFallbackFetch } from "../app/utils/reasoning-fallback";

test.each([
  [
    "chat-completions",
    {
      usage: {
        prompt_tokens: 20,
        completion_tokens: 0,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    },
    { inputTokens: 20, outputTokens: 0, cachedInputTokens: 0 },
  ],
  [
    "responses",
    {
      response: {
        usage: {
          input_tokens: 20,
          output_tokens: 8,
          input_tokens_details: { cached_tokens: 12 },
        },
      },
    },
    { inputTokens: 20, outputTokens: 8, cachedInputTokens: 12 },
  ],
  [
    "gemini",
    {
      usageMetadata: {
        promptTokenCount: 20,
        candidatesTokenCount: 8,
        thoughtsTokenCount: 3,
        cachedContentTokenCount: 12,
      },
    },
    { inputTokens: 20, outputTokens: 11, cachedInputTokens: 12 },
  ],
  [
    "claude",
    {
      usage: {
        input_tokens: 20,
        output_tokens: 8,
        cache_read_input_tokens: 12,
        cache_creation_input_tokens: 5,
      },
    },
    { inputTokens: 37, outputTokens: 8, cachedInputTokens: 12 },
  ],
] as const)(
  "%s normalizes reported usage without discarding zero",
  (format, value, expected) => {
    expect(extractResponseUsage(format, value)).toEqual(expected);
  },
);

test("missing usage remains unknown and never becomes zero", () => {
  expect(extractResponseUsage("responses", {})).toBeUndefined();
  expect(extractResponseUsage("gemini", { usageMetadata: {} })).toBeUndefined();
  expect(
    extractResponseUsage("chat-completions", { usage: { prompt_tokens: 10 } }),
  ).toEqual({ inputTokens: 10 });
});

test("JSON streaming fallbacks can report usage without consuming the transport body", async () => {
  const response = Response.json({ usage: { prompt_tokens: 0 } });
  const onUsage = jest.fn();
  const reporter = createResponseUsageReporter("chat-completions", onUsage);
  await readJsonResponseUsage(response, reporter.update);
  expect(onUsage).toHaveBeenCalledWith({ inputTokens: 0 });
  expect(response.bodyUsed).toBe(false);
  expect(await response.json()).toEqual({ usage: { prompt_tokens: 0 } });
});

test.each([-1, NaN, Infinity, 1.5, "10"])(
  "rejects invalid token counts: %s",
  (invalid) => {
    expect(
      extractResponseUsage("chat-completions", {
        usage: {
          prompt_tokens: invalid,
          completion_tokens: invalid,
          prompt_tokens_details: { cached_tokens: invalid },
        },
      }),
    ).toBeUndefined();
  },
);

test("invalid cached input cannot exceed reported total input", () => {
  expect(
    extractResponseUsage("responses", {
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        input_tokens_details: { cached_tokens: 11 },
      },
    }),
  ).toEqual({ inputTokens: 10, outputTokens: 2 });
});

test("explicit invalid cumulative fields become unknown instead of retaining previous counters", () => {
  const onUsage = jest.fn();
  const reporter = createResponseUsageReporter("chat-completions", onUsage);
  reporter.update({
    usage: {
      prompt_tokens: 10,
      completion_tokens: 4,
      prompt_tokens_details: { cached_tokens: 6 },
    },
  });
  reporter.update({
    usage: {
      completion_tokens: -1,
      prompt_tokens_details: { cached_tokens: 11 },
    },
  });
  expect(onUsage).toHaveBeenLastCalledWith({ inputTokens: 10 });
});

test("Claude cumulative deltas retain input components without adding repeated output totals", () => {
  const onUsage = jest.fn();
  const reporter = createResponseUsageReporter("claude", onUsage);
  reporter.update({
    type: "message_start",
    message: {
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 5,
        output_tokens: 0,
      },
    },
  });
  reporter.update({ type: "message_delta", usage: { output_tokens: 3 } });
  reporter.update({ type: "message_delta", usage: { output_tokens: 6 } });
  reporter.update({ type: "message_delta", usage: { output_tokens: 6 } });
  expect(onUsage).toHaveBeenCalledTimes(3);
  expect(onUsage).toHaveBeenLastCalledWith({
    inputTokens: 35,
    outputTokens: 6,
    cachedInputTokens: 20,
  });
  const nextRequest = jest.fn();
  createResponseUsageReporter("claude", nextRequest).update({
    usage: { input_tokens: 1, output_tokens: 0 },
  });
  expect(nextRequest).toHaveBeenCalledWith({ inputTokens: 1, outputTokens: 0 });
});

test("tool rounds accumulate snapshots only when every round reports the field", () => {
  const onUsage = jest.fn();
  const reporter = createResponseUsageReporter("chat-completions", onUsage);
  reporter.update({
    usage: {
      prompt_tokens: 10,
      completion_tokens: 2,
      prompt_tokens_details: { cached_tokens: 0 },
    },
  });
  reporter.nextRound();
  expect(onUsage).toHaveBeenLastCalledWith({});
  reporter.update({ usage: { prompt_tokens: 20, completion_tokens: 3 } });
  expect(onUsage).toHaveBeenLastCalledWith({
    inputTokens: 30,
    outputTokens: 5,
  });
  reporter.update({ usage: { completion_tokens: 4 } });
  expect(onUsage).toHaveBeenLastCalledWith({
    inputTokens: 30,
    outputTokens: 6,
  });
  expect(onUsage.mock.calls[0][0]).toEqual({
    inputTokens: 10,
    outputTokens: 2,
    cachedInputTokens: 0,
  });
});

function usageRequest() {
  return {
    method: "POST",
    body: JSON.stringify({
      model: "compatible-model",
      messages: [{ role: "user", content: "Original input" }],
      stream: true,
      stream_options: { include_usage: true, include_obfuscation: false },
    }),
    headers: { Authorization: "Bearer fixture" },
    signal: new AbortController().signal,
  };
}

test("explicit unsupported usage retries once while retaining other stream settings", async () => {
  const rejected = Response.json(
    {
      error: {
        message: "Unsupported parameter: stream_options.include_usage",
        param: "stream_options.include_usage",
      },
    },
    { status: 400 },
  );
  const success = new Response(null, {
    headers: { "content-type": "text/event-stream" },
  });
  const fetcher = jest
    .fn<typeof fetch>()
    .mockResolvedValueOnce(rejected)
    .mockResolvedValue(success);
  const wrapped = createUsageFallbackFetch(fetcher);
  const init = usageRequest();
  expect(await wrapped("/api/chat", init)).toBe(success);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const retried = fetcher.mock.calls[1][1]!;
  expect(JSON.parse(retried.body as string)).toEqual({
    ...JSON.parse(init.body),
    stream_options: { include_obfuscation: false },
  });
  expect(retried.headers).toBe(init.headers);
  expect(retried.signal).toBe(init.signal);
  await wrapped("/api/chat", init);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(
    JSON.parse(fetcher.mock.calls[2][1]!.body as string).stream_options,
  ).toEqual({ include_obfuscation: false });
});

test.each([
  [400, "Invalid API key"],
  [422, "Context length exceeded"],
  [429, "Unsupported parameter: stream_options"],
])("does not retry unrelated failures (%s %s)", async (status, message) => {
  const failure = Response.json({ error: { message } }, { status });
  const fetcher = jest.fn<typeof fetch>().mockResolvedValue(failure);
  expect(
    await createUsageFallbackFetch(fetcher)("/api/chat", usageRequest()),
  ).toBe(failure);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("usage and reasoning compatibility fallbacks compose without dropping messages", async () => {
  const fetcher = jest
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            message: "Unsupported reasoning_effort",
            param: "reasoning_effort",
          },
        },
        { status: 400 },
      ),
    )
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            message: "Unsupported stream_options",
            param: "stream_options",
          },
        },
        { status: 400 },
      ),
    )
    .mockResolvedValueOnce(new Response());
  const onFallback = jest.fn<() => void>();
  const wrapped = createReasoningFallbackFetch(
    createUsageFallbackFetch(fetcher),
    { onFallback },
  );
  const init = usageRequest();
  await wrapped("/api/chat", {
    ...init,
    body: JSON.stringify({
      ...JSON.parse(init.body),
      reasoning_effort: "high",
    }),
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(onFallback).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toEqual({
    ...JSON.parse(init.body),
    stream_options: { include_obfuscation: false },
  });
});
