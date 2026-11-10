import type { ChatMessage } from "../store/chat";
export type ShareLimits = { image: number; video: number; document: number };
export type ShareSource = {
  kind: "image" | "video" | "resource";
  prompt: string;
  model: string;
  text?: string;
  references?: { url?: string; blob?: () => Promise<Blob> }[];
  sourceWorkId?: string;
  media?: { url?: string; blob?: () => Promise<Blob> }[];
};
export type ShareIntent = { destination?: "community" | "source-comment"; resultId?: string; sourceWorkId?: string };
export type ShareWork = {
  destination?: ShareIntent["destination"];
  resultId?: string;
  category: ShareSource["kind"];
  title: string;
  text: string;
  model: string;
  generation?: { prompt: string; model: string; sourceWorkId?: string };
  files: { name: string; blob: Blob; role?: "reference" }[];
};

type Identity = { context: string; attempt: string; subject: string; userId: string };
type Provider = (limits: ShareLimits, signal: AbortSignal) => Promise<ShareWork>;
const listeners = new Set<() => void>();
let bridge: ((provider: Provider, intent?: ShareIntent) => Promise<string>) | undefined;
let busy = false;
const changed = () => listeners.forEach((listener) => listener());
export const subscribeShare = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const shareState = () => bridge ? (busy ? "busy" : "ready") : "unavailable";

/** Registered only after the embedded account has been independently verified. */
export function installCommunityShare(origin: string, identity: Identity) {
  let pending: { id: string; controller: AbortController; resolve: (value: string) => void; reject: (error: Error) => void; provider: Provider; phase: string; timer?: ReturnType<typeof setTimeout> } | undefined;
  const send = (data: object) => window.parent.postMessage({ type: "community-studio", ...identity, ...data }, origin);
  const settle = (outcome: string, error?: string) => {
    const task = pending;
    if (!task) return;
    pending = undefined;
    clearTimeout(task.timer);
    task.controller.abort();
    busy = false; changed();
    if (error) task.reject(new Error(error)); else task.resolve(outcome);
  };
  const timeout = (ms: number) => {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      send({ status: "share-cancel", requestId: pending?.id });
      settle("error", "timeout");
    }, ms);
  };
  const receive = async (event: MessageEvent) => {
    const data = event.data, task = pending;
    if (!task || event.origin !== origin || event.source !== window.parent || !data || data.type !== "community-share-response" || data.context !== identity.context || data.attempt !== identity.attempt || data.subject !== identity.subject || data.userId !== identity.userId || data.requestId !== task.id) return;
    if (data.phase === "ready" && task.phase === "waiting") {
      const limits = data.limits as ShareLimits;
      if (!limits || ![limits.image, limits.video, limits.document].every((limit) => Number.isSafeInteger(limit) && limit > 0 && limit <= 10 * 1024 ** 3)) { settle("error", "invalid"); return; }
      task.phase = "preparing"; timeout(180000);
      try {
        const work = await task.provider(limits, task.controller.signal);
        if (pending !== task || task.controller.signal.aborted) return;
        task.phase = "uploading";
        send({ status: "share-content", requestId: task.id, work });
        timeout(180000);
      } catch (error) {
        if (pending !== task) return;
        send({ status: "share-cancel", requestId: task.id });
        settle("error", error instanceof Error ? error.message : "media");
      }
    } else if (["uploading", "editing", "retry"].includes(data.phase) && task.phase === "uploading") {
      // The community owns upload retries and the user's editing time.
      clearTimeout(task.timer);
    } else if (data.phase === "finished") {
      settle(data.outcome, data.outcome === "error" ? String(data.code || "failed") : undefined);
    }
  };
  const share = (provider: Provider, intent: ShareIntent = {}) => {
    if (pending) return Promise.reject(new Error("busy"));
    busy = true; changed();
    return new Promise<string>((resolve, reject) => {
      pending = { id: crypto.randomUUID(), controller: new AbortController(), resolve, reject, provider, phase: "waiting" };
      send({ status: "share-request", requestId: pending.id, ...intent });
      timeout(15000);
    });
  };
  bridge = share; changed();
  window.addEventListener("message", receive);
  return () => {
    settle("canceled");
    if (bridge === share) bridge = undefined;
    changed(); window.removeEventListener("message", receive);
  };
}

