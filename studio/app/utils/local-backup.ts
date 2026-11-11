import { z } from "zod";
import { nanoid } from "nanoid";
import type { ChatSession } from "../store/chat";
import { get, set } from "./studio-keyval";
import {
  addImage,
  getAllImages,
  getImageBlob,
  releaseGalleryImages,
} from "../store/gallery";
import {
  localKey,
  initializeLocalWorkspace,
  beginLocalMaintenance,
  endLocalMaintenance,
  type LocalScope,
  flushLocalWrites,
} from "./local-workspace";
import { ChatControllerPool } from "../client/controller";
import { ApiPath, StoreKey } from "../constant";
import { CHAT_API_FORMATS } from "./chat-api-format";
import { migrateChatParams } from "./chat-params";
import { getMotionPreference } from "./motion";
import {
  chatProjectSchema,
  normalizeChatProjects,
  normalizeChatProjectSessions,
} from "./chat-projects";
import { customApiPath } from "./custom-provider";
import { isVideoMediaPath } from "./video-api";
import { skillCollectionSchema } from "../skills/catalog";
import { indexedDBStorage } from "./indexedDB-storage";
import { readChatSnapshot, writeChatSnapshot } from "./chat-persistence";
import {
  modelApiFormatsSchema,
  modelTypeOverridesSchema,
} from "./model-preferences";
import {
  messageInteractionsSchema,
  messageOptionResponseSchema,
} from "./message-interactions";
import { readVideoResults, writeVideoResults } from "../store/video";

