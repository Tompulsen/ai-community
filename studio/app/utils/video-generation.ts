import { nanoid } from "nanoid";
import { apiFetch, apiPath } from "../client/api";
import { useAccessStore } from "../store/access";
import {
  snapshotVideoDraft,
  useVideoStore,
  type VideoDraft,
  type VideoResult,
} from "../store/video";
import { getModelProvider } from "./model";
import { CUSTOM_MODEL_PROVIDER, usesCustomProvider } from "./custom-provider";
import {
  getLocalScope,
  getLocalTokenId,
  isLocalWorkspaceActive,
} from "./local-workspace";
import {
  forgetTask,
  pendingTasks,
  pollLocalTask,
  rememberTask,
  taskResultUrl,
  type LocalTask,
} from "./local-tasks";
import {
  buildVideoRequest,
  videoApiFormat,
  videoParameterFormat,
  videoTaskId,
} from "./video-api";
import { videoResultFields } from "./video-media";

const waiting = new Map<
  string,
  { controller: AbortController; promise: Promise<void> }
>();
let submission: Promise<void> | undefined;
const chatSubmissions = new Map<string, Promise<void>>();
const uncertainSubmission =
  "提交结果尚无法确认，未收到任务 ID；请先核对服务商日志，勿重复提交。";

function validProgress(value: unknown): number | undefined {
  if (typeof value !== "number" && !(typeof value === "string" && value.trim()))
    return;
  const progress = Number(value);
  if (Number.isFinite(progress) && progress >= 0 && progress <= 100)
    return progress;
}

function taskPhase(data: any): VideoResult["phase"] {
  const status = String(data.status || "").toLowerCase();
  if (["queued", "pending", "submitted"].includes(status)) return "queued";
  if (["saving", "preparing"].includes(status)) return "preparing";
  return "generating";
}

function progressLabel(phase: VideoResult["phase"]) {
  return phase === "queued"
    ? "正在排队"
    : phase === "preparing"
    ? "正在整理视频"
    : "正在生成";
}

function contextFor(task: LocalTask, controller: AbortController) {
  const owner = getLocalScope();
  const provider = task.customApiBase ? CUSTOM_MODEL_PROVIDER : undefined;
  const access = useAccessStore.getState();
  const source = apiPath("", provider);
  const owns = () => isLocalWorkspaceActive() && getLocalScope() === owner;
  const check = () => {
    if (!owns() || controller.signal.aborted)
      throw new DOMException("Cancelled", "AbortError");
    if (
      apiPath("", provider) !== source ||
      (task.customApiBase &&
        (!useAccessStore.getState().useCustomConfig ||
          source !== task.customApiBase ||
          useAccessStore.getState().openaiApiKey !== access.openaiApiKey))
    )
      throw new Error("请切回提交时的账号、密钥或接口后恢复查询");
  };
  return {
    owner,
    provider,
    owns,
    check,
    fetch: (path: string, options?: RequestInit) => {
      check();
      return apiFetch(
        path,
        {
          ...options,
          signal: controller.signal,
          headers: {
            ...(options?.headers as Record<string, string>),
            ...(task.tokenId === null
              ? {}
              : { "X-New-Api-Token": String(task.tokenId) }),
          },
        },
        provider,
      );
    },
  };
}

function registerWaiting(
  id: string,
  controller: AbortController,
  run: () => Promise<void>,
) {
  const key = `${getLocalScope()}:${id}`;
  const existing = waiting.get(key);
  if (existing) return existing.promise;
  const abort = () => controller.abort();
  const stop = (event: Event) => {
    if ((event as CustomEvent<string>).detail === id) abort();
  };
  for (const event of [
    "model-source-changing",
    "local-data-maintenance",
    "local-workspace-switch",
  ])
    window.addEventListener(event, abort);
  window.addEventListener("stop-video-waiting", stop);
  const promise = Promise.resolve()
    .then(run)
    .finally(() => {
      if (waiting.get(key)?.controller !== controller) return;
      waiting.delete(key);
      for (const event of [
        "model-source-changing",
        "local-data-maintenance",
        "local-workspace-switch",
      ])
        window.removeEventListener(event, abort);
      window.removeEventListener("stop-video-waiting", stop);
      if (isLocalWorkspaceActive()) {
        useVideoStore.getState().setGenerating(waiting.size > 0);
        if (!waiting.size)
          useVideoStore.getState().setGenerateProgress(undefined, "");
      }
    });
  waiting.set(key, { controller, promise });
  useVideoStore.getState().setGenerating(true);
  return promise;
}