export function shareToCommunity(provider: Provider, intent: ShareIntent = {}) {
  if (!bridge) return Promise.reject(new Error("unavailable"));
  return bridge(provider, intent);
}

export async function readMedia(url: string, kind: "image" | "video", limit: number, signal: AbortSignal) {
  const target = new URL(url, window.location.href);
  const local = target.origin === window.location.origin && ["blob:", "http:", "https:"].includes(target.protocol);
  const data = target.protocol === "data:" && url.startsWith(`data:${kind}/`);
  if (!local && !data && !["http:", "https:"].includes(target.protocol)) throw new Error("media");
  // Reject oversized data URLs before decoding. Blob and network bodies are read in bounded chunks.
  if (data && url.length > limit * 1.4 + 1024) throw new Error("tooLarge");
  const response = local || data
    ? await fetch(url, { signal, credentials: local && target.protocol !== "blob:" ? "same-origin" : "omit" })
    : await fetch("/studio/api/community-share/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, kind, maxBytes: limit }), signal });
  if (!response.ok) throw new Error(response.status === 413 ? "tooLarge" : "media");
  const type = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!type.startsWith(`${kind}/`)) { await response.body?.cancel(); throw new Error("media"); }
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("tooLarge"); }
  if (!response.body) throw new Error("media");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > limit) throw new Error("tooLarge");
      chunks.push(item.value);
    }
    if (!size) throw new Error("media");
    return new Blob(chunks, { type });
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function prepareShare(source: ShareSource, limits: ShareLimits, signal: AbortSignal, intent: ShareIntent = {}): Promise<ShareWork> {
  if (intent.destination === "source-comment" && source.kind === "video") throw new Error("videoComment");
  if (intent.destination === "source-comment" && (!intent.resultId || !source.sourceWorkId || source.sourceWorkId !== intent.sourceWorkId || !source.model.trim())) throw new Error("invalid");
  const direct = intent.destination === "source-comment";
  const media = source.media || [];
  if (media.length > 16) throw new Error("tooMany");
  const text = (source.kind === "resource" ? source.text || "" : direct ? "我用同款提示词创作了新作品" : source.prompt).trim();
  const work: ShareWork = { destination: intent.destination ?? "community", resultId: intent.resultId, category: source.kind, title: (direct ? "我的同款作品" : source.prompt.trim() || text).split("\n")[0].slice(0, 100), text: text.slice(0, 2500), model: source.model.slice(0, 100), files: [] };
  if (text.length > 2500) {
    const blob = new Blob([text], { type: "text/markdown" });
    if (blob.size > limits.document) throw new Error("tooLarge");
    work.files.push({ name: source.kind === "resource" ? "creation.md" : "prompt.md", blob });
  }
  for (const [index, item] of media.entries()) {
    signal.throwIfAborted();
    const kind = source.kind === "video" ? "video" : "image";
    const blob = item.blob ? await item.blob() : await readMedia(item.url || "", kind, limits[kind], signal);
    signal.throwIfAborted();
    if (!blob.size || !blob.type.startsWith(`${kind}/`)) throw new Error("media");
    if (blob.size > limits[kind]) throw new Error("tooLarge");
    const extension = ({ "image/jpeg": "jpg", "video/quicktime": "mov" } as Record<string, string>)[blob.type] || blob.type.split("/")[1].replace(/[^a-z0-9]/g, "");
    work.files.push({ name: `creation-${index + 1}.${extension}`, blob });
  }
  if (work.files.length > 16 || (!direct && (source.references?.length ?? 0) > 16)) throw new Error("tooMany");
  if (source.prompt.length > 100000) throw new Error("tooLarge");
  if (source.model) work.generation = { prompt: source.prompt, model: source.model.slice(0, 100), ...(source.sourceWorkId ? { sourceWorkId: source.sourceWorkId } : {}) };
  for (const [index, item] of (direct ? [] : source.references ?? []).entries()) {
    signal.throwIfAborted();
    const blob = item.blob ? await item.blob() : await readMedia(item.url || "", "image", limits.image, signal);
    signal.throwIfAborted();
    if (!blob.type.startsWith("image/") || !blob.size) throw new Error("media");
    if (blob.size > limits.image) throw new Error("tooLarge");
    work.files.push({ name: `reference-${index + 1}.${blob.type.split("/")[1]}`, blob, role: "reference" });
  }
  if (source.kind !== "resource" && !media.length) throw new Error("media");
  if (!text && !work.files.length) throw new Error("empty");
  return work;
}

