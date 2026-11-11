import { getHeaders, getClientApi, type ChatOptions } from "../client/api";
import {
  getLocalScope,
  getLocalTokenId,
  isLocalWorkspaceActive,
} from "./local-workspace";
import { getMessageTextContent } from "../utils";
import type { ChatMessage } from "../store/chat";
import { ChatControllerPool } from "../client/controller";
import {
  documentChatInstruction,
  resolveDocumentIntent,
  type ChatDocumentAttachment,
  type ChatDocumentTask,
  type DocumentSource,
} from "./document-chat";
import {
  documentPlanningPrompt,
  parseDocumentClarification,
  parseDocumentPlan,
  type DocumentJob,
  type DocumentPlan,
} from "./document-workspace";
import type { ParsedFile } from "./file-upload";
import { skillContextRole } from "../skills/request";

export function captureDocumentAccount() {
  const owner = getLocalScope(),
    token = getLocalTokenId();
  return {
    assertCurrent() {
      if (
        !isLocalWorkspaceActive() ||
        !owner.startsWith("user-") ||
        getLocalScope() !== owner ||
        getLocalTokenId() !== token
      )
        throw new Error("账号或密钥已变化，请重新打开文档工作区。");
    },
  };
}
export type DocumentAccount = ReturnType<typeof captureDocumentAccount>;
export async function documentFetch(
  account: DocumentAccount,
  resource: string,
  options: RequestInit = {},
) {
  account.assertCurrent();
  const response = await fetch(`/studio/api/documents/${resource}`, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: { ...getHeaders(), ...options.headers },
  });
  account.assertCurrent();
  const data = await response.json().catch(() => {
    throw new Error("文档服务返回异常，请稍后重试。");
  });
  account.assertCurrent();
  if (!response.ok)
    throw Object.assign(
      new Error(
        typeof data.error === "string"
          ? data.error
          : "文档操作失败，请稍后重试。",
      ),
      { status: response.status },
    );
  return data;
}
export async function downloadDocument(source: DocumentSource) {
  const account = captureDocumentAccount();
  account.assertCurrent();
  const response = await fetch(
    `/studio/api/documents/assets/${source.assetId}/${source.version}/download`,
    { headers: getHeaders(), cache: "no-store", credentials: "same-origin" },
  );
  if (!response.ok) throw new Error("下载失败，请确认登录状态后重试。");
  const blob = await response.blob();
  account.assertCurrent();
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = source.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function pause(signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(new Error("已取消文档处理"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, 1000);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
export async function waitDocumentJob(
  account: DocumentAccount,
  initial: DocumentJob,
  signal: AbortSignal,
  onUpdate?: (job: DocumentJob) => void,
) {
  let job = initial;
  while (
    !["ready", "failed", "cancelled", "needs_input"].includes(job.status)
  ) {
    onUpdate?.(job);
    await pause(signal);
    job = await documentFetch(account, `jobs/${job.id}`, { signal });
  }
  onUpdate?.(job);
  return job;
}
export async function uploadDocument(
  account: DocumentAccount,
  file: File,
  sessionId: string,
  key: string,
  signal: AbortSignal,
) {
  if (!/\.(docx|xlsx)$/i.test(file.name) || file.size > 20 * 1024 * 1024)
    throw new Error("请选择 20 MiB 以内的 DOCX / XLSX 文件。");
  return documentFetch(account, "upload", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(
        file.name.replace(/\.(docx|xlsx)$/i, (s) => s.toLowerCase()),
      ),
      "X-Chat-Session": sessionId,
      "Idempotency-Key": key,
    },
    body: file,
  }) as Promise<DocumentJob>;
}
export function sourceFromJob(
  job: DocumentJob,
  format: "docx" | "xlsx",
): DocumentSource {
  if (job.status !== "ready" || !job.assetId || !job.version)
    throw new Error(job.error || "文件尚未就绪");
  return {
    assetId: job.assetId,
    version: job.version,
    fileName: job.fileName || `文档.${format}`,
    format,
    sessionId: job.sessionId,
  };
}
export async function submitDocumentPlan(
  account: DocumentAccount,
  task: ChatDocumentTask & { plan?: DocumentPlan },
  signal?: AbortSignal,
): Promise<DocumentJob> {
  if (!task.plan) throw new Error("缺少已生成的文件内容，请重新发送请求。");
  return documentFetch(account, "jobs", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": task.key,
    },
    body: JSON.stringify({ request: task.request, plan: task.plan }),
  });
}

