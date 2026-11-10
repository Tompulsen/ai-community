import { getClientApi } from "../client/api";
import { ImageGenerationService } from "../client/image-generation";
import { ChatControllerPool } from "../client/controller";
import { createMessage, useChatStore, type ChatSession } from "../store/chat";
import { useAppConfig } from "../store/config";
import { useAccessStore } from "../store/access";
import { useVideoStore } from "../store/video";
import { DEFAULT_INPUT_TEMPLATE } from "../constant";
import { remixImages, type RemixWork } from "./community-remix";
import { messageShareSource, readMedia } from "./community-share";
import { getLocalScope, getLocalTokenId, isLocalWorkspaceActive, localKey, flushLocalWrites } from "./local-workspace";
import { getModelCapabilities } from "./model-capabilities";
import { CUSTOM_MODEL_PROVIDER } from "./custom-provider";
import { pendingTasks } from "./local-tasks";
import { chatVideoDraft } from "./chat-video";
import { generateVideoRequest } from "./video-generation";
import { fetchVideoMedia } from "./video-media";

type Identity = { context: string; attempt: string; subject: string; userId: string };
export type BackgroundSnapshot = { id: string; sessionId: string; kind: "image" | "video"; title: string; model: string; createdAt: number; state: "running" | "complete" | "error"; message?: string };