/** Only the selected assistant answer; never hidden reasoning, credentials or the conversation history. */
export function messageShareSource(content: string | { type: string; text?: string; image_url?: { url: string }; video_url?: { url: string } }[], prompt: string, model: string): ShareSource {
  let text = typeof content === "string" ? content : content.filter((part) => part.type === "text").map((part) => part.text || "").join("\n");
  const images = typeof content === "string" ? [] : content.filter((part) => part.type === "image_url").map((part) => part.image_url?.url || "").filter(Boolean);
  const videos = typeof content === "string" ? [] : content.filter((part) => part.type === "video_url").map((part) => part.video_url?.url || "").filter(Boolean);
  text = text.replace(/!\[[^\]]*\]\((<?(?:https?:\/\/|data:image\/|blob:|\/)[^\s]+>?)\)/g, (_all, url: string) => { images.push(url.replace(/^<|>$/g, "")); return ""; }).trim();
  return { kind: videos.length ? "video" : images.length ? "image" : "resource", prompt, model, text, media: [...new Set(videos.length ? videos : images)].map((url) => ({ url })) };
}

/** Extract only image-reference fields from the final serialized video request. */
export function videoReferenceSources(body: string | FormData): NonNullable<ShareSource["references"]> {
  const result: NonNullable<ShareSource["references"]> = [], seen = new Set<string>();
  const image = (value: unknown) => {
    if (typeof value !== "string" || !/^(https?:\/\/|data:image\/|blob:)/.test(value) || seen.has(value)) return;
    seen.add(value); result.push({ url: value });
  };
  const reference = (value: any): void => {
    if (value instanceof Blob) { const blob = value; result.push({ blob: async () => blob }); return; }
    if (typeof value === "string") { if (value.startsWith("{") || value.startsWith("[")) { try { reference(JSON.parse(value)); } catch {} } else image(value); return; }
    if (Array.isArray(value)) { value.forEach(reference); return; }
    if (value && typeof value === "object") { image(value.url); if (value.image_url) reference(value.image_url); }
  };
  const fields = (data: any, depth = 0) => {
    if (depth > 4) return;
    if (typeof data === "string") { try { fields(JSON.parse(data), depth + 1); } catch {} return; }
    if (!data || typeof data !== "object") return;
    for (const key of ["input_reference", "images", "reference_images", "last_frame", "first_frame", "keyframes"]) reference(data[key]);
    if (Array.isArray(data.content)) data.content.filter((item: any) => item.type === "image_url").forEach(reference);
    if (data.keyframes && !Array.isArray(data.keyframes) && typeof data.keyframes === "object") {
      for (const [slot, value] of Object.entries(data.keyframes)) if (/^frame[0-9]+$/.test(slot)) reference(value);
    }
    if (data.metadata) fields(data.metadata, depth + 1);
  };
  if (typeof body === "string") fields(JSON.parse(body));
  else fields(Object.fromEntries(body.entries()));
  return result;
}

/** Older gallery entries use the exact saved assistant ID to recover their input. */
export function messageGeneration(messages: ChatMessage[], messageId: string): ChatMessage["generation"] {
  const index = messages.findIndex(message => message.id === messageId && message.role === "assistant");
  if (index < 0) return undefined;
  const message = messages[index];
  if (message.generation) return message.generation;
  const parent = message.parentId
    ? messages.find(item => item.id === message.parentId && item.role === "user")
    : messages.slice(0, index).reverse().find(item => item.role === "user");
  if (!parent) return undefined;
  return {
    prompt: typeof parent.content === "string" ? parent.content : parent.content.filter(part => part.type === "text").map(part => part.text || "").join("\n"),
    model: message.model || "",
    references: Array.isArray(parent.content) ? parent.content.filter(part => part.type === "image_url").map(part => part.image_url?.url || "").filter(Boolean) : [],
  };
}

/** Custom request fields can override the visible video draft. Preserve what was submitted. */
export function videoGenerationMetadata(body: string | FormData, fallback: { prompt: string; model: string }) {
  const data = typeof body === "string" ? JSON.parse(body) : Object.fromEntries(body.entries());
  return {
    prompt: typeof data.prompt === "string" ? data.prompt : fallback.prompt,
    model: typeof data.model === "string" ? data.model : fallback.model,
    references: videoReferenceSources(body),
  };
}
