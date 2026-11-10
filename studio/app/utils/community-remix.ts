import { useEffect, useRef, useSyncExternalStore } from "react";
import { readMedia } from "./community-share";
export type RemixWork = { requestId: string; sourceWorkId: string; kind: "image" | "video" | "text"; prompt: string; model: string; references: { url: string; name: string }[] };
export type RemixDraft = { sessionId: string; images: string[] };
type Task = { work: RemixWork; busy: boolean; signal: AbortSignal; draft?: RemixDraft; applied?: boolean; finish: (message?: string) => void };
const listeners = new Set<() => void>();
let pending: Task | undefined;
let revision = 0;
const notify = () => { revision++; listeners.forEach(listener => listener()); };
const snapshot = () => revision;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function installCommunityRemix(origin: string, identity: { context: string; attempt: string; subject: string; userId: string }) {
 const controller = new AbortController(), applied = new Set<string>();
 const send = (work: RemixWork, message?: string) => window.parent.postMessage({ type: "community-studio", ...identity, status: message ? "remix-error" : "remix-applied", requestId: work.requestId, ...(message ? { message } : {}) }, origin);
 const receive = (event: MessageEvent) => {
  const data = event.data;
  if (event.origin !== origin || event.source !== window.parent || data?.type !== "community-remix" || Object.entries(identity).some(([key, value]) => data[key] !== value)) return;
  const work = data.work as RemixWork;
  if (!work || typeof work.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(work.requestId) || typeof work.sourceWorkId !== "string" || !/^[a-zA-Z0-9]{1,32}$/.test(work.sourceWorkId) || !["image", "video", "text"].includes(work.kind) || typeof work.prompt !== "string" || work.prompt.length > 100000 || typeof work.model !== "string" || work.model.length > 100 || !Array.isArray(work.references) || work.references.length > 16 || work.references.some(item => !item || typeof item.name !== "string" || typeof item.url !== "string" || !/^https?:\/\//.test(item.url))) return;
  if (applied.has(work.requestId)) { send(work); return; }
  if (pending) { if (pending.work.requestId !== work.requestId) send(work, "另一份同款正在填入，请稍后重试。"); return; }
  const task: Task = { work, busy: false, signal: controller.signal, finish(message) { if (pending !== task || controller.signal.aborted) return; if (!message) applied.add(work.requestId); pending = undefined; notify(); send(work, message); } };
  pending = task;
  window.location.hash = "/chat";
  notify();
 };
 window.addEventListener("message", receive);
 return () => { controller.abort(); if (pending?.signal === controller.signal) { pending = undefined; notify(); } window.removeEventListener("message", receive); };
}
export function useCommunityRemix(kind: "chat" | "video", readiness: boolean | "idle" | "loading" | "ready" | "error", apply: (work: RemixWork, check: () => void) => Promise<void | RemixDraft>) {
 const ready = readiness === true || readiness === "ready" || readiness === "error";
 const mounted = useRef(false);
 useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
 const version = useSyncExternalStore(subscribe, snapshot, () => 0);
 const task = pending;
 const callback = useRef(apply); callback.current = apply;
 useEffect(() => {
  if (!ready || !task || task.busy || kind !== "chat") return;
  task.busy = true;
  const check = () => { if (!mounted.current || pending !== task || task.signal.aborted) throw new Error("制作账号已变化，请重新打开同款。"); };
  void callback.current(task.work, check).then(draft => {
   if (draft) {
    // Changing the session intentionally unmounts the preparing component.
    // Only its target composer may apply and acknowledge the prepared draft.
    if (pending !== task || task.signal.aborted) return;
    task.draft = draft; notify();
   } else { check(); task.finish(); }
  }).catch(error => task.finish(error instanceof Error ? error.message : "无法填入，请重试。"));
 }, [ready, task, kind, version]);
}

/** A handoff lives only in this authenticated bridge, never in another account's storage. */
export function useCommunityRemixDraft(sessionId: string, prompt: string, images: string[], apply: (work: RemixWork, images: string[]) => void) {
 const version = useSyncExternalStore(subscribe, snapshot, () => 0);
 const callback = useRef(apply); callback.current = apply;
 useEffect(() => {
  const task = pending, draft = task?.draft;
  if (!task || !draft || draft.sessionId !== sessionId || task.signal.aborted) return;
  if (!task.applied) {
   task.applied = true;
   try { callback.current(task.work, draft.images); }
   catch (error) { task.finish(error instanceof Error ? error.message : "无法填入，请重试。"); }
  } else if (prompt === task.work.prompt && images.length === draft.images.length && images.every((image, index) => image === draft.images[index])) {
   task.finish();
  }
 }, [sessionId, prompt, images, version]);
}
export async function remixImages(work: RemixWork, check: () => void) {
 const images: string[] = [];
 const controller = new AbortController();
 const timeout = setTimeout(() => controller.abort(), 45000);
 try {
  for (const reference of work.references) {
   check(); const blob = await readMedia(reference.url, "image", 32 * 1024 * 1024, controller.signal); check();
   images.push(await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("参考图无法读取，请重试或取消该参考图。")); reader.readAsDataURL(blob); }));
  }
  check(); return images;
 } finally { clearTimeout(timeout); }
}