export async function runDocumentChat(options: {
  input: string;
  sessionId: string;
  bot: ChatMessage;
  turns: ChatMessage[];
  files: ParsedFile[];
  source?: DocumentSource;
  config: ChatOptions["config"];
  accountTokenId?: number | null;
  assertActive: () => boolean;
  publish: () => void;
  onSource: (source: DocumentSource) => void;
}) {
  const { bot, sessionId, config } = options;
  const turns = options.turns.map((turn) => ({
    ...turn,
    content: getMessageTextContent(turn),
  }));
  const attachments: ChatDocumentAttachment[] = options.files.map((file) => ({
    name: file.name,
    type: file.type,
    size: file.size,
  }));
  if (options.source && attachments.length === 0)
    attachments.push({
      name: options.source.fileName,
      type: "",
      size: 0,
      source: options.source,
    });
  const intent = resolveDocumentIntent(
    options.input,
    turns,
    attachments,
    sessionId,
  );
  if (!intent) return false;
  const controller = new AbortController(),
    signal = controller.signal,
    account = captureDocumentAccount();
  ChatControllerPool.addController(sessionId, bot.id, controller);
  const assertActive = () => {
    account.assertCurrent();
    signal.throwIfAborted();
    if (!options.assertActive())
      throw new Error("聊天已变化，本次文档请求已取消。");
  };
  const update = (
    patch: Partial<ChatDocumentTask> & { plan?: DocumentPlan },
  ) => {
    account.assertCurrent();
    bot.documentTask = { ...bot.documentTask!, ...patch };
    options.publish();
  };
  bot.documentTask = {
    key: crypto.randomUUID(),
    request: {
      sessionId,
      instruction: intent.instruction,
      model: config.model,
      provider: config.providerName || "OpenAI",
      format: intent.format,
    },
    mode: intent.edit ? "edit" : "create",
    preparing: true,
  };
  bot.content = "正在准备文档";
  options.publish();
  let uploadKey: string | undefined;
  try {
    assertActive();
    if (intent.clarification) {
      update({
        clarification: intent.clarification,
        candidates: intent.candidates,
        preparing: false,
      });
      bot.content = intent.clarification;
      return true;
    }
    const capability = await documentFetch(account, "capabilities", { signal });
    if (!capability.enabled || !capability[intent.format])
      throw new Error("文档服务暂未就绪，请稍后重试。");
    let source = intent.source || intent.attachment?.source;
    const office = options.files.filter((file) =>
      /\.(docx|xlsx)$/i.test(file.name),
    );
    if (office.length > 1)
      throw new Error(
        "每次请选择一个 Word 或 Excel 文件，避免修改到错误的文件。",
      );
    for (const file of options.files) {
      assertActive();
      if (!file.content.startsWith("data:") && !file.isText)
        throw new Error("无法读取附件，请重新上传。");
      const blob = file.isText
        ? new Blob([file.content])
        : await (await fetch(file.content, { signal })).blob();
      if (/\.(docx|xlsx)$/i.test(file.name)) {
        const uploaded = await uploadDocument(
          account,
          new File([blob], file.name, { type: file.type }),
          sessionId,
          (uploadKey = crypto.randomUUID()),
          signal,
        );
        update({ uploadJob: uploaded });
        const ready = await waitDocumentJob(
          account,
          uploaded,
          signal,
          (uploadJob) => update({ uploadJob }),
        );
        source = sourceFromJob(
          ready,
          file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "docx",
        );
        options.onSource(source);
      } else if (/\.(txt|md|markdown|csv|json)$/i.test(file.name)) {
        const target = attachments.find((item) => item.name === file.name)!;
        target.content = await blob.text();
      } else
        throw new Error(
          "文档工作区支持 DOCX、XLSX，以及 TXT、Markdown、CSV、JSON 数据附件。",
        );
    }
    if (source && intent.edit) {
      const history = await documentFetch(
        account,
        `assets/${source.assetId}/versions`,
        { signal },
      );
      if (history.versions[0]?.version !== source.version)
        throw new Error("文件已有新版本，请在文档工作区选择最新版本后修改。");
    }
    let structure: unknown = null;
    if (source)
      structure = await documentFetch(
        account,
        `assets/${source.assetId}/${source.version}/structure`,
        { signal },
      );
    const request = {
      ...bot.documentTask.request,
      instruction: documentChatInstruction(
        intent.instruction,
        turns,
        attachments,
      ),
      ...(intent.edit && source
        ? {
            sourceArtifactId: source.assetId,
            baseVersion: source.version,
            format: source.format,
          }
        : {}),
    };
    update({ request });
    assertActive();
    const prompt = documentPlanningPrompt(request, structure);
    if (new TextEncoder().encode(prompt).length > 512 * 1024)
      throw new Error("附件内容过长，请缩小文件范围后重试。");
    const response = await new Promise<string>((resolve, reject) => {
      let modelController: AbortController | undefined;
      const cancel = () => {
        modelController?.abort();
        reject(new Error("文档生成已停止"));
      };
      signal.addEventListener("abort", cancel, { once: true });
      void getClientApi(config.providerName)
        .llm.chat({
          accountTokenId: options.accountTokenId,
          messages: [
            {
              role: skillContextRole(config.model, config.chatApiFormat),
              content: prompt,
            },
            { role: "user", content: intent.instruction },
          ],
          config: { ...config, stream: true },
          onController: (value) => {
            modelController = value;
            if (signal.aborted) value.abort();
          },
          onFinish: (text, result) => {
            signal.removeEventListener("abort", cancel);
            if (result?.ok === false || result?.status === 499)
              reject(new Error("文档内容生成未完成，请重新发送请求。"));
            else resolve(text);
          },
          onError: (error) => {
            signal.removeEventListener("abort", cancel);
            reject(error);
          },
        })
        .catch((error) => {
          signal.removeEventListener("abort", cancel);
          reject(error);
        });
    });
    assertActive();
    const clarification = parseDocumentClarification(response);
    if (clarification) {
      update({ clarification, preparing: false });
      bot.content = clarification;
      return true;
    }
    const plan = parseDocumentPlan(response);
    update({ plan });
    const job = await submitDocumentPlan(account, bot.documentTask, signal);
    update({ job, preparing: false });
    bot.content = "文档内容已生成，正在制作文件。";
  } catch (error) {
    if (signal.aborted) {
      if (uploadKey)
        await documentFetch(account, `jobs/${uploadKey}`, {
          method: "DELETE",
        }).catch(() => {});
      if (bot.documentTask?.plan) {
        const stopped = await documentFetch(
          account,
          `jobs/${bot.documentTask.key}`,
          { method: "DELETE" },
        ).catch(() => undefined);
        if (stopped) update({ job: stopped });
      }
    }
    try {
      update({
        preparing: false,
        error: signal.aborted
          ? "文档生成已停止。"
          : error instanceof Error
          ? error.message
          : "文档生成失败，请重试。",
      });
      bot.content = bot.documentTask?.error || "文档生成未完成";
    } catch {}
  } finally {
    bot.streaming = false;
    ChatControllerPool.remove(sessionId, bot.id);
    try {
      account.assertCurrent();
      options.publish();
    } catch {}
  }
  return true;
}

