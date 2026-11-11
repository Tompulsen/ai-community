import type { ChatResponseUsage } from "../client/api";
import type { ChatMessage } from "../store/chat";

export type ChatResponseMetrics = {
  usage: ChatResponseUsage;
  durationMs?: number;
  generationDurationMs?: number;
  estimatedOutputTokens?: number;
};

function tokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function getResponseMetrics(messages: readonly ChatMessage[]) {
  let latest: ChatMessage | undefined;
  let outputTokensPerSecond: number | undefined;
  let cacheHitPercent: number | undefined;
  let speedIsEstimated = false;
  let speedIsPrevious = false;
  let cacheIsPrevious = false;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    latest ??= message;
    if (
      message.isError ||
      message.interrupted ||
      message.materialStatus ||
      (message !== latest && message.streaming)
    ) {
      continue;
    }

    const metrics = message.responseMetrics;
    const usage = metrics?.usage;
    const reportedOutputTokens = usage?.outputTokens;
    const progress = message.streaming ? message.generationProgress : undefined;
    const outputTokens = message.streaming
      ? progress?.outputTokens
      : tokenCount(reportedOutputTokens)
      ? reportedOutputTokens
      : metrics?.estimatedOutputTokens;
    const durationMs = message.streaming
      ? progress?.durationMs
      : metrics?.generationDurationMs;

    if (
      outputTokensPerSecond === undefined &&
      tokenCount(outputTokens) &&
      typeof durationMs === "number" &&
      Number.isFinite(durationMs) &&
      durationMs > 0
    ) {
      const speed = (outputTokens / durationMs) * 1000;
      if (Number.isFinite(speed)) {
        outputTokensPerSecond = speed;
        speedIsEstimated = !!progress || !tokenCount(reportedOutputTokens);
        speedIsPrevious = message !== latest;
      }
    }

    if (
      cacheHitPercent === undefined &&
      usage &&
      tokenCount(usage.inputTokens) &&
      usage.inputTokens > 0 &&
      tokenCount(usage.cachedInputTokens) &&
      usage.cachedInputTokens <= usage.inputTokens
    ) {
      cacheHitPercent = (usage.cachedInputTokens / usage.inputTokens) * 100;
      cacheIsPrevious = message !== latest;
    }

    if (outputTokensPerSecond !== undefined && cacheHitPercent !== undefined)
      break;
  }

  return {
    outputTokensPerSecond,
    cacheHitPercent,
    pending: !!latest?.streaming || latest?.materialStatus === "processing",
    ...(speedIsEstimated ? { speedIsEstimated: true } : {}),
    ...(speedIsPrevious ? { speedIsPrevious: true } : {}),
    ...(cacheIsPrevious ? { cacheIsPrevious: true } : {}),
  };
}