const tokenCountSchema = z.number().int().nonnegative().safe();
const messageSchema = z.object({
  id: z.string().min(1).max(200).optional(),
  parentId: z.string().min(1).max(200).optional(),
  branchOrder: z.number().int().nonnegative().optional(),
  reasoning: z.string().optional(),
  imageId: z.string().min(1).max(200).optional(),
  role: z.enum(["system", "user", "assistant"]),
  content: z.union([
    z.string(),
    z.array(
      z.object({
        type: z.enum(["text", "image_url", "video_url", "input_audio", "file"]),
        text: z.string().optional(),
        image_url: z.object({ url: z.string() }).optional(),
        video_url: z.object({ url: z.string() }).optional(),
        input_audio: z
          .object({ data: z.string(), format: z.string() })
          .optional(),
        file: z
          .object({ filename: z.string(), file_data: z.string() })
          .optional(),
      }),
    ),
  ]),
  date: z.string().optional(),
  model: z.string().optional(),
  isError: z.boolean().optional(),
  interrupted: z.boolean().optional(),
  contextCompressed: z.boolean().optional(),
  interactions: messageInteractionsSchema.optional(),
  optionResponse: messageOptionResponseSchema.optional(),
  tools: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        clientId: z.string().optional(),
        index: z.number().optional(),
        type: z.string().optional(),
        function: z
          .object({
            name: z.string(),
            arguments: z.string().optional(),
          })
          .optional(),
        content: z.string().optional(),
        isError: z.boolean().optional(),
        errorMsg: z.string().optional(),
      }),
    )
    .optional(),
  imageRequestDurationMs: z.number().finite().nonnegative().optional(),
  responseMetrics: z
    .object({
      usage: z
        .object({
          inputTokens: tokenCountSchema.optional(),
          outputTokens: tokenCountSchema.optional(),
          cachedInputTokens: tokenCountSchema.optional(),
        })
        .refine(
          (usage) =>
            usage.inputTokens === undefined ||
            usage.cachedInputTokens === undefined ||
            usage.cachedInputTokens <= usage.inputTokens,
          "缓存用量不能超过输入用量",
        ),
      durationMs: z.number().finite().nonnegative().optional(),
      generationDurationMs: z.number().finite().nonnegative().optional(),
      estimatedOutputTokens: tokenCountSchema.optional(),
    })
    .optional(),
  composerInput: z
    .object({
      text: z.string(),
      files: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          size: z.number().nonnegative(),
          content: z.string(),
          isText: z.boolean(),
        }),
      ),
      quote: z
        .object({
          messageId: z.string().min(1).max(200),
          role: z.enum(["system", "user", "assistant"]),
          text: z.string().refine((text) => text.trim().length > 0),
        })
        .optional(),
    })
    .optional(),
});
const modelConfigSchema = z.object({
  model: z.string().optional(),
  chatApiFormat: z.enum(CHAT_API_FORMATS).optional(),
  providerName: z.string().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().optional(),
  stream: z.boolean().optional(),
  reasoningEffort: z
    .enum(["auto", "low", "medium", "high", "xhigh", "max", "ultra"])
    .optional(),
  stop: z.string().optional(),
  compressionThreshold: z.number().finite().nonnegative().optional(),
  presence_penalty: z.number().optional(),
  frequency_penalty: z.number().optional(),
  historyMessageCount: z.number().optional(),
  compressMessageLengthThreshold: z.number().finite().nonnegative().optional(),
  contextBudget: z.number().finite().nonnegative().optional(),
  compressModel: z.string().optional(),
  compressProviderName: z.string().optional(),
  sendMemory: z.boolean().optional(),
  enableInjectSystemPrompts: z.boolean().optional(),
  template: z.string().optional(),
  size: z.string().max(64).optional(),
  resolution: z.enum(["auto", "1k", "2k", "4k"]).optional(),
  quality: z
    .enum(["auto", "low", "medium", "high", "xhigh", "max", "standard", "hd"])
    .optional(),
  style: z.enum(["auto", "vivid", "natural"]).optional(),
  imageOutputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
  imageBackground: z.enum(["auto", "opaque", "transparent"]).optional(),
  imageOutputCompression: z.number().int().min(0).max(100).optional(),
  imageResponseFormat: z.enum(["url", "b64_json"]).optional(),
  imageStream: z.boolean().optional(),
  imageRequestMode: z.enum(["sync", "async"]).optional(),
  imagePartialImages: z.number().int().min(0).max(3).optional(),
});
const sessionSchema = z.object({
  id: z.string().min(1).max(200),
  topic: z.string(),
  projectId: z.string().min(1).max(200).optional(),
  favorite: z.boolean().optional(),
  activeSkillId: z.string().max(64).optional(),
  clearContextIndex: z.number().int().nonnegative().optional(),
  messages: z.array(messageSchema).max(100000),
  messageBranches: z.array(messageSchema).max(100000).optional(),
  branchSelections: z.record(z.string().min(1).max(200)).optional(),
  memoryPrompt: z.string().default(""),
  lastUpdate: z.number().optional(),
  mask: z.object({
    id: z.string(),
    name: z.string(),
    context: z.array(messageSchema).default([]),
    modelConfig: modelConfigSchema,
    syncGlobalConfig: z.boolean().optional(),
    lang: z.string().optional(),
  }),
});
const endpointSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (value === ApiPath.V1) return true;
    try {
      customApiPath(value, "");
      return true;
    } catch {
      return false;
    }
  }, "API 地址必须是 HTTP(S) 地址，且不能包含密钥或查询参数");
const settingsSchema = z.object({
  videoRequestMode: z.enum(["sync", "async"]).optional(),
  avatar: z.string().optional(),
  fontSize: z.number().min(10).max(40).optional(),
  fontFamily: z.string().optional(),
  theme: z.enum(["light", "dark", "auto"]).optional(),
  colorTheme: z.string().max(30).optional(),
  submitKey: z.string().optional(),
  motionPreference: z.enum(["system", "full", "reduced"]).optional(),
  reduceMotion: z.boolean().optional(),
  customModels: z.string().optional(),
  openaiUrl: endpointSchema.optional(),
  modelConfig: modelConfigSchema.optional(),
});
const imageSchema = z.object({
  id: z.string().min(1).max(200),
  prompt: z.string(),
  model: z.string(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  createdAt: z.number(),
  status: z.enum(["success", "failed"]),
  imageData: z
    .string()
    .refine(
      (value) =>
        value === "" ||
        /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-zA-Z0-9+/=\s]+$/.test(
          value,
        ),
      "备份包含无效图片",
    ),
});
const videoModeSchema = z.enum([
  "text-to-video",
  "image-to-video",
  "first-last-frame",
  "reference-to-video",
]);
const videoProtocolOptionsSchema = z
  .object({
    seed: z.string().optional(),
    generateAudio: z.boolean().optional(),
    personGeneration: z.string().optional(),
  })
  .optional();
