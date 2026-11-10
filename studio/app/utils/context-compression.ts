import type { ChatOptions, RequestMessage } from "../client/api";
import { getClientApi } from "../client/api";
import type { ModelConfig } from "../store/config";
import { getLocalScope } from "./local-workspace";
import { getUserFriendlyError } from "./error-hints";
import Locale from "../locales";

type CompressionJob = {
  messageId: string;
  controller: AbortController;
  active: () => boolean;
  promise: Promise<void>;
};

const jobs = new Map<string, CompressionJob>();
const jobKey = (owner: string, sessionId: string) =>
  JSON.stringify([owner, sessionId]);
const cancelled = () => new DOMException("请求已取消", "AbortError");

export function isContextCompressionActive(
  sessionId: string,
  messageId: string,
) {
  const job = jobs.get(jobKey(getLocalScope(), sessionId));
  return job?.messageId === messageId && !job.controller.signal.aborted;
}

function waitForJob(job: CompressionJob, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(cancelled());
    };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    job.promise.then(() => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(cancelled());
      else resolve();
    });
  });
}

export function waitForContextCompression(
  owner: string,
  sessionId: string,
  signal: AbortSignal,
) {
  if (!jobs.has(jobKey(owner, sessionId))) return;
  return (async () => {
    for (;;) {
      if (signal.aborted) throw cancelled();
      const job = jobs.get(jobKey(owner, sessionId));
      if (!job) return;
      if (!job.active()) job.controller.abort();
      await waitForJob(job, signal);
    }
  })();
}

export async function serializeContextCompression<T>({
  owner,
  sessionId,
  messageId,
  controller,
  active,
  run,
  cleanup,
}: {
  owner: string;
  sessionId: string;
  messageId: string;
  controller: AbortController;
  active: () => boolean;
  run: () => Promise<T>;
  cleanup: () => void;
}): Promise<T> {
  const key = jobKey(owner, sessionId);
  for (;;) {
    const previous = jobs.get(key);
    if (!previous) break;
    if (!previous.active()) previous.controller.abort();
    await waitForJob(previous, controller.signal);
  }
  if (controller.signal.aborted) throw cancelled();
  let release!: () => void;
  const job: CompressionJob = {
    messageId,
    controller,
    active,
    promise: new Promise<void>((resolve) => {
      release = resolve;
    }),
  };
  jobs.set(key, job);
  try {
    return await run();
  } finally {
    if (jobs.get(key) === job) jobs.delete(key);
    try {
      cleanup();
    } finally {
      release();
    }
  }
}

export function requestContextSummary({
  accountTokenId,
  messages,
  config,
  chatApiFormat,
  modelCapabilities,
  signal,
  active,
  local,
}: {
  accountTokenId?: number | null;
  messages: RequestMessage[];
  config: ModelConfig;
  chatApiFormat?: ModelConfig["chatApiFormat"];
  modelCapabilities?: ChatOptions["modelCapabilities"];
  signal: AbortSignal;
  active: () => boolean;
  local: boolean;
}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let summaryController: AbortController | undefined;
    let settled = false;
    const finish = (error?: Error, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      if (error) reject(error);
      else if (!active()) reject(cancelled());
      else resolve(text || "");
    };
    const cancel = () => {
      summaryController?.abort();
      finish(cancelled());
    };
    const timer = setTimeout(() => {
      summaryController?.abort();
      finish(new Error("历史摘要超时，已保留原始记录，请重试。"));
    }, 120000);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted || !active()) {
      cancel();
      return;
    }
    if (local) {
      void import("./local-preview-response")
        .then(({ getLocalPreviewSummary }) => getLocalPreviewSummary(signal))
        .then(
          (text) => finish(undefined, text),
          (error) => finish(error),
        );
      return;
    }
    const options: ChatOptions = {
      accountTokenId,
      modelCapabilities,
      messages: messages.concat({
        role: "user",
        content: `${Locale.Store.Prompt.Summarize}\n保留用户要求、关键事实、结论和未完成事项，控制在 800 字以内。`,
      }),
      config: {
        model: config.model,
        providerName: config.providerName,
        chatApiFormat,
        stream: false,
        max_tokens: 1024,
        reasoningEffort: "auto",
        stop: "",
      },
      onController(value) {
        summaryController = value;
        if (settled || !active()) {
          value.abort();
          finish(cancelled());
        }
      },
      onFinish(text, response) {
        if (response?.ok && text.trim()) finish(undefined, text);
        else
          finish(new Error("历史摘要失败，已保留原始记录，请重试或新建对话。"));
      },
      onError(error) {
        finish(new Error(`历史摘要失败：${getUserFriendlyError(error)}`));
      },
    };
    try {
      void getClientApi(config.providerName).llm.chat(options).catch(finish);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