async function updateProgress(task: LocalTask, data: any) {
  const phase = taskPhase(data);
  const progress = validProgress(data.progress);
  useVideoStore.getState().setGenerateProgress(progress, progressLabel(phase));
  await useVideoStore.getState().updateResult(task.id, {
    status: "pending",
    phase,
    progress,
    error: undefined,
    upstreamId: task.upstreamId,
  });
}

async function finishTask(task: LocalTask, data: any, provider?: string) {
  await useVideoStore.getState().updateResult(task.id, {
    ...videoResultFields(data, task, provider),
    status: "success",
    phase: undefined,
    progress: undefined,
    completedAt: Date.now(),
    error: undefined,
    upstreamId: task.upstreamId || undefined,
  });
  forgetTask(task.id);
}

async function awaitTask(
  task: LocalTask,
  context: ReturnType<typeof contextFor>,
  controller: AbortController,
) {
  context.check();
  rememberTask({ ...task, paused: false });
  const result = useVideoStore
    .getState()
    .results.find((result) => result.id === task.id);
  if (!result)
    await useVideoStore.getState().addResult({
      id: task.id,
      url: "",
      prompt: task.prompt,
      model: task.model,
      status: "pending",
      phase: "queued",
      createdAt: task.createdAt,
      upstreamId: task.upstreamId,
      ...(task.video as Pick<
        VideoResult,
        "mode" | "aspectRatio" | "resolution" | "duration" | "size"
      >),
    });
  await updateProgress(task, { status: "queued" });
  const data = await pollLocalTask(
    task,
    (path) => context.fetch(path),
    controller.signal,
    (data) => {
      context.check();
      void updateProgress(task, data).catch(() => controller.abort());
    },
  );
  context.check();
  await finishTask(task, data, context.provider);
}

/** One paid POST per send. The immutable request is saved before the composer clears. */
export function generateVideoRequest(
  request?: VideoDraft,
  resultId?: string,
  accountTokenId?: number | null,
): Promise<void> {
  if (resultId) {
    const key = `${getLocalScope()}:${resultId}`;
    const existing = chatSubmissions.get(key);
    if (existing) return existing;
    const pending = submitVideoRequest(
      request,
      resultId,
      accountTokenId,
    ).finally(() => {
      chatSubmissions.delete(key);
    });
    chatSubmissions.set(key, pending);
    return pending;
  }
  if (submission) return submission;
  submission = submitVideoRequest(request, resultId, accountTokenId).finally(
    () => {
      submission = undefined;
    },
  );
  return submission;
}