export function validBackgroundWork(work: any): work is RemixWork {
  return !!work && /^[a-f0-9-]{36}$/i.test(work.requestId) && /^[a-zA-Z0-9]{1,32}$/.test(work.sourceWorkId)
    && ["image", "video"].includes(work.kind) && typeof work.prompt === "string" && !!work.prompt.trim() && work.prompt.length <= 100000
    && typeof work.model === "string" && work.model.length <= 100 && Array.isArray(work.references) && work.references.length <= 16
    && work.references.every((file: any) => file && typeof file.name === "string" && typeof file.url === "string" && /^https?:\/\//.test(file.url));
}

export function backgroundSnapshot(session: ChatSession): BackgroundSnapshot {
  const answer = session.messages.find(message => message.role === "assistant");
  const task = pendingTasks().find(task => task.messageId === answer?.id || task.id === answer?.videoResultId);
  const video = answer?.videoResultId ? useVideoStore.getState().results.find(result => result.id === answer.videoResultId) : undefined;
  const media = answer && (typeof answer.content === "string" || Array.isArray(answer.content)) ? messageShareSource(answer.content, "", "").media : [];
  const complete = session.creationKind === "video" ? video?.status === "success" : (session.backgroundRemixCompleted || answer?.gallerySave === "saved" || !!media?.length) && !answer?.streaming && !answer?.isError;
  const waiting = video?.status === "pending" ? video.phase !== "paused" : task ? !task.needsAttention && !task.paused : !!answer?.streaming;
  return {
    id: session.backgroundRemixRequestId!, sessionId: session.id, kind: session.creationKind === "video" ? "video" : "image",
    title: session.topic, model: session.mask.modelConfig.model, createdAt: session.lastUpdate,
    state: complete ? "complete" : waiting ? "running" : "error",
    ...(!complete && !waiting ? { message: video?.error || (answer?.isError && typeof answer.content === "string" ? answer.content : "查询已中断，请到 AI 工作台恢复查询。") } : {}),
  };
}

/** Installed only inside the independently authenticated, single persistent studio. */
export function installCommunityBackground(origin: string, identity: Identity) {
  const controller = new AbortController();
  const owner = `user-${identity.subject}`;
  const services = new Set<ImageGenerationService>();
  const submitting = new Set<string>();
  let lastSnapshot = "";
  const current = () => !controller.signal.aborted && useChatStore.getState()._hasHydrated && isLocalWorkspaceActive() && getLocalScope() === owner;
  const check = () => { if (!current()) throw new Error("创作账号已变化，请重新连接工作台。"); };
  const send = (data: object) => { if (!controller.signal.aborted) window.parent.postMessage({ type: "community-studio", ...identity, ...data }, origin); };
  const sessions = () => useChatStore.getState().sessions.filter(session => session.backgroundRemixRequestId).slice(0, 50);
  const snapshot = (force = false) => {
    if (!current()) return;
    const tasks = sessions().map(backgroundSnapshot), serialized = JSON.stringify(tasks);
    if (force || lastSnapshot !== serialized) { lastSnapshot = serialized; send({ status: "background-tasks", tasks }); }
  };
  const submit = async (work: RemixWork) => {
    check();
    const key = localKey(`background-remix:${work.requestId}`);
    if (sessions().some(session => session.backgroundRemixRequestId === work.requestId)) { snapshot(true); return; }
    // A lost acknowledgement must never become a second paid generation, even after reload.
    if (localStorage.getItem(key)) throw new Error("此任务已提交，请到工作台检查记录；不会重复扣费生成。");
    const tokenId = getLocalTokenId();
    await useAccessStore.getState().fetch(); check();
    if (localStorage.getItem(key)) { snapshot(true); return; }
    const model = useAppConfig.getState().models.find(model => model.available && model.name === work.model && model.provider?.providerName !== CUSTOM_MODEL_PROVIDER);
    if (!model) throw new Error("原作品模型未记录或当前不可用，请前往 AI 工作台选择模型。");
    const provider = model.provider.providerName;
    const capabilities = getModelCapabilities(work.model, provider);
    if (capabilities.category !== work.kind || (work.kind === "image" && !capabilities.usesImageApi)) throw new Error("该模型暂不支持此类后台生成，请前往 AI 工作台调整模型。");
    check();
    const store = useChatStore.getState(), session = store.newSession(undefined, undefined, false);
    if (!session) throw new Error("工作台尚未准备好，请稍后重试。");
    const user = createMessage({ role: "user", content: work.prompt });
    const answer = createMessage({ role: "assistant", content: "正在准备生成…", streaming: true, model: work.model, generation: { prompt: work.prompt, model: work.model, references: [], sourceWorkId: work.sourceWorkId } });
    store.updateTargetSession(session, target => {
      target.backgroundRemixRequestId = work.requestId; target.creationKind = work.kind;
      target.remixSourceWorkId = work.sourceWorkId; target.topic = work.prompt.trim().split("\n")[0].slice(0, 60);
      target.mask.syncGlobalConfig = false; target.mask.context = [];
      target.mask.modelConfig = { ...target.mask.modelConfig, model: work.model, providerName: provider, template: DEFAULT_INPUT_TEMPLATE, imageRequestMode: "async", imageStream: false };
      target.messages = [user, answer];
    });
    const update = (patch: Partial<typeof answer>) => { if (current()) store.updateTargetSession(session, target => { target.messages = target.messages.map(message => message.id === answer.id ? { ...message, ...patch } : message); }); };
    try {
      localStorage.setItem(key, session.id);
      await flushLocalWrites(); check();
      const references = await remixImages(work, check); check();
      store.updateTargetSession(session, target => {
        target.messages[0].content = [{ type: "text", text: work.prompt }, ...references.map(url => ({ type: "image_url" as const, image_url: { url } }))];
        target.messages[1].generation!.references = references;
      });
      if (work.kind === "video") {
        const draft = chatVideoDraft(work.prompt, work.model, provider, references, work.sourceWorkId);
        update({ videoResultId: answer.id });
        await generateVideoRequest(draft, answer.id, tokenId);
        check(); update({ streaming: false });
      } else {
        const service = new ImageGenerationService(getClientApi(provider).llm); services.add(service);
        service.setCallbacks({
          onComplete: (url, urls = [url]) => {
            if (!current()) return;
            store.updateTargetSession(session, target => { target.backgroundRemixCompleted = true; });
            update({ content: urls.map(url => `![Generated Image](${url})`).join("\n\n"), streaming: false, interrupted: false, isError: false });
            void store.saveGeneratedImage(session.id, answer.id, urls, work.prompt, work.model);
          },
          onError: message => update({ content: message, streaming: false, isError: true }),
        });
        try {
          await service.generateImage({
            accountTokenId: tokenId, taskContext: { sessionId: session.id, messageId: answer.id }, modelCapabilities: capabilities,
            messages: [{ role: "user", content: work.prompt }], config: session.mask.modelConfig,
            onController: value => ChatControllerPool.addController(session.id, answer.id, value), onFinish: () => {},
          }, { referenceImages: references, requestMode: "async" });
        } finally { services.delete(service); ChatControllerPool.remove(session.id, answer.id); }
      }
    } catch (error) { update({ streaming: false, isError: true, content: error instanceof Error ? error.message : "后台生成失败，请到工作台查看。" }); }
    snapshot(true);
  };
  const receive = async (event: MessageEvent) => {
    const data = event.data;
    if (event.origin !== origin || event.source !== window.parent || data?.type !== "community-background" || Object.entries(identity).some(([key, value]) => data[key] !== value)) return;
    try {
      check();
      if (data.action === "submit" && validBackgroundWork(data.work)) {
        if (submitting.has(data.work.requestId)) { snapshot(true); return; }
        submitting.add(data.work.requestId);
        try { await submit(data.work); } finally { submitting.delete(data.work.requestId); }
        return;
      }
      if (data.action === "list") { snapshot(true); return; }
      const session = sessions().find(session => session.backgroundRemixRequestId === data.requestId);
      if (!session) throw new Error("找不到这份后台任务，请到工作台查看历史记录。");
      if (data.action === "open") {
        await useChatStore.getState().selectSession(useChatStore.getState().sessions.findIndex(item => item.id === session.id)); check();
        window.location.hash = "/chat"; send({ status: "background-opened", requestId: data.requestId }); return;
      }
      if (data.action === "result") {
        await useChatStore.getState().restoreSessionAssets(session.id); check();
        const restored = useChatStore.getState().sessions.find(item => item.id === session.id)!;
        if (backgroundSnapshot(restored).state !== "complete") throw new Error("作品尚未生成完成，请稍后查看。");
        const answer = restored.messages.find(message => message.role === "assistant")!;
        const video = useVideoStore.getState().results.find(result => result.id === answer.videoResultId);
        const blobs: Blob[] = [];
        if (video) blobs.push(video.mediaPath ? await fetchVideoMedia(video, controller.signal) : await readMedia(video.url, "video", 256 * 1024 * 1024, controller.signal));
        else for (const media of messageShareSource(answer.content, "", "").media ?? []) blobs.push(await readMedia(media.url!, "image", 32 * 1024 * 1024, controller.signal));
        check(); send({ status: "background-result", requestId: data.requestId, files: blobs });
      }
    } catch (error) { send({ status: "background-error", requestId: data.work?.requestId ?? data.requestId, action: data.action, message: error instanceof Error ? error.message : "无法连接生成任务，请前往工作台重试。" }); }
  };
  const unsubscribeChat = useChatStore.subscribe(() => snapshot());
  const unsubscribeVideo = useVideoStore.subscribe(() => snapshot());
  // Recovery can update only local task metadata after a query failure.
  const recoveryTimer = setInterval(() => snapshot(), 5000);
  window.addEventListener("message", receive);
  return () => { controller.abort(); clearInterval(recoveryTimer); services.forEach(service => service.cancel()); unsubscribeChat(); unsubscribeVideo(); window.removeEventListener("message", receive); };
}