// Both chat's Retry action and the file card reuse the saved plan, never a model call.
export async function retryDocumentFile(sessionId: string, messageId: string) {
  const account = captureDocumentAccount();
  account.assertCurrent();
  const { useChatStore } = await import("../store/chat");
  const session = useChatStore
    .getState()
    .sessions.find((item) => item.id === sessionId);
  const message = session?.messages.find((item) => item.id === messageId);
  const original = message?.documentTask;
  if (!session || !original?.plan)
    throw new Error("缺少已生成的文档内容，请重新发送请求。");
  let task = original;
  let job = task.job;
  try {
    job = await documentFetch(account, `jobs/${task.key}`);
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
    if (job?.status !== "cancelled") job = undefined;
  }
  if (job?.status === "cancelled" && !job.canRecover)
    task = { ...task, key: crypto.randomUUID(), job: undefined };
  const publish = (next?: DocumentJob) => {
    account.assertCurrent();
    const current = useChatStore
      .getState()
      .sessions.find((item) => item.id === sessionId);
    if (!current) return;
    useChatStore.getState().updateTargetSession(current, (session) => {
      const item = session.messages.find((item) => item.id === messageId);
      if (
        !item?.documentTask ||
        ![original.key, task.key].includes(item.documentTask.key)
      )
        return;
      item.documentTask = {
        ...task,
        job: next,
        preparing: false,
        error: undefined,
      };
      if (next?.status === "ready") {
        item.content = "文件已生成，可预览、下载或继续修改。";
        const source = sourceFromJob(next, task.request.format);
        if (
          !session.documentSource ||
          session.documentSource.assetId === source.assetId
        )
          session.documentSource = source;
      }
      session.messages = [...session.messages];
    });
  };
  if (!job || task.key !== original.key) {
    publish();
    job = await submitDocumentPlan(account, task);
  } else if (["failed", "cancelled"].includes(job.status))
    job = await documentFetch(account, `jobs/${job.id}/retry`, {
      method: "POST",
    });
  publish(job);
}