const videoDraftSchema = z.object({
  apiFormat: z.enum(["openai", "xai", "seedance", "gemini"]),
  legacyCustomFormat: z.enum(["xai", "seedance", "gemini"]).optional(),
  model: z.string(),
  mode: videoModeSchema,
  prompt: z.string(),
  negativePrompt: z.string(),
  aspectRatio: z.string().max(64),
  resolution: z.string().max(64),
  size: z.string().max(64),
  duration: z.number().finite(),
  count: z.number().int().positive(),
  seed: z.string(),
  promptAdherence: z.number().finite(),
  cameraMotion: z.number().finite(),
  materials: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        name: z.string(),
        type: z.enum(["image", "video", "audio"]),
        url: z
          .string()
          .refine(
            (value) =>
              /^data:(?:image|video|audio)\//.test(value) ||
              /^https?:\/\//.test(value),
            "视频请求包含无效素材",
          ),
      }),
    )
    .max(30),
  referenceMode: z.enum(["all-reference", "image-only", "fusion"]),
  autoPlay: z.boolean(),
  autoSaveGallery: z.boolean(),
  confirmBeforeGenerate: z.boolean(),
  draftAutoSave: z.boolean(),
  protocolOptions: z
    .object({
      openai: videoProtocolOptionsSchema,
      xai: videoProtocolOptionsSchema,
      seedance: videoProtocolOptionsSchema,
      gemini: videoProtocolOptionsSchema,
    })
    .optional(),
  customParams: z
    .object({
      openai: z.string().optional(),
      xai: z.string().optional(),
      seedance: z.string().optional(),
      gemini: z.string().optional(),
    })
    .optional(),
  openaiReferenceSource: z.enum(["upload", "image_url", "file_id"]).optional(),
  openaiImageUrl: z.string().optional(),
  openaiFileId: z.string().optional(),
  openaiLastImageUrl: z.string().optional(),
});
const videoSchema = z
  .object({
    id: z.string().min(1).max(200),
    url: z.union([
      z.literal(""),
      z
        .string()
        .url()
        .refine((value) => /^https?:\/\//.test(value)),
    ]),
    prompt: z.string(),
    model: z.string(),
    mode: videoModeSchema.optional(),
    aspectRatio: z.string().max(64).optional(),
    resolution: z.string().max(64).optional(),
    size: z.string().max(64).optional(),
    mediaPath: z
      .string()
      .refine(isVideoMediaPath, "视频资源路径无效")
      .optional(),
    tokenId: z.number().int().positive().nullable().optional(),
    customApiBase: z.string().url().optional(),
    duration: z.number().optional(),
    status: z.enum(["pending", "success", "failed"]),
    createdAt: z.number(),
    request: videoDraftSchema.optional(),
    phase: z
      .enum(["submitting", "queued", "generating", "preparing", "paused"])
      .optional(),
    progress: z.number().finite().min(0).max(100).optional(),
    completedAt: z.number().finite().optional(),
    galleryHidden: z.boolean().optional(),
    upstreamId: z.string().max(300).optional(),
    error: z.string().optional(),
  })
  .refine(
    (video) => video.status !== "success" || !!video.url,
    "视频结果链接缺失",
  );
export const backupSchema = z.object({
  format: z.literal("octopus-local-backup"),
  version: z.literal(1),
  exportedAt: z.string(),
  chats: z.array(sessionSchema).max(10000).optional(),
  projects: z.array(chatProjectSchema).max(10000).optional(),
  images: z.array(imageSchema).max(10000).optional(),
  settings: settingsSchema.optional(),
  skills: skillCollectionSchema.optional(),
  modelTypes: modelTypeOverridesSchema.optional(),
  modelApiFormats: modelApiFormatsSchema.optional(),
  videos: z.array(videoSchema).max(10000).optional(),
});
export type LocalBackup = z.infer<typeof backupSchema>;

function hasSettingsPayload(settings?: LocalBackup["settings"]) {
  return Object.entries(settings || {}).some(
    ([name, value]) =>
      value !== undefined &&
      (name !== "modelConfig" ||
        (typeof value === "object" &&
          value !== null &&
          Object.values(value).some((field) => field !== undefined))),
  );
}

function assertBackupPayload(
  backup: LocalBackup,
  message = "备份没有可导入的数据，请选择包含聊天、图片、视频、技能或有效设置的备份文件。",
) {
  if (
    !backup.chats?.length &&
    !backup.projects?.length &&
    !backup.images?.length &&
    !backup.videos?.length &&
    !Object.keys(backup.skills || {}).length &&
    !Object.keys(backup.modelTypes || {}).length &&
    !Object.keys(backup.modelApiFormats || {}).length &&
    !hasSettingsPayload(backup.settings)
  )
    throw new Error(message);
}

const legacyConfigSchema = settingsSchema.omit({ openaiUrl: true }).extend({
  submitKey: z
    .enum([
      "Enter",
      "Ctrl + Enter",
      "Shift + Enter",
      "Alt + Enter",
      "Meta + Enter",
    ])
    .optional(),
});
const legacyBackupSchema = z.object({
  version: z.literal(1),
  timestamp: z.string().datetime({ offset: true }),
  config: legacyConfigSchema.refine(
    hasSettingsPayload,
    "旧版备份没有可导入的设置",
  ),
  access: z.object({ openaiUrl: endpointSchema.optional() }).optional(),
});

export function parseLocalBackup(input: unknown): LocalBackup {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error(
      "备份格式无效，请选择本地数据备份或旧版设置备份 JSON 文件。",
    );
  const source = input as Record<string, unknown>;
  if (source.version !== 1)
    throw new Error("不支持此备份版本，请使用当前版本重新导出备份后再导入。");
  if (Object.prototype.hasOwnProperty.call(source, "format")) {
    if (source.format !== "octopus-local-backup")
      throw new Error("无法识别此备份格式，请选择本应用导出的备份文件。");
    const parsed = backupSchema.safeParse(input);
    if (!parsed.success)
      throw new Error("备份内容无效或不完整，请重新选择或导出备份文件。");
    assertBackupPayload(parsed.data);
    return parsed.data;
  }
  const legacy = legacyBackupSchema.safeParse(input);
  if (!legacy.success)
    throw new Error(
      "无法识别有效的旧版设置备份，请选择包含版本、导出时间和设置的完整备份文件。",
    );
  const settings: NonNullable<LocalBackup["settings"]> = legacy.data.config;
  if (settings.modelConfig) migrateChatParams(settings.modelConfig);
  if (legacy.data.access?.openaiUrl)
    settings.openaiUrl = legacy.data.access.openaiUrl;
  const backup = backupSchema.parse({
    format: "octopus-local-backup",
    version: 1,
    exportedAt: legacy.data.timestamp,
    settings,
  });
  assertBackupPayload(backup);
  return backup;
}

function readBackupEndpoint(owner: LocalScope) {
  try {
    const profile = JSON.parse(
      localStorage.getItem(localKey("custom-provider", owner)) || "null",
    );
    const endpoint = endpointSchema.safeParse(profile?.openaiUrl);
    return endpoint.success ? endpoint.data : undefined;
  } catch {
    return undefined;
  }
}

export async function readLocalState(name: string, owner: LocalScope) {
  const key = localKey(name, owner);
  if (name === StoreKey.Chat) return readChatSnapshot(key);
  const raw = await indexedDBStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

export async function createLocalBackup(
  sections: {
    chats: boolean;
    images: boolean;
    settings: boolean;
    videos?: boolean;
  },
  owner?: LocalScope,
): Promise<LocalBackup> {
  owner ??= await initializeLocalWorkspace();
  await flushLocalWrites();
  const backup: LocalBackup = {
    format: "octopus-local-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
  };
  if (sections.chats) {
    const stored = await readLocalState(StoreKey.Chat, owner);
    const projects = normalizeChatProjects(stored?.state?.projects);
    const sessions = normalizeChatProjectSessions<ChatSession>(
      stored?.state?.sessions || [],
      projects,
    );
    // Inline local attachment cache references so the file works on another device.
    const inline = async (value: string) => {
      if (!value.includes("/studio/api/cache") && !/^[a-f0-9]{64}$/i.test(value))
        return value;
      const cached = await get<string>(`img_${value}`);
      if (!cached)
        throw new Error("部分聊天附件缓存缺失，请先确认附件可读取后再导出");
      return cached;
    };
    for (const session of sessions) {
      for (const message of [
        ...session.messages,
        ...(session.messageBranches || []),
        ...(session.mask?.context || []),
      ]) {
        if (message.streaming) message.interrupted = true;
        if (Array.isArray(message.content)) {
          for (const part of message.content)
            if (part.image_url?.url)
              part.image_url.url = await inline(part.image_url.url);
        }
      }
    }
    backup.chats = sessions.map((session) => sessionSchema.parse(session));
    backup.projects = projects;
  }
  if (sections.images) {
    const images = await getAllImages(owner);
    try {
      backup.images = [];
      for (const image of images) {
        if (image.status === "failed" && !image.imageData) {
          backup.images.push({ ...image, imageData: "" });
          continue;
        }
        const blob = await getImageBlob(image.id, owner);
        const imageData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        backup.images.push({ ...image, imageData });
      }
    } finally {
      releaseGalleryImages(images);
    }
  }
  if (sections.settings) {
    backup.settings = settingsSchema.parse(
      (await readLocalState(StoreKey.Config, "legacy"))?.state || {},
    );
    const openaiUrl = readBackupEndpoint(owner);
    if (openaiUrl) backup.settings.openaiUrl = openaiUrl;
    backup.skills = skillCollectionSchema.parse(
      (await readLocalState(StoreKey.Skills, owner))?.state?.installed || {},
    );
    const preferences = (await readLocalState(StoreKey.ModelPreferences, owner))
      ?.state;
    backup.modelTypes = modelTypeOverridesSchema.parse(
      preferences?.overrides || {},
    );
    backup.modelApiFormats = modelApiFormatsSchema.parse(
      preferences?.apiFormats || {},
    );
  }
  if (sections.videos)
    backup.videos = z.array(videoSchema).parse(await readVideoResults(owner));
  const parsed = backupSchema.parse(backup);
  assertBackupPayload(
    parsed,
    "所选范围暂无可导出的数据，请调整备份内容后重试。",
  );
  return parsed;
}

export async function importLocalBackup(input: unknown, copy = false) {
  const backup = parseLocalBackup(input);
  const owner = await initializeLocalWorkspace();
  await beginLocalMaintenance();
  ChatControllerPool.stopAll();
  try {
    const importPreferences =
      backup.modelTypes !== undefined || backup.modelApiFormats !== undefined;
    const currentPreferences = importPreferences
      ? await readLocalState(StoreKey.ModelPreferences, owner)
      : undefined;
    const validCurrentTypes = modelTypeOverridesSchema.safeParse(
      currentPreferences?.state?.overrides ?? {},
    );
    const validCurrentFormats = modelApiFormatsSchema.safeParse(
      currentPreferences?.state?.apiFormats ?? {},
    );
    const modelTypes = modelTypeOverridesSchema.parse({
      ...backup.modelTypes,
      ...(validCurrentTypes.success ? validCurrentTypes.data : {}),
    });
    const apiFormats = modelApiFormatsSchema.parse({
      ...backup.modelApiFormats,
      ...(validCurrentFormats.success ? validCurrentFormats.data : {}),
    });
    const key = localKey(StoreKey.Chat, owner);
    const current = await readLocalState(StoreKey.Chat, owner);
    const sessions = current?.state?.sessions || [];
    const currentProjects = normalizeChatProjects(current?.state?.projects);
    const importedProjects = normalizeChatProjects(backup.projects);
    const projectIds = new Map(
      importedProjects.map((project) => [
        project.id,
        copy ? nanoid() : project.id,
      ]),
    );
    const existingProjects = new Set(
      currentProjects.map((project) => project.id),
    );
    const incomingProjects = importedProjects
      .map((project) => ({
        ...project,
        id: projectIds.get(project.id)!,
      }))
      .filter((project) => !existingProjects.has(project.id));
    const projects = [...currentProjects, ...incomingProjects];
    const existing = new Set(
      sessions.map((session: { id: string }) => session.id),
    );
    const { createEmptyMask } = await import("../store/mask");
    const defaultMask = createEmptyMask();
    const copiedImageIds = new Map(
      copy ? (backup.images || []).map((image) => [image.id, nanoid()]) : [],
    );
    const restoreMessage = (
      message: z.infer<typeof messageSchema>,
      ids?: Map<string, string>,
    ) => {
      const id =
        ids?.get(message.id || "") ??
        (copy ? nanoid() : message.id || nanoid());
      const originalImageId = message.imageId || message.id;
      const hasImage =
        !!message.imageId ||
        (message.role === "assistant" &&
          typeof message.content === "string" &&
          /!\[(?:Generated Image|生成预览)\]\(/.test(message.content));
      return {
        ...message,
        id,
        parentId: message.parentId
          ? ids?.get(message.parentId) ?? message.parentId
          : undefined,
        ...(message.composerInput?.quote
          ? {
              composerInput: {
                ...message.composerInput,
                quote: {
                  ...message.composerInput.quote,
                  messageId:
                    ids?.get(message.composerInput.quote.messageId) ??
                    message.composerInput.quote.messageId,
                },
              },
            }
          : {}),
        ...(message.optionResponse
          ? {
              optionResponse: {
                ...message.optionResponse,
                sourceMessageId:
                  ids?.get(message.optionResponse.sourceMessageId) ??
                  message.optionResponse.sourceMessageId,
              },
            }
          : {}),
        ...(hasImage && originalImageId
          ? {
              imageId: copiedImageIds.get(originalImageId) || originalImageId,
            }
          : {}),
        date: message.date || new Date().toISOString(),
        streaming: false,
      };
    };
    const incoming = (backup.chats || [])
      .filter((session) => copy || !existing.has(session.id))
      .map((session) => {
        const ids = new Map(
          [...session.messages, ...(session.messageBranches || [])].flatMap(
            (message) =>
              message.id
                ? [[message.id, copy ? nanoid() : message.id] as const]
                : [],
          ),
        );
        return {
          ...session,
          id: copy ? nanoid() : session.id,
          projectId: session.projectId
            ? projectIds.get(session.projectId)
            : undefined,
          mask: {
            ...defaultMask,
            ...session.mask,
            modelConfig: {
              ...defaultMask.modelConfig,
              ...session.mask.modelConfig,
            },
            context: session.mask.context.map((message) =>
              restoreMessage(message),
            ),
          },
          stat: { tokenCount: 0, wordCount: 0, charCount: 0 },
          lastSummarizeIndex: 0,
          messages: session.messages.map((message) =>
            restoreMessage(message, ids),
          ),
          ...(session.messageBranches
            ? {
                messageBranches: session.messageBranches.map((message) =>
                  restoreMessage(message, ids),
                ),
                branchSelections: Object.fromEntries(
                  Object.entries(session.branchSelections || {}).flatMap(
                    ([parent, child]) => {
                      const nextParent =
                        parent === "__root__" ? parent : ids.get(parent);
                      const nextChild = ids.get(child);
                      return nextParent && nextChild
                        ? [[nextParent, nextChild]]
                        : [];
                    },
                  ),
                ),
              }
            : {}),
        };
      });
    // Keep a restorable copy of the previous chat snapshot before importing.
    if (current) await set(localKey("before-last-import", owner), current);
    if (backup.images) {
      const images = await getAllImages(owner);
      const ids = new Set(images.map((image) => image.id));
      releaseGalleryImages(images);
      for (const image of backup.images)
        if (copy || !ids.has(image.id)) {
          await addImage(
            { ...image, id: copiedImageIds.get(image.id) || image.id },
            owner,
            undefined,
            true,
          );
        }
    }
    if (backup.settings) {
      const config = await readLocalState(StoreKey.Config, "legacy");
      const { openaiUrl, ...settings } = backup.settings;
      if (
        settings.motionPreference !== undefined ||
        settings.reduceMotion !== undefined
      ) {
        settings.motionPreference = getMotionPreference(settings);
        settings.reduceMotion = settings.motionPreference === "reduced";
      }
      await indexedDBStorage.setItem(
        StoreKey.Config,
        JSON.stringify({
          version: 4.4,
          ...config,
          state: {
            models: [],
            ...config?.state,
            ...settings,
            ...(settings.modelConfig
              ? {
                  modelConfig: {
                    ...defaultMask.modelConfig,
                    ...config?.state?.modelConfig,
                    ...settings.modelConfig,
                  },
                }
              : {}),
            _hasHydrated: true,
          },
        }),
      );
      if (openaiUrl) {
        const profileKey = localKey("custom-provider", owner);
        let profile: Record<string, unknown> = {};
        try {
          const stored = JSON.parse(localStorage.getItem(profileKey) || "null");
          if (stored && typeof stored === "object" && !Array.isArray(stored))
            profile = stored;
        } catch {}
        const previousEndpoint = endpointSchema.safeParse(profile.openaiUrl);
        const endpointChanged =
          !previousEndpoint.success || previousEndpoint.data !== openaiUrl;
        localStorage.setItem(
          profileKey,
          JSON.stringify({
            ...profile,
            openaiUrl,
            ...(endpointChanged
              ? { openaiApiKey: "", useCustomConfig: false }
              : {}),
          }),
        );
      }
    }
    if (importPreferences) {
      await indexedDBStorage.setItem(
        localKey(StoreKey.ModelPreferences, owner),
        JSON.stringify({
          version: 1,
          state: { overrides: modelTypes, apiFormats, _hasHydrated: true },
        }),
      );
    }
    if (backup.skills) {
      const currentSkills = await readLocalState(StoreKey.Skills, owner);
      const installed = skillCollectionSchema.parse({
        ...backup.skills,
        ...currentSkills?.state?.installed,
      });
      await indexedDBStorage.setItem(
        localKey(StoreKey.Skills, owner),
        JSON.stringify({
          version: 1,
          state: { installed, _hasHydrated: true },
        }),
      );
    }
    if (backup.videos) {
      const current = await readVideoResults(owner);
      const ids = new Set(current.map((item: { id: string }) => item.id));
      await writeVideoResults(
        [
          ...current,
          ...backup.videos
            .filter((video) => copy || !ids.has(video.id))
            .map((video) => ({ ...video, id: copy ? nanoid() : video.id })),
        ],
        owner,
      );
    }
    if (incoming.length || incomingProjects.length)
      await writeChatSnapshot(key, {
        version: 3.4,
        state: {
          ...current?.state,
          sessions: [...sessions, ...incoming],
          projects,
          currentSessionIndex: incoming.length
            ? sessions.length
            : current?.state?.currentSessionIndex ?? 0,
          _hasHydrated: true,
        },
      });
  } catch (error) {
    endLocalMaintenance();
    throw error;
  }
  endLocalMaintenance(true);
  // Keep callbacks frozen until the caller reloads the imported snapshot.
}