async function submitVideoRequest(
  input?: VideoDraft,
  resultId?: string,
  accountTokenId = getLocalTokenId(),
) {
  if (!isLocalWorkspaceActive()) return;
  const owner = getLocalScope();
  await useVideoStore.getState().loadDraft();
  if (!isLocalWorkspaceActive() || getLocalScope() !== owner) return;
  const store = useVideoStore.getState();
  const clearsComposer = !input || input === store.draft;
  const draft = snapshotVideoDraft(input ?? store.draft);
  const draftRevision = store.draftRevision;
  const [model, providerName] = getModelProvider(draft.model);
  const format = videoApiFormat(draft.apiFormat);
  const request = buildVideoRequest(draft, model);
  const sent =
    typeof request.body === "string"
      ? JSON.parse(request.body)
      : Object.fromEntries(request.body.entries());
  const parameterFormat = videoParameterFormat(format, model);
  const parameters =
    parameterFormat === "seedance" || parameterFormat === "gemini"
      ? sent.metadata ?? {}
      : parameterFormat === "xai"
      ? { ...sent.metadata, ...sent }
      : sent;
  const prompt = sent.prompt;
  const duration =
    parameterFormat === "xai"
      ? sent.duration ?? sent.metadata?.duration ?? sent.seconds
      : sent.seconds ?? sent.duration;
  const ratio =
    parameters.aspect_ratio ?? parameters.aspectRatio ?? parameters.ratio;
  const custom = usesCustomProvider(useAccessStore.getState(), providerName);
  const task: LocalTask = {
    id: resultId ?? nanoid(),
    kind: "video",
    upstreamId: "",
    tokenId: custom ? null : accountTokenId,
    ...(custom ? { customApiBase: apiPath("", providerName) } : {}),
    model: typeof sent.model === "string" ? sent.model : model,
    prompt: typeof prompt === "string" ? prompt : draft.prompt,
    createdAt: Date.now(),
    requestStartedAt: Date.now(),
    video: {
      apiFormat: format,
      mode: draft.mode,
      aspectRatio: typeof ratio === "string" ? ratio : undefined,
      resolution:
        typeof (parameters.resolution ?? parameters.resolution_name) ===
        "string"
          ? parameters.resolution ?? parameters.resolution_name
          : undefined,
      duration:
        duration != null && Number.isFinite(Number(duration))
          ? Number(duration)
          : undefined,
      ...(format === "openai" && typeof sent.size === "string"
        ? { size: sent.size }
        : {}),
    },
  };
  const controller = new AbortController();
  const context = contextFor(task, controller);
  let sentPost = false;
  let confirmedFailure = false;
  let clearedRevision: number | undefined;
  return registerWaiting(task.id, controller, async () => {
    try {
      context.check();
      await store.addResult({
        id: task.id,
        url: "",
        prompt: task.prompt,
        model: task.model,
        request: draft,
        status: "pending",
        phase: "submitting",
        createdAt: task.createdAt,
        tokenId: task.tokenId,
        ...(task.customApiBase ? { customApiBase: task.customApiBase } : {}),
        ...(task.video as Pick<
          VideoResult,
          "mode" | "aspectRatio" | "resolution" | "duration" | "size"
        >),
      });
      context.check();
      rememberTask(task);
      if (
        clearsComposer &&
        useVideoStore.getState().draftRevision === draftRevision
      ) {
        store.updateDraft({ prompt: "", materials: [] });
        clearedRevision = useVideoStore.getState().draftRevision;
      }
      store.setGenerateProgress(undefined, "正在提交");
      context.check();
      sentPost = true;
      const response = await context.fetch(request.path, {
        method: "POST",
        body: request.body,
        headers:
          typeof request.body === "string"
            ? { "Content-Type": "application/json" }
            : {},
      });
      const data = await response.json();
      if (!context.owns()) return;
      task.upstreamId = videoTaskId(data, format);
      if (task.upstreamId) rememberTask(task);
      context.check();
      if (!task.upstreamId) {
        const status = String(data.status || "").toLowerCase();
        if (
          ["failed", "failure", "error", "cancelled", "canceled"].includes(
            status,
          )
        ) {
          confirmedFailure = true;
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : data.error?.message || "上游任务已结束，未生成结果",
          );
        }
        if (
          taskResultUrl(data, "video") &&
          ["", "completed", "succeeded", "success"].includes(status)
        ) {
          await finishTask(task, data, context.provider);
          return;
        }
        throw new Error(uncertainSubmission);
      }
      await awaitTask(task, context, controller);
    } catch (error) {
      if (!context.owns()) return;
      if (
        !useVideoStore
          .getState()
          .results.some((result) => result.id === task.id)
      ) {
        forgetTask(task.id);
        return;
      }
      const http = (error as { status?: number })?.status;
      const uncertain =
        sentPost &&
        !confirmedFailure &&
        !task.upstreamId &&
        (!http || http >= 500 || [408, 409, 429].includes(http));
      const retained = pendingTasks().some((item) => item.id === task.id);
      const paused = uncertain || (!!task.upstreamId && retained);
      const message = uncertain
        ? uncertainSubmission
        : controller.signal.aborted
        ? task.upstreamId
          ? "已停止本地等待，上游任务可能仍在继续，可恢复查询。"
          : "已停止等待，生成请求尚未发送。"
        : error instanceof Error
        ? error.message
        : "视频生成失败";
      if (paused) rememberTask({ ...task, paused: true });
      else forgetTask(task.id);
      await store.updateResult(task.id, {
        status: paused ? "pending" : "failed",
        phase: paused ? "paused" : undefined,
        progress: undefined,
        error: message,
        upstreamId: task.upstreamId || undefined,
        ...(paused ? {} : { completedAt: Date.now() }),
      });
      if (
        !paused &&
        clearedRevision !== undefined &&
        useVideoStore.getState().draftRevision === clearedRevision
      )
        store.updateDraft(JSON.parse(JSON.stringify(draft)));
    }
  });
}

