import type { ModelConfig } from "../store/config";
import { DEFAULT_CONFIG } from "../store/config";
import { StoreKey } from "../constant";
import { getImageMetadata } from "../store/gallery";
import { DEFAULT_DRAFT, useVideoStore, type VideoDraft } from "../store/video";
import { chatVideoConfig } from "./chat-video";
import {
  hasDeferredChatAssets,
  loadChatSessionAssets,
  restoreChatAssets,
} from "./chat-persistence";
import { messageGeneration } from "./community-share";
import type { ParsedFile } from "./file-upload";
import { imageGenerationConfig, imageRatio } from "./image-params";
import {
  getLocalScope,
  isLocalWorkspaceActive,
  localKey,
  type LocalScope,
} from "./local-workspace";

export type GalleryReuseTarget = {
  kind: "image" | "video";
  id: string;
  scope: LocalScope;
};

export type GenerationReuse = {
  prompt: string;
  model: string;
  config: Partial<ModelConfig>;
  images: string[];
  files: ParsedFile[];
  sourceWorkId?: string;
  incomplete?: boolean;
};

export function videoGenerationReuse(request: VideoDraft): GenerationReuse {
  return {
    prompt: request.prompt,
    model: request.model,
    config: { videoConfig: chatVideoConfig(request) },
    sourceWorkId: request.sourceWorkId,
    images: request.materials
      .filter((item) => item.type === "image")
      .map((item) => item.url),
    files: request.materials
      .filter((item) => item.type !== "image")
      .map((item) => ({
        name: item.name,
        type:
          /^data:([^;,]+)/.exec(item.url)?.[1] ||
          `${item.type}/${item.type === "video" ? "mp4" : "mpeg"}`,
        size: 0,
        content: item.url,
        isText: false,
      })),
  };
}

export async function readGalleryReuse(
  target: GalleryReuseTarget,
): Promise<GenerationReuse> {
  const check = () => {
    if (!isLocalWorkspaceActive() || target.scope !== getLocalScope())
      throw new Error("账号已变化，请重新打开作品库。");
  };
  check();
  if (target.kind === "video") {
    await useVideoStore.getState().loadDraft();
    check();
    const result = useVideoStore
      .getState()
      .results.find((item) => item.id === target.id);
    if (!result) throw new Error("视频记录已不可用，请刷新作品库。");
    const request = result.request ?? {
      ...DEFAULT_DRAFT,
      prompt: result.prompt,
      model: result.model,
      mode: result.mode ?? DEFAULT_DRAFT.mode,
      size: result.size ?? "auto",
      aspectRatio: result.aspectRatio ?? "auto",
      resolution: result.resolution ?? "auto",
      duration: result.duration ?? DEFAULT_DRAFT.duration,
      materials: [],
    };
    return {
      ...videoGenerationReuse(request),
      incomplete: !result.request,
    };
  }
  if (target.kind !== "image")
    throw new Error("无法识别此作品，请刷新作品库。");
  const image = await getImageMetadata(target.id, target.scope);
  check();
  if (!image) throw new Error("图片记录已不可用，请刷新作品库。");
  let original: ReturnType<typeof messageGeneration>;
  if (!image.config || image.references === undefined || !image.model) {
    const { useChatStore } = await import("../store/chat");
    check();
    for (const session of useChatStore.getState().sessions) {
      const message = session.messages.find(
        (item) =>
          item.role === "assistant" &&
          (item.id === image.id ||
            (image.id.startsWith(`${item.id}-`) &&
              /^\d+$/.test(image.id.slice(item.id.length + 1)))),
      );
      if (!message) continue;
      original = messageGeneration(session.messages, message.id);
      if (!original) continue;
      if (
        image.references === undefined &&
        hasDeferredChatAssets(original.references)
      ) {
        const loaded = await loadChatSessionAssets(
          localKey(StoreKey.Chat, target.scope),
          session,
        );
        check();
        const restored = restoreChatAssets(session, loaded);
        original = messageGeneration(restored.messages, message.id);
        if (hasDeferredChatAssets(original?.references))
          throw new Error("原参考素材尚未恢复，请重新打开作品库后重试。");
      }
      break;
    }
  }
  const config = image.config ?? original?.config;
  const parameters = {
    ...imageGenerationConfig(DEFAULT_CONFIG.modelConfig),
    ...imageGenerationConfig(
      config ?? {
        size: imageRatio(`${image.width}x${image.height}`),
      },
    ),
  };
  if (!config?.providerName) delete parameters.providerName;
  return {
    prompt: image.prompt,
    model: image.model || original?.model || "",
    config: parameters,
    images: [...(image.references ?? original?.references ?? [])],
    files: [],
    sourceWorkId: image.sourceWorkId ?? original?.sourceWorkId,
    incomplete: !config,
  };
}