/** Stop this tab's wait only; no cancellation request is sent to the provider. */
export function stopVideoWaiting(id: string) {
  const controller = waiting.get(`${getLocalScope()}:${id}`)?.controller;
  const task = pendingTasks().find((item) => item.id === id);
  if (task) rememberTask({ ...task, paused: true });
  controller?.abort();
  const result = useVideoStore
    .getState()
    .results.find((item) => item.id === id);
  if (result?.status === "pending")
    void useVideoStore
      .getState()
      .updateResult(id, {
        phase: "paused",
        error: task?.upstreamId
          ? "已停止本地等待，上游任务可能仍在继续，可恢复查询。"
          : uncertainSubmission,
      })
      .catch(() => {});
}

/** Recover only GET polling, including legacy jobs that predate request snapshots. */
export async function resumeVideoRequest(
  id: string,
  signal?: AbortSignal,
): Promise<void> {
  const existing = waiting.get(`${getLocalScope()}:${id}`);
  if (existing) return existing.promise;
  if (!isLocalWorkspaceActive()) return;
  const owner = getLocalScope();
  await useVideoStore.getState().loadDraft();
  if (signal?.aborted || !isLocalWorkspaceActive() || getLocalScope() !== owner)
    return;
  const result = useVideoStore
    .getState()
    .results.find((item) => item.id === id);
  if (result?.status === "success") return;
  const task =
    pendingTasks().find((item) => item.id === id && item.kind === "video") ??
    (result?.upstreamId
      ? {
          id,
          kind: "video" as const,
          upstreamId: result.upstreamId,
          tokenId: result.tokenId ?? null,
          ...(result.customApiBase
            ? { customApiBase: result.customApiBase }
            : {}),
          model: result.model,
          prompt: result.prompt,
          createdAt: result.createdAt,
          video: {
            apiFormat: result.request?.apiFormat,
            mode: result.mode ?? "text-to-video",
            aspectRatio: result.aspectRatio,
            resolution: result.resolution,
            duration: result.duration,
            size: result.size,
          },
        }
      : undefined);
  if (!task?.upstreamId) {
    await useVideoStore.getState().updateResult(id, {
      phase: "paused",
      error: uncertainSubmission,
    });
    return;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const context = contextFor(task, controller);
  return registerWaiting(id, controller, async () => {
    if (context.owns()) rememberTask({ ...task, paused: true });
    try {
      await awaitTask(task, context, controller);
    } catch (error) {
      if (!context.owns()) return;
      if (
        !useVideoStore.getState().results.some((result) => result.id === id)
      ) {
        forgetTask(id);
        return;
      }
      const retained = pendingTasks().some((item) => item.id === id);
      if (retained) rememberTask({ ...task, paused: true });
      await useVideoStore.getState().updateResult(id, {
        status: retained ? "pending" : "failed",
        phase: retained ? "paused" : undefined,
        progress: undefined,
        error: controller.signal.aborted
          ? "已停止本地等待，上游任务可能仍在继续，可恢复查询。"
          : error instanceof Error
          ? error.message
          : "视频查询中断，任务已保留。",
        ...(retained ? {} : { completedAt: Date.now() }),
      });
    }
  }).finally(() => signal?.removeEventListener("abort", abort));
}

/** Restore a copy into the composer; this never starts a generation. */
export async function reuseVideoRequest(id: string): Promise<boolean> {
  if (!isLocalWorkspaceActive()) return false;
  const owner = getLocalScope();
  await useVideoStore.getState().loadDraft();
  if (!isLocalWorkspaceActive() || getLocalScope() !== owner) return false;
  const result = useVideoStore
    .getState()
    .results.find((item) => item.id === id);
  if (!result) return false;
  const taskFormat = pendingTasks().find((task) => task.id === id)?.video
    ?.apiFormat;
  const patch: Partial<VideoDraft> = result.request
    ? JSON.parse(JSON.stringify(result.request))
    : {
        prompt: result.prompt,
        model: result.model,
        ...Object.fromEntries(
          Object.entries({
            mode: result.mode,
            size: result.size,
            aspectRatio: result.aspectRatio,
            resolution: result.resolution,
            duration: result.duration,
            apiFormat: ["openai", "xai", "seedance", "gemini"].includes(
              taskFormat ?? "",
            )
              ? taskFormat
              : undefined,
          }).filter(([, value]) => value !== undefined),
        ),
      };
  useVideoStore.getState().updateDraft(patch);
  return true;
}
