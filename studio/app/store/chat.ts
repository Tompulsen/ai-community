import {
  getMessageTextContent,
  isDalle3,
  isVisionModelCheck,
  isImageModelCheck,
  shouldUseImageGenerationApi,
  safeLocalStorage,
} from "../utils";
import {
  hasLeakedTopicReasoning,
  resolveChatTopic,
  topicMessageText,
} from "../utils/chat-topic";

import { indexedDBStorage } from "@/app/utils/indexedDB-storage";
import {
  hasDeferredChatAssets,
  loadChatSessionAssets,
  removeChatSnapshot,
  restoreChatAssets,
} from "../utils/chat-persistence";
import {
  getLocalScope,
  getLocalTokenId,
  isLocalWorkspaceActive,
  localKey,
  beginLocalMaintenance,
  endLocalMaintenance,
} from "../utils/local-workspace";
import { forgetTask } from "../utils/local-tasks";
import { waitForToolResult } from "../utils/tool-result";
import { fetchImageBlob } from "../utils/image-asset";
import { nanoid } from "nanoid";
import {
  usesCustomProvider,
  isAccountModelMode,
  CUSTOM_MODEL_PROVIDER,
} from "../utils/custom-provider";
import type { ParsedFile } from "../utils/file-upload";
import {
  fileContentParts,
  formatFileContent,
  hasFileContent,
  messageFiles,
} from "../utils/file-upload";
import {
  imageGenerationConfig,
  validateImagePrompt,
  type ImageGenerationConfig,
} from "../utils/image-params";
import type {
  MaterialPreparation,
  MaterialUploadItem,
} from "../utils/material-upload";
import type {
  ClientApi,
  ChatGenerationProgress,
  ChatResponseUsage,
  MultimodalContent,
  RequestMessage,
} from "../client/api";
import { getClientApi, detectBase64Mime } from "../client/api";
import { ChatControllerPool } from "../client/controller";
import { showToast } from "../components/ui-lib";
import {
  DEFAULT_INPUT_TEMPLATE,
  DEFAULT_SYSTEM_TEMPLATE,
  KnowledgeCutOffDate,
  StoreKey,
  SUMMARIZE_MODEL,
} from "../constant";
import { MCP_SYSTEM_TEMPLATE, MCP_TOOLS_TEMPLATE } from "../mcp/templates";
import Locale, { getLang } from "../locales";
import { getImageGenerationService } from "../client/image-generation";
import { getUserFriendlyError } from "../utils/error-hints";
import { isInsufficientBalance } from "../utils/quota-error";
import { createPersistStore } from "../utils/store";
import { estimateTokenLength } from "../utils/token-estimate";
import { migrateChatParams } from "../utils/chat-params";
import {
  chatProjectNameSchema,
  normalizeChatProjects,
  normalizeChatProjectSessions,
  type ChatProject,
} from "../utils/chat-projects";
export type { ChatProject } from "../utils/chat-projects";
import {
  answerBranches,
  branchBusy,
  cloneBranchMessages,
  createAnswerBranch,
  createEditedMessageBranch,
  deleteBranchMessage,
  selectAnswerBranch,
  synchronizeBranches,
} from "../utils/chat-branches";
import {
  compressionTriggerTokens,
  effectiveOutputTokens,
  historyMedia,
  prepareContext,
} from "../utils/context-budget";
import { getContextUsageBase } from "../utils/chat-context-usage";
import {
  requestContextSummary,
  serializeContextCompression,
  waitForContextCompression,
} from "../utils/context-compression";
export { isContextCompressionActive } from "../utils/context-compression";
import type { ChatResponseMetrics } from "../utils/chat-response-metrics";
import { ModelConfig, ModelType, useAppConfig } from "./config";
import type { VideoDraft } from "./video";
import { useAccessStore } from "./access";
import { useSkillStore } from "./skills";
import {
  useModelPreferenceStore,
  waitForModelPreferences,
} from "./model-preferences";
import { getModelCapabilities } from "../utils/model-capabilities";
import { formatQuoteInput, type MessageQuote } from "../utils/message-quote";
import {
  extractMessageInteractions,
  formatOptionResponse,
  messageInteractionPrompt,
  readMessageInteractions,
  validateOptionSelection,
  type MessageInteractions,
  type MessageOptionResponse,
} from "../utils/message-interactions";
import {
  isLocalPreviewEnabled,
  isLocalPreviewModel,
  LOCAL_PREVIEW_COMPRESSION_MODEL,
  LOCAL_PREVIEW_MESSAGE,
} from "../utils/local-preview-models";
import {
  acceptsSkill,
  skillRequestContext,
  styleImageMessage,
  skillContextRole,
  webSearchRequestContext,
} from "../skills/request";
import { getWebSearchMode, type WebSearchMode } from "../utils/web-search";
import { collectModelsWithDefaultModel } from "../utils/model";
import { createEmptyMask, Mask } from "./mask";
import { executeMcpAction, getAllTools } from "../mcp/actions";
import { isMcpAvailable } from "../mcp/availability";
import { extractMcpJson, isMcpJson } from "../mcp/utils";
import {
  addImage,
  getGallerySettings,
  trimToMaxCount,
  type GalleryImage,
  clearAllImages,
  dataURLtoBlob,
} from "./gallery";

const localStorage = safeLocalStorage();

/**
 * 将生成的图片保存到作品库（IndexedDB）
 * - 远程 URL 通过代理读取，原图以 Blob 保存在本地
 * - 检查 autoSave 设置，用户可关闭自动保存
 * - 保存失败时保留任务记录，允许只重试保存
 */
export async function saveImageToGallery(
  imageUrl: string,
  prompt: string,
  model: string,
  id = nanoid(),
  generation?: {
    references: string[];
    sourceWorkId?: string;
    config?: ImageGenerationConfig;
  },
) {
  const config = generation?.config
    ? imageGenerationConfig(generation.config)
    : undefined;
  try {
    const settings = await getGallerySettings();
    if (!settings.autoSave) return true;
    const blob = imageUrl.startsWith("data:")
      ? dataURLtoBlob(imageUrl)
      : await fetchImageBlob(imageUrl);
    if (!isLocalWorkspaceActive()) return false;
    let width = 0,
      height = 0;
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(blob);
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
      } catch {
        /* Dimensions are optional; preserve the original on decode failure. */
      }
    }
    const galleryImg: GalleryImage = {
      id,
      prompt,
      references: generation?.references ?? [],
      sourceWorkId: generation?.sourceWorkId,
      ...(config ? { config } : {}),
      model: model || "unknown",
      width,
      height,
      createdAt: Date.now(),
      imageData: "",
      status: "success",
    };

    await addImage(galleryImg, getLocalScope(), blob);
    await trimToMaxCount(settings.maxCount);
    return true;
  } catch (e: any) {
    console.error("[Gallery] saveImageToGallery failed:", e);
    return false;
  }
}

export type ChatMessageTool = {
  id: string;
  clientId?: string;
  index?: number;
  type?: string;
  function?: {
    name: string;
    arguments?: string;
  };
  content?: string;
  isError?: boolean;
  errorMsg?: string;
};

export type ChatMessage = RequestMessage & {
  quotaExceeded?: boolean;
  videoResultId?: string;
  generation?: {
    prompt: string;
    model: string;
    references: string[];
    sourceWorkId?: string;
    config?: ImageGenerationConfig;
  };
  parentId?: string;
  branchOrder?: number;
  reasoning?: string;
  imageId?: string;
  materialStatus?: "processing" | "failed";
  materialItems?: MaterialUploadItem[];
  composerInput?: { text: string; files: ParsedFile[]; quote?: MessageQuote };
  interrupted?: boolean;
  gallerySave?: "saving" | "saved" | "failed";
  imageRequestDurationMs?: number;
  responseMetrics?: ChatResponseMetrics;
  generationProgress?: ChatGenerationProgress;
  contextCompressed?: boolean;
  contextCompressing?: boolean;
  date: string;
  streaming?: boolean;
  isError?: boolean;
  id: string;
  model?: ModelType;
  tools?: ChatMessageTool[];
  audio_url?: string;
  isMcpResponse?: boolean;
  interactions?: MessageInteractions;
  optionResponse?: MessageOptionResponse;
};

type OptionSubmission = {
  response: MessageOptionResponse;
  isCurrent: () => boolean;
  accepted: boolean;
};

type MaterialTurn = {
  accountTokenId?: number | null;
  session: ChatSession;
  user: ChatMessage;
  bot: ChatMessage;
  scope: string;
  selection: string;
  retry: () => Promise<void>;
  preparation: MaterialPreparation;
  ready: Promise<void>;
  finishPreparation: () => void;
};

type RetryBranch = {
  session: ChatSession;
  user: ChatMessage;
  bot: ChatMessage;
  rebuildUserContent?: boolean;
  liveModelConfigSnapshot?: string;
};

const materialTurns = new Map<string, MaterialTurn>();
const optionSubmissions = new Set<string>();

function releaseMaterialTurns(sessionIds?: Set<string>) {
  for (const [id, turn] of materialTurns) {
    if (sessionIds && !sessionIds.has(turn.session.id)) continue;
    materialTurns.delete(id);
    turn.finishPreparation();
    ChatControllerPool.stop(turn.session.id, turn.bot.id);
    turn.preparation.cancel();
  }
}

export function createMessage(override: Partial<ChatMessage>): ChatMessage {
  return {
    id: nanoid(),
    date: new Date().toLocaleString(),
    role: "user",
    content: "",
    ...override,
  };
}

export interface ChatStat {
  tokenCount: number;
  wordCount: number;
  charCount: number;
}

export interface ChatSession {
  communityWorkspaceKind?: "text" | "image" | "video";
  creationKind?: "text" | "image" | "video";
  remixSourceWorkId?: string;
  id: string;
  topic: string;
  projectId?: string;
  favorite?: boolean;
  activeSkillId?: string;
  webSearchMode?: WebSearchMode;

  memoryPrompt: string;
  messages: ChatMessage[];
  messageBranches?: ChatMessage[];
  branchSelections?: Record<string, string>;
  stat: ChatStat;
  lastUpdate: number;
  lastSummarizeIndex: number;
  clearContextIndex?: number;

  mask: Mask;
}

export const DEFAULT_TOPIC = Locale.Store.DefaultTopic;
export const BOT_HELLO: ChatMessage = createMessage({
  role: "assistant",
  content: Locale.Store.BotHello,
});

function createEmptySession(): ChatSession {
  return {
    id: nanoid(),
    topic: DEFAULT_TOPIC,
    memoryPrompt: "",
    messages: [],
    stat: {
      tokenCount: 0,
      wordCount: 0,
      charCount: 0,
    },
    lastUpdate: Date.now(),
    lastSummarizeIndex: 0,

    mask: createEmptyMask(),
  };
}

function getSummarizeModel(
  currentModel: string,
  providerName: string,
): string[] {
  if (providerName === CUSTOM_MODEL_PROVIDER)
    return [currentModel, providerName];
  // if it is using gpt-* models, force to use 4o-mini to summarize
  if (currentModel.startsWith("gpt") || currentModel.startsWith("chatgpt")) {
    const configStore = useAppConfig.getState();
    const accessStore = useAccessStore.getState();
    const allModel = collectModelsWithDefaultModel(
      configStore.models,
      [configStore.customModels, accessStore.customModels].join(","),
      accessStore.defaultModel,
    );
    const summarizeModel = allModel.find(
      (m) => m.name === SUMMARIZE_MODEL && m.available,
    );
    if (summarizeModel) {
      return [
        summarizeModel.name,
        summarizeModel.provider?.providerName as string,
      ];
    }
  }

  return [currentModel, providerName];
}

function countMessages(msgs: ChatMessage[]) {
  return msgs.reduce(
    (pre, cur) => pre + estimateTokenLength(getMessageTextContent(cur)),
    0,
  );
}

function relaySelection(providerName?: string) {
  const access = useAccessStore.getState();
  return JSON.stringify(
    usesCustomProvider(access, providerName)
      ? [
          access.useCustomConfig,
          access.openaiUrl,
          access.openaiApiKey,
          access.customApiMode,
        ]
      : [getLocalScope()],
  );
}

function normalizeMessages(sendMessages: (RequestMessage | ChatMessage)[]) {
  return sendMessages.map((msg) => {
    const content = msg.content;
    if (typeof content === "string") {
      return {
        role: msg.role,
        content: [{ type: "text" as const, text: content }],
      };
    }
    if (Array.isArray(content)) {
      const normalizedContent = content
        .map((item: any) => {
          if (typeof item === "string") {
            return { type: "text" as const, text: item };
          }
          if (item.type === "text" && typeof item.text !== "string") {
            return {
              type: "text" as const,
              text: String(item.text || ""),
            };
          }
          if (item.type === "image_url" && !item.image_url?.url) {
            return null;
          }
          return item;
        })
        .filter(Boolean);
      return { role: msg.role, content: normalizedContent };
    }
    return { role: msg.role, content: msg.content };
  });
}

export function fillTemplateWith(input: string, modelConfig: ModelConfig) {
  const cutoff =
    KnowledgeCutOffDate[modelConfig.model] ?? KnowledgeCutOffDate.default;
  const models = useAppConfig.getState().models;
  const modelInfo = models.find((m) => m.name === modelConfig.model);

  const serviceProvider = modelInfo
    ? modelInfo.provider?.providerName ?? "OpenAI"
    : "OpenAI";

  const vars = {
    ServiceProvider: serviceProvider,
    cutoff,
    model: modelConfig.model,
    time: new Date().toString(),
    lang: getLang(),
    input: input,
  };

  let output = modelConfig.template ?? DEFAULT_INPUT_TEMPLATE;

  // remove duplicate
  if (input.startsWith(output)) {
    output = "";
  }

  // must contains {{input}}
  const inputVar = "{{input}}";
  if (!output.includes(inputVar)) {
    output += "\n" + inputVar;
  }

  Object.entries(vars).forEach(([name, value]) => {
    const regex = new RegExp(`{{${name}}}`, "g");
    output = output.replace(regex, value.toString()); // Ensure value is a string
  });

  return output;
}

async function getMcpSystemPrompt(): Promise<string> {
  try {
    const tools = await getAllTools();
    let toolsStr = "";

    tools.forEach((i) => {
      // error client has no tools
      if (!i.tools) return;

      toolsStr += MCP_TOOLS_TEMPLATE.replace(
        "{{ clientId }}",
        i.clientId,
      ).replace(
        "{{ tools }}",
        i.tools.tools.map((p: object) => JSON.stringify(p, null, 2)).join("\n"),
      );
    });

    return MCP_SYSTEM_TEMPLATE.replace("{{ MCP_TOOLS }}", toolsStr);
  } catch {
    return "";
  }
}

const DEFAULT_CHAT_STATE = {
  projects: [] as ChatProject[],
  sessions: [createEmptySession()],
  currentSessionIndex: 0,
  lastInput: "",
};

export const useChatStore = createPersistStore(
  DEFAULT_CHAT_STATE,
  (set, _get) => {
    let selectionRevision = 0;
    function get() {
      return {
        ..._get(),
        ...methods,
      };
    }

    async function restoreSessionAssets(sessionId: string): Promise<boolean> {
      const session = get().sessions.find((item) => item.id === sessionId);
      if (!session) return false;
      if (!hasDeferredChatAssets(session)) return true;
      const owner = getLocalScope();
      try {
        const loaded = await loadChatSessionAssets(
          localKey(StoreKey.Chat, owner),
          session,
        );
        if (!isLocalWorkspaceActive() || getLocalScope() !== owner)
          return false;
        const sessions = get().sessions;
        const index = sessions.findIndex((item) => item.id === sessionId);
        if (index < 0) return false;
        const live = sessions[index];
        if (!hasDeferredChatAssets(live)) return true;
        // Only fill references still present in the latest state after the read.
        const restored = restoreChatAssets(live, loaded);
        if (hasDeferredChatAssets(restored)) return false;
        const next = sessions.slice();
        next[index] = restored;
        set({ sessions: next });
        return true;
      } catch {
        if (
          isLocalWorkspaceActive() &&
          getLocalScope() === owner &&
          get().sessions.some(
            (item) => item.id === sessionId && hasDeferredChatAssets(item),
          )
        )
          showToast("历史附件读取失败，原数据已保留，请重试");
        return false;
      }
    }

    function compressionHistory(
      session: ChatSession,
      inputId?: string,
      excluded?: ReadonlySet<string>,
    ) {
      const clear = session.clearContextIndex ?? 0;
      const memory =
        !!session.memoryPrompt && session.lastSummarizeIndex > clear;
      return session.messages.flatMap((message, index) => {
        if (
          index < clear ||
          message.id === inputId ||
          excluded?.has(message.id) ||
          message.isError ||
          message.streaming ||
          message.materialStatus
        )
          return [];
        if (memory && index < session.lastSummarizeIndex) {
          const media = historyMedia(message);
          return media ? [media] : [];
        }
        return [message];
      });
    }

    async function prepareSessionContext({
      session,
      bot,
      input,
      prefix,
      controller,
      owner,
      selection,
      accountTokenId,
      modelConfig,
      modelCapabilities,
      chatApiFormat,
      eligibleHistoryIds,
      background = false,
    }: {
      session: ChatSession;
      bot: ChatMessage;
      input?: ChatMessage;
      prefix: RequestMessage[];
      controller: AbortController;
      owner: string;
      selection: string;
      accountTokenId?: number | null;
      modelConfig: ModelConfig;
      modelCapabilities?: Parameters<
        typeof requestContextSummary
      >[0]["modelCapabilities"];
      chatApiFormat?: ModelConfig["chatApiFormat"];
      eligibleHistoryIds?: ReadonlySet<string>;
      background?: boolean;
    }) {
      const excludedHistory = new Set(
        session.messages
          .filter(
            (message) =>
              message.streaming ||
              message.isError ||
              message.materialStatus ||
              (eligibleHistoryIds && !eligibleHistoryIds.has(message.id)),
          )
          .map((message) => message.id),
      );
      const prefixState = session.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content:
          background || !excludedHistory.has(message.id)
            ? JSON.stringify(message.content)
            : undefined,
      }));
      const maskContext = JSON.stringify(session.mask.context);
      let baseline: ChatSession | undefined;
      const active = () => {
        if (
          controller.signal.aborted ||
          !isLocalWorkspaceActive() ||
          getLocalScope() !== owner ||
          relaySelection(modelConfig.providerName) !== selection
        )
          return false;
        const live = get().sessions.find((item) => item.id === session.id);
        const message = live?.messages.find((item) => item.id === bot.id);
        return !!(
          live &&
          message &&
          (background
            ? !message.streaming &&
              !message.isError &&
              !message.interrupted &&
              JSON.stringify(live.mask.modelConfig) ===
                JSON.stringify(modelConfig)
            : message.streaming) &&
          live.clearContextIndex === session.clearContextIndex &&
          JSON.stringify(live.mask.context) === maskContext &&
          live.messages.length >= prefixState.length &&
          prefixState.every((saved, index) => {
            const message = live.messages[index];
            return (
              saved.id === message.id &&
              saved.role === message.role &&
              (saved.content === undefined ||
                saved.content === JSON.stringify(message.content))
            );
          }) &&
          (!baseline ||
            (live.memoryPrompt === baseline.memoryPrompt &&
              live.lastSummarizeIndex === baseline.lastSummarizeIndex))
        );
      };
      const clearRunning = () => {
        if (
          !bot.contextCompressing ||
          !isLocalWorkspaceActive() ||
          getLocalScope() !== owner
        )
          return;
        get().updateTargetSession(session, (target) => {
          const message =
            target.messages.find((item) => item.id === bot.id) ??
            target.messageBranches?.find((item) => item.id === bot.id);
          bot.contextCompressing = undefined;
          if (!message) return;
          message.contextCompressing = undefined;
          target.messages = [...target.messages];
        });
      };
      return serializeContextCompression({
        owner,
        sessionId: session.id,
        messageId: bot.id,
        controller,
        active,
        cleanup: clearRunning,
        run: async () => {
          if (!active()) throw new DOMException("请求已取消", "AbortError");
          const live = get().sessions.find((item) => item.id === session.id)!;
          baseline = {
            ...session,
            memoryPrompt: live.memoryPrompt,
            lastSummarizeIndex: live.lastSummarizeIndex,
          };
          const memory =
            baseline.lastSummarizeIndex > (baseline.clearContextIndex ?? 0)
              ? baseline.memoryPrompt
              : "";
          let summarized = false;
          const local = isLocalPreviewModel(modelConfig.providerName);
          const result = await prepareContext({
            prefix,
            history: compressionHistory(baseline, input?.id, excludedHistory),
            input,
            memory,
            config: modelConfig,
            summarize: (messages) => {
              if (!active()) throw new DOMException("请求已取消", "AbortError");
              if (
                !local &&
                isImageModelCheck(modelConfig.model, modelConfig.providerName)
              )
                throw new Error(
                  "摘要模型不能使用生图模型，请在设置中选择文本模型。",
                );
              summarized = true;
              if (!bot.contextCompressing)
                get().updateTargetSession(session, (target) => {
                  const message = target.messages.find(
                    (item) => item.id === bot.id,
                  );
                  if (!message) return;
                  bot.contextCompressing = true;
                  message.contextCompressing = true;
                  target.messages = [...target.messages];
                });
              return requestContextSummary({
                accountTokenId,
                messages,
                config: modelConfig,
                chatApiFormat,
                modelCapabilities,
                signal: controller.signal,
                active,
                local,
              });
            },
          });
          if (!active()) throw new DOMException("请求已取消", "AbortError");
          if (result.summarizedIds.length || result.memory !== memory) {
            const ids = new Set(result.summarizedIds);
            get().updateTargetSession(session, (target) => {
              const message = target.messages.find(
                (item) => item.id === bot.id,
              );
              if (!message) return;
              target.memoryPrompt = result.memory;
              target.lastSummarizeIndex = Math.max(
                target.lastSummarizeIndex,
                target.messages.reduce(
                  (last, item, index) => (ids.has(item.id) ? index + 1 : last),
                  0,
                ),
              );
              if (summarized) {
                bot.contextCompressed = true;
                message.contextCompressed = true;
              }
              bot.contextCompressing = undefined;
              message.contextCompressing = undefined;
              target.messages = [...target.messages];
            });
          }
          return result;
        },
      });
    }

    function compressAfterReply(
      sessionId: string,
      messageId: string,
      owner: string,
      expectedConfig: ModelConfig,
      accountTokenId?: number | null,
    ) {
      if (!isLocalWorkspaceActive() || getLocalScope() !== owner) return;
      const live = get().sessions.find((item) => item.id === sessionId);
      const bot = live?.messages.find((item) => item.id === messageId);
      if (
        !live ||
        !bot ||
        bot.role !== "assistant" ||
        bot.streaming ||
        bot.isError ||
        bot.interrupted ||
        isMcpJson(getMessageTextContent(bot)) ||
        bot.tools?.some((tool) => tool.isError === undefined) ||
        live.messages.some(
          (item) => item.streaming || item.materialStatus === "processing",
        ) ||
        JSON.stringify(live.mask.modelConfig) !== JSON.stringify(expectedConfig)
      )
        return;
      const local = isLocalPreviewModel(expectedConfig.providerName);
      if (local && expectedConfig.model !== LOCAL_PREVIEW_COMPRESSION_MODEL)
        return;
      const base = getContextUsageBase(live, fillTemplateWith);
      if (
        base.prefixTokens + base.memoryTokens + base.historyTokens <=
        compressionTriggerTokens(base.compressionThreshold)
      )
        return;
      const modelCapabilities = local
        ? undefined
        : getModelCapabilities(
            expectedConfig.model,
            expectedConfig.providerName,
          );
      if (
        modelCapabilities?.usesImageApi ||
        modelCapabilities?.category === "video"
      )
        return;
      const prefix: RequestMessage[] = [...live.mask.context];
      if (
        expectedConfig.enableInjectSystemPrompts &&
        (expectedConfig.model.startsWith("gpt-") ||
          expectedConfig.model.startsWith("chatgpt-"))
      )
        prefix.unshift({
          role: "system",
          content: fillTemplateWith("", {
            ...expectedConfig,
            template: DEFAULT_SYSTEM_TEMPLATE,
          }),
        });
      const snapshot = { ...live, messages: live.messages.slice() };
      void prepareSessionContext({
        accountTokenId,
        session: snapshot,
        bot,
        prefix,
        controller: new AbortController(),
        owner,
        selection: relaySelection(expectedConfig.providerName),
        modelConfig: expectedConfig,
        modelCapabilities,
        chatApiFormat:
          modelCapabilities?.apiFormat ?? expectedConfig.chatApiFormat,
        background: true,
      }).catch(() => {});
    }

    const methods = {
      createProject(name: string): string | undefined {
        if (!isLocalWorkspaceActive()) return;
        const parsed = chatProjectNameSchema.safeParse(name);
        if (!parsed.success) return;
        const project: ChatProject = {
          id: nanoid(),
          name: parsed.data,
          createdAt: Date.now(),
        };
        set((state) => ({ projects: [...state.projects, project] }));
        return project.id;
      },

      renameProject(id: string, name: string): boolean {
        if (!isLocalWorkspaceActive()) return false;
        const parsed = chatProjectNameSchema.safeParse(name);
        if (!parsed.success) return false;
        const project = get().projects.find((item) => item.id === id);
        if (!project) return false;
        if (project.name === parsed.data) return true;
        set((state) => ({
          projects: state.projects.map((item) =>
            item.id === id ? { ...item, name: parsed.data } : item,
          ),
        }));
        return true;
      },

      deleteProject(id: string): boolean {
        if (
          !isLocalWorkspaceActive() ||
          !get().projects.some((project) => project.id === id)
        )
          return false;
        set((state) => {
          const projects = state.projects.filter(
            (project) => project.id !== id,
          );
          return {
            projects,
            sessions: normalizeChatProjectSessions(state.sessions, projects),
          };
        });
        return true;
      },

      moveSessionsToProject(ids: string[], projectId?: string): boolean {
        if (
          !isLocalWorkspaceActive() ||
          (projectId !== undefined &&
            !get().projects.some((project) => project.id === projectId))
        )
          return false;
        const selected = new Set(ids);
        const sessions = get().sessions;
        let changed = false;
        const moved = sessions.map((session) => {
          if (!selected.has(session.id) || session.projectId === projectId)
            return session;
          changed = true;
          const next = { ...session };
          if (projectId === undefined) delete next.projectId;
          else next.projectId = projectId;
          return next;
        });
        if (changed) set({ sessions: moved });
        return true;
      },

      forkSession() {
        if (!isLocalWorkspaceActive()) return;
        selectionRevision++;
        // 获取当前会话
        const currentSession = get().currentSession();
        if (!currentSession) return;

        const newSession = createEmptySession();

        newSession.topic = currentSession.topic;
        if (
          get().projects.some(
            (project) => project.id === currentSession.projectId,
          )
        )
          newSession.projectId = currentSession.projectId;
        Object.assign(
          newSession,
          cloneBranchMessages(currentSession, () => nanoid()),
        );
        newSession.clearContextIndex = currentSession.clearContextIndex;
        newSession.mask = {
          ...currentSession.mask,
          modelConfig: {
            ...currentSession.mask.modelConfig,
          },
        };

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [newSession, ...state.sessions],
        }));
      },

      clearSessions() {
        if (!isLocalWorkspaceActive()) return;
        selectionRevision++;
        const sessionIds = get().sessions.map((session) => session.id);
        set(() => ({
          projects: [],
          sessions: [createEmptySession()],
          currentSessionIndex: 0,
        }));
        releaseMaterialTurns();
        sessionIds.forEach((id) => ChatControllerPool.stopSession(id));
      },

      selectSession(index: number): void | Promise<void> {
        const revision = ++selectionRevision;
        const sessions = get().sessions;
        const selectedIndex = Number.isInteger(index)
          ? Math.min(Math.max(0, index), sessions.length - 1)
          : 0;
        const session = sessions[selectedIndex];
        if (!session) return;
        if (hasDeferredChatAssets(session)) {
          const owner = getLocalScope();
          return restoreSessionAssets(session.id).then((restored) => {
            if (
              !restored ||
              revision !== selectionRevision ||
              !isLocalWorkspaceActive() ||
              getLocalScope() !== owner
            )
              return;
            const next = get().sessions.findIndex(
              (item) => item.id === session.id,
            );
            if (next >= 0) set({ currentSessionIndex: next });
          });
        }
        set({
          currentSessionIndex: selectedIndex,
        });
      },

      moveSession(from: number, to: number) {
        set((state) => {
          const { sessions, currentSessionIndex: oldIndex } = state;

          // move the session
          const newSessions = [...sessions];
          const session = newSessions[from];
          newSessions.splice(from, 1);
          newSessions.splice(to, 0, session);

          // modify current session id
          let newIndex = oldIndex === from ? to : oldIndex;
          if (oldIndex > from && oldIndex <= to) {
            newIndex -= 1;
          } else if (oldIndex < from && oldIndex >= to) {
            newIndex += 1;
          }

          return {
            currentSessionIndex: newIndex,
            sessions: newSessions,
          };
        });
      },

      newSession(mask?: Mask, projectId?: string) {
        if (!isLocalWorkspaceActive()) return;
        selectionRevision++;
        const session = createEmptySession();
        if (get().projects.some((project) => project.id === projectId))
          session.projectId = projectId;

        if (mask) {
          const config = useAppConfig.getState();
          const globalModelConfig = config.modelConfig;

          session.mask = {
            ...mask,
            modelConfig: {
              ...globalModelConfig,
              ...mask.modelConfig,
            },
          };
          session.topic = mask.name;
        } else {
          const { sessions, currentSessionIndex } = get();
          const previousConfig =
            sessions[currentSessionIndex]?.mask.modelConfig;
          if (
            previousConfig?.model?.trim() &&
            previousConfig.providerName?.trim()
          ) {
            session.mask.modelConfig.model = previousConfig.model;
            session.mask.modelConfig.providerName = previousConfig.providerName;
            session.mask.syncGlobalConfig = false;
          }
        }

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [session].concat(state.sessions),
        }));
      },

      nextSession(delta: number) {
        const { sessions, currentSessionIndex } = get();
        const n = sessions.length;
        const limit = (x: number) => (x + n) % n;
        return get().selectSession(limit(currentSessionIndex + delta));
      },

      favoriteSessions(ids: string[], favorite: boolean) {
        const selected = new Set(ids);
        set((state) => ({
          sessions: state.sessions.map((session) =>
            selected.has(session.id) ? { ...session, favorite } : session,
          ),
        }));
      },

      deleteSession(index: number) {
        const session = get().sessions.at(index);
        if (session) return get().deleteSessions([session.id]);
      },

      deleteSessions(
        ids: string[],
        requestedOwner?: string,
      ): void | Promise<void> {
        if (requestedOwner === undefined) selectionRevision++;
        const owner = requestedOwner ?? getLocalScope();
        if (!isLocalWorkspaceActive() || owner !== getLocalScope()) return;
        const { sessions, currentSessionIndex: currentIndex } = get();
        const deletingIds = new Set(ids);
        const newSessions = sessions.filter(
          (session) => !deletingIds.has(session.id),
        );
        if (newSessions.length === sessions.length) return;
        const currentId = sessions.at(currentIndex)?.id;
        let nextIndex = newSessions.findIndex(
          (session) => session.id === currentId,
        );
        if (nextIndex < 0) {
          const remainingBefore = sessions
            .slice(0, currentIndex)
            .filter((session) => !deletingIds.has(session.id)).length;
          nextIndex = Math.min(remainingBefore, newSessions.length - 1);
        }

        if (newSessions.length === 0) {
          nextIndex = 0;
          newSessions.push(createEmptySession());
        }

        const nextId = newSessions[nextIndex]?.id;
        const deferred = sessions.filter(
          (session) =>
            (deletingIds.has(session.id) || session.id === nextId) &&
            hasDeferredChatAssets(session),
        );
        if (deferred.length) {
          return Promise.all(
            deferred.map((session) => restoreSessionAssets(session.id)),
          ).then((loaded) => {
            if (!isLocalWorkspaceActive() || owner !== getLocalScope()) return;
            if (
              loaded.some(
                (restored, index) =>
                  !restored &&
                  get().sessions.some(
                    (session) =>
                      session.id === deferred[index].id &&
                      hasDeferredChatAssets(session),
                  ),
              )
            )
              return;
            return methods.deleteSessions(ids, owner);
          });
        }

        // for undo delete action
        const restoreState = {
          currentSessionIndex: currentIndex,
          sessions: sessions.slice(),
        };

        set(() => ({
          currentSessionIndex: nextIndex,
          sessions: newSessions,
        }));
        releaseMaterialTurns(deletingIds);
        deletingIds.forEach((id) => ChatControllerPool.stopSession(id));

        showToast(
          Locale.Home.DeleteToast,
          {
            text: Locale.Home.Revert,
            onClick() {
              if (!isLocalWorkspaceActive() || getLocalScope() !== owner)
                return;
              selectionRevision++;
              set((state) => ({
                ...restoreState,
                sessions: normalizeChatProjectSessions(
                  restoreState.sessions,
                  state.projects,
                ),
              }));
            },
          },
          5000,
        );
      },

      currentSession() {
        let index = get().currentSessionIndex;
        const sessions = get().sessions;

        // sessions 为空时返回默认空会话
        if (sessions.length === 0) {
          return createEmptySession();
        }

        if (index < 0 || index >= sessions.length) {
          index = Math.min(sessions.length - 1, Math.max(0, index));
          set(() => ({ currentSessionIndex: index }));
        }

        return sessions[index];
      },

      getMessageBranches(sessionId: string, messageId: string) {
        const state = _get();
        const session = state.sessions.find((item) => item.id === sessionId);
        return {
          ...(session
            ? answerBranches(session, messageId, state)
            : { index: 0, total: 1, messageIds: [messageId] }),
          disabled:
            !session ||
            branchBusy(session, state) ||
            ChatControllerPool.hasPending(sessionId),
        };
      },

      selectMessageBranch(
        sessionId: string,
        messageId: string,
        targetId: string,
      ) {
        const session = get().sessions.find((item) => item.id === sessionId);
        if (
          !session ||
          branchBusy(session) ||
          ChatControllerPool.hasPending(sessionId)
        )
          return false;
        let selected = false;
        get().updateTargetSession(session, (target) => {
          selected = selectAnswerBranch(target, messageId, targetId);
        });
        return selected;
      },

      deleteMessage(sessionId: string, messageId: string) {
        const session = get().sessions.find((item) => item.id === sessionId);
        if (!session) return false;
        let deleted = false;
        get().updateTargetSession(session, (target) => {
          deleted = deleteBranchMessage(target, messageId);
        });
        return deleted;
      },

      async submitMessageOptions(
        sessionId: string,
        sourceMessageId: string,
        optionsId: string,
        selectedIds: readonly string[],
      ): Promise<boolean> {
        if (!isLocalWorkspaceActive()) return false;
        const session = get().currentSession();
        const source = session.messages.at(-1);
        const definition = readMessageInteractions(source?.interactions)
          ?.options;
        if (
          session.id !== sessionId ||
          source?.id !== sourceMessageId ||
          source.role !== "assistant" ||
          source.streaming ||
          source.isError ||
          source.interrupted ||
          source.materialStatus ||
          isMcpJson(getMessageTextContent(source)) ||
          source.tools?.some((tool) => tool.isError === undefined) ||
          definition?.id !== optionsId ||
          branchBusy(session) ||
          ChatControllerPool.hasPending(sessionId)
        )
          return false;
        const selected = validateOptionSelection(definition, selectedIds);
        const text = selected && formatOptionResponse(definition, selected);
        if (!selected || !text) return false;
        const owner = getLocalScope();
        const selection = relaySelection(session.mask.modelConfig.providerName);
        const selectedTokenId = getLocalTokenId();
        const modelConfig = JSON.stringify(session.mask.modelConfig);
        const optionsSnapshot = JSON.stringify(definition);
        const key = JSON.stringify([
          owner,
          selection,
          sessionId,
          sourceMessageId,
          optionsId,
        ]);
        if (optionSubmissions.has(key)) return false;
        const submission: OptionSubmission = {
          response: {
            sourceMessageId,
            optionsId,
            selectedIds: selected,
          },
          accepted: false,
          isCurrent: () => {
            if (
              !isLocalWorkspaceActive() ||
              getLocalScope() !== owner ||
              getLocalTokenId() !== selectedTokenId ||
              relaySelection(session.mask.modelConfig.providerName) !==
                selection
            )
              return false;
            const current = get().currentSession();
            const last = current.messages.at(-1);
            return (
              current.id === sessionId &&
              JSON.stringify(current.mask.modelConfig) === modelConfig &&
              last?.id === sourceMessageId &&
              last.role === "assistant" &&
              !last.streaming &&
              !last.isError &&
              !last.interrupted &&
              !last.materialStatus &&
              !isMcpJson(getMessageTextContent(last)) &&
              !last.tools?.some((tool) => tool.isError === undefined) &&
              JSON.stringify(
                readMessageInteractions(last.interactions)?.options,
              ) === optionsSnapshot &&
              !branchBusy(current) &&
              !ChatControllerPool.hasPending(sessionId)
            );
          },
        };
        optionSubmissions.add(key);
        try {
          await get().onUserInput(
            text,
            [],
            false,
            { text, files: [] },
            undefined,
            undefined,
            undefined,
            undefined,
            submission,
          );
        } catch {
          // An accepted reply stays submitted even if its model request fails.
        } finally {
          optionSubmissions.delete(key);
        }
        return submission.accepted;
      },

      async retryMessage(sessionId: string, messageId: string) {
        let session = get().sessions.find((item) => item.id === sessionId);
        if (session && hasDeferredChatAssets(session)) {
          if (!(await restoreSessionAssets(sessionId))) return false;
          session = get().sessions.find((item) => item.id === sessionId);
        }
        let videoRequest: VideoDraft | undefined;
        let videoModelConfig: ModelConfig | undefined;
        let liveModelConfigSnapshot: string | undefined;
        const retryAnswer = (target: ChatSession) => {
          const index = target.messages.findIndex(
            (message) => message.id === messageId,
          );
          const message = target.messages[index];
          const answer =
            message?.role === "user" ? target.messages[index + 1] : message;
          return answer?.role === "assistant" ? answer : undefined;
        };
        const answer = session ? retryAnswer(session) : undefined;
        const videoResultId = answer?.videoResultId;
        if (session && videoResultId) {
          const owner = getLocalScope();
          const configSnapshot = JSON.stringify(session.mask.modelConfig);
          const [
            { useVideoStore },
            { chatVideoConfig },
            { getModelProvider },
            { resumeVideoRequest },
          ] = await Promise.all([
            import("./video"),
            import("../utils/chat-video"),
            import("../utils/model"),
            import("../utils/video-generation"),
          ]);
          await useVideoStore.getState().loadDraft();
          const live = get().sessions.find((item) => item.id === sessionId);
          const liveAnswer = live ? retryAnswer(live) : undefined;
          if (
            !isLocalWorkspaceActive() ||
            getLocalScope() !== owner ||
            !live ||
            JSON.stringify(live.mask.modelConfig) !== configSnapshot ||
            liveAnswer?.id !== answer?.id ||
            liveAnswer?.videoResultId !== videoResultId
          )
            return false;
          session = live;
          const result = useVideoStore
            .getState()
            .results.find((result) => result.id === videoResultId);
          if (result?.status === "pending") {
            try {
              await resumeVideoRequest(videoResultId);
              return true;
            } catch (error) {
              if (isLocalWorkspaceActive() && getLocalScope() === owner)
                showToast(
                  error instanceof Error
                    ? error.message
                    : "视频查询失败，请稍后重试。",
                );
              return false;
            }
          }
          videoRequest = result?.request;
          if (!videoRequest) {
            showToast(
              "原视频任务记录已不可用，请复用可用配置，或重新选择视频模型后发送。",
            );
            return false;
          }
          const [model, providerName] = getModelProvider(videoRequest.model);
          videoModelConfig = {
            ...session.mask.modelConfig,
            model,
            providerName: providerName ?? "",
            videoConfig: chatVideoConfig(videoRequest),
          };
          liveModelConfigSnapshot = configSnapshot;
        }
        if (
          !session ||
          branchBusy(session) ||
          ChatControllerPool.hasPending(sessionId) ||
          (isLocalPreviewModel(
            (videoModelConfig ?? session.mask.modelConfig).providerName,
          ) &&
            !isLocalPreviewEnabled())
        )
          return false;
        const messageIndex = session.messages.findIndex(
          (message) => message.id === messageId,
        );
        if (messageIndex < 0) return false;
        let userIndex = messageIndex;
        while (userIndex >= 0 && session.messages[userIndex].role !== "user")
          userIndex--;
        if (userIndex < 0) return false;
        const user = session.messages[userIndex];
        if (user.materialStatus) return false;
        const parts = Array.isArray(user.content) ? user.content : [];
        let references = parts.flatMap((part) =>
          part.type === "image_url" && part.image_url?.url
            ? [part.image_url.url]
            : [],
        );
        const files = messageFiles(user);
        if (videoRequest && !references.length && !files.length) {
          if (videoRequest.materials.some((item) => item.type !== "image")) {
            showToast(
              "此视频任务的素材不能直接重试，请复用配置后重新上传素材。",
            );
            return false;
          }
          references = videoRequest.materials.map((item) => item.url);
        }
        const bot = createMessage({
          role: "assistant",
          streaming: true,
          model: (videoModelConfig ?? session.mask.modelConfig).model,
        });
        let created = false;
        get().updateTargetSession(session, (target) => {
          created = createAnswerBranch(target, user.id, bot);
        });
        if (!created) return false;
        const live = get().sessions.find((item) => item.id === sessionId)!;
        const requestSession: ChatSession = {
          ...live,
          ...(videoRequest
            ? { remixSourceWorkId: videoRequest.sourceWorkId }
            : {}),
          messages: live.messages.slice(0, userIndex),
          mask: {
            ...live.mask,
            context: live.mask.context.slice(),
            modelConfig: { ...(videoModelConfig ?? live.mask.modelConfig) },
          },
        };
        await get().onUserInput(
          getMessageTextContent(user),
          references,
          user.isMcpResponse,
          user.composerInput ??
            (videoRequest ? { text: videoRequest.prompt, files } : undefined),
          parts.filter((part) =>
            ["file", "video_url", "input_audio"].includes(part.type),
          ),
          undefined,
          undefined,
          { session: requestSession, user, bot, liveModelConfigSnapshot },
        );
        return true;
      },

      async editMessage(sessionId: string, messageId: string, text: string) {
        if (
          !isLocalWorkspaceActive() ||
          get().currentSession().id !== sessionId
        )
          return false;
        const owner = getLocalScope();
        let session = get().sessions.find((item) => item.id === sessionId);
        if (session && hasDeferredChatAssets(session)) {
          if (!(await restoreSessionAssets(sessionId))) return false;
          session = get().sessions.find((item) => item.id === sessionId);
        }
        if (
          !session ||
          !isLocalWorkspaceActive() ||
          getLocalScope() !== owner ||
          get().currentSession().id !== sessionId ||
          branchBusy(session) ||
          ChatControllerPool.hasPending(sessionId) ||
          (isLocalPreviewModel(session.mask.modelConfig.providerName) &&
            !isLocalPreviewEnabled())
        )
          return false;
        const userIndex = session.messages.findIndex(
          (message) => message.id === messageId && message.role === "user",
        );
        if (userIndex < 0) return false;
        const source = session.messages[userIndex];
        if (source.materialStatus || source.isMcpResponse) return false;
        const parts = Array.isArray(source.content) ? source.content : [];
        const images = parts.flatMap((part) =>
          part.type === "image_url" && part.image_url?.url
            ? [part.image_url.url]
            : [],
        );
        const files = structuredClone(messageFiles(source));
        const materialParts = structuredClone(
          parts.filter((part) =>
            ["file", "video_url", "input_audio"].includes(part.type),
          ),
        );
        if (
          !text.trim() &&
          !images.length &&
          !files.length &&
          !materialParts.length
        )
          return false;
        if (
          text === (source.composerInput?.text ?? getMessageTextContent(source))
        )
          return get().retryMessage(sessionId, messageId);
        const composerInput = {
          ...structuredClone(source.composerInput),
          text,
          files,
        };
        const quotedInput = formatQuoteInput(text, composerInput.quote);
        const requestText = files.length
          ? `${formatFileContent(files)}\n\n${quotedInput}`
          : quotedInput;
        const user = createMessage({
          ...structuredClone(source),
          id: nanoid(),
          date: new Date().toLocaleString(),
          parentId: undefined,
          branchOrder: undefined,
          content: [
            { type: "text", text: requestText },
            ...structuredClone(parts.filter((part) => part.type !== "text")),
          ],
          composerInput,
          optionResponse: undefined,
          isError: undefined,
          interrupted: undefined,
        });
        const bot = createMessage({
          role: "assistant",
          streaming: true,
          model: session.mask.modelConfig.model,
        });
        let created = false;
        get().updateTargetSession(session, (target) => {
          created = createEditedMessageBranch(target, source.id, user, bot);
        });
        if (!created) return false;
        const live = get().sessions.find((item) => item.id === sessionId)!;
        const requestSession: ChatSession = {
          ...live,
          messages: live.messages.slice(0, userIndex),
          mask: {
            ...live.mask,
            context: live.mask.context.slice(),
            modelConfig: { ...live.mask.modelConfig },
          },
        };
        await get().onUserInput(
          requestText,
          images,
          source.isMcpResponse,
          composerInput,
          materialParts.length ? materialParts : fileContentParts(files),
          undefined,
          undefined,
          { session: requestSession, user, bot, rebuildUserContent: true },
        );
        return true;
      },

      onNewMessage(
        message: ChatMessage,
        targetSession: ChatSession,
        accountTokenId?: number | null,
      ) {
        if (!isLocalWorkspaceActive()) return;
        if (
          !get().sessions.some(
            (session) =>
              session.id === targetSession.id &&
              session.messages.some((item) => item.id === message.id),
          )
        )
          return;
        get().updateTargetSession(targetSession, (session) => {
          session.messages = [...session.messages];
          session.lastUpdate = Date.now();
        });

        get().updateStat(message, targetSession);

        get().checkMcpJson(message, accountTokenId);

        get().summarizeSession(false, targetSession, accountTokenId);
      },

      async onUserInput(
        content: string,
        attachImages?: string[],
        isMcpResponse?: boolean,
        composerInput?: ChatMessage["composerInput"],
        materialParts?: MultimodalContent[],
        preparation?: MaterialPreparation,
        retryTurn?: MaterialTurn,
        retryBranch?: RetryBranch,
        optionSubmission?: OptionSubmission,
        continuationTokenId?: number | null,
      ): Promise<void> {
        if (!isLocalWorkspaceActive()) return;
        if (optionSubmission && !optionSubmission.isCurrent()) return;
        const originalMaterialParts = materialParts?.slice();
        let session =
          retryTurn?.session ?? retryBranch?.session ?? get().currentSession();
        const accountTokenId =
          continuationTokenId !== undefined
            ? continuationTokenId
            : retryTurn
            ? retryTurn.accountTokenId
            : usesCustomProvider(
                useAccessStore.getState(),
                session.mask.modelConfig.providerName,
              )
            ? undefined
            : getLocalTokenId();
        const localPreview = isLocalPreviewModel(
          session.mask.modelConfig.providerName,
        );
        if (localPreview && !isLocalPreviewEnabled()) {
          showToast(LOCAL_PREVIEW_MESSAGE);
          return;
        }
        const preceding = [...materialTurns.values()].filter(
          (turn) =>
            turn !== retryTurn &&
            turn.session.id === session.id &&
            turn.user.materialStatus === "processing",
        );
        const previousReady = preceding.map((turn) => turn.ready);
        if (!preparation && previousReady.length) {
          const originalImages = attachImages?.slice() ?? [];
          const originalFiles = composerInput?.files.slice() ?? [];
          preparation = {
            getSnapshot: () => ({
              items: [],
              images: [],
              files: [],
              pending: 0,
            }),
            subscribe: () => () => {},
            wait: async () => ({
              images: originalImages,
              files: originalFiles,
            }),
            cancel() {},
            retry() {},
          };
        }
        let turn = retryTurn;
        let preparationController: AbortController | undefined;
        let unsubscribe: (() => void) | undefined;
        if (preparation) {
          if (!turn) {
            session = {
              ...session,
              messages: session.messages.slice(),
              mask: {
                ...session.mask,
                context: session.mask.context.slice(),
                modelConfig: { ...session.mask.modelConfig },
              },
            };
            const user = createMessage({
              role: "user",
              content: [{ type: "text", text: content }],
              composerInput,
              materialStatus: "processing",
              materialItems: preparation.getSnapshot().items,
            });
            const bot = createMessage({
              role: "assistant",
              streaming: true,
              model: session.mask.modelConfig.model,
              materialStatus: "processing",
            });
            let finishPreparation = () => {};
            const ready = new Promise<void>((resolve) => {
              finishPreparation = resolve;
            });
            turn = {
              accountTokenId,
              session,
              user,
              bot,
              scope: getLocalScope(),
              selection: relaySelection(session.mask.modelConfig.providerName),
              preparation,
              ready,
              finishPreparation,
              retry: async () => {},
            };
            const savedTurn = turn;
            turn.retry = () =>
              get().onUserInput(
                content,
                attachImages,
                isMcpResponse,
                composerInput,
                originalMaterialParts,
                preparation,
                savedTurn,
              );
            materialTurns.set(user.id, turn);
            get().updateTargetSession(session, (target) => {
              target.messages = target.messages.concat([user, bot]);
            });
          } else {
            turn.ready = new Promise<void>((resolve) => {
              turn!.finishPreparation = resolve;
            });
            turn.user.materialStatus = "processing";
            turn.bot.materialStatus = "processing";
            turn.bot.isError = false;
            turn.bot.content = "";
            turn.bot.streaming = true;
          }
          preparationController = new AbortController();
          ChatControllerPool.addController(
            session.id,
            turn.bot.id,
            preparationController,
          );
        }
        const failPreparation = (error: unknown) => {
          if (!turn) return;
          turn.finishPreparation();
          unsubscribe?.();
          ChatControllerPool.remove(session.id, turn.bot.id);
          const snapshot = turn.preparation.getSnapshot();
          turn.user.materialStatus = "failed";
          turn.user.materialItems = snapshot.items;
          turn.user.composerInput = {
            ...composerInput,
            text: composerInput?.text ?? content,
            files: snapshot.files.map((item) => item.file),
          };
          turn.user.content = [
            ...(content ? [{ type: "text" as const, text: content }] : []),
            ...snapshot.images.map((item) => ({
              type: "image_url" as const,
              image_url: { url: item.url },
            })),
            ...fileContentParts(snapshot.files.map((item) => item.file)),
          ];
          turn.bot.materialStatus = "failed";
          turn.bot.isError = true;
          turn.bot.streaming = false;
          turn.bot.content = preparationController?.signal.aborted
            ? "素材处理已取消，可重试"
            : error instanceof Error
            ? error.message
            : "素材处理失败，请重试后再发送";
          if (getLocalScope() === turn.scope) {
            get().updateTargetSession(session, (target) => {
              target.messages = target.messages.map((message) =>
                message.id === turn!.user.id
                  ? { ...turn!.user }
                  : message.id === turn!.bot.id
                  ? { ...turn!.bot }
                  : message,
              );
            });
          } else {
            materialTurns.delete(turn.user.id);
            turn.preparation.cancel();
          }
        };
        try {
          const modelConfig = {
            ...session.mask.modelConfig,
            ...(session.mask.modelConfig.videoConfig
              ? {
                  videoConfig: JSON.parse(
                    JSON.stringify(session.mask.modelConfig.videoConfig),
                  ) as ModelConfig["videoConfig"],
                }
              : {}),
          };
          const expectedConfigSnapshot =
            retryBranch?.liveModelConfigSnapshot ?? JSON.stringify(modelConfig);
          if (
            !localPreview &&
            !useModelPreferenceStore.getState()._hasHydrated
          ) {
            const owner = getLocalScope();
            const selectedSource = relaySelection(modelConfig.providerName);
            try {
              await waitForModelPreferences();
              if (optionSubmission && !optionSubmission.isCurrent()) return;
              const live = get().sessions.find(
                (item) => item.id === session.id,
              );
              if (
                !isLocalWorkspaceActive() ||
                getLocalScope() !== owner ||
                relaySelection(modelConfig.providerName) !== selectedSource ||
                !live ||
                JSON.stringify(live.mask.modelConfig) !== expectedConfigSnapshot
              )
                throw new Error("账号、模型或会话已变更，本次请求已取消");
            } catch (error) {
              if (turn || retryBranch) throw error;
              if (optionSubmission) return;
              if (isLocalWorkspaceActive() && getLocalScope() === owner) {
                const parts: MultimodalContent[] = [
                  { type: "text", text: content },
                  ...(attachImages ?? []).map((url) => ({
                    type: "image_url" as const,
                    image_url: { url },
                  })),
                  ...(originalMaterialParts ??
                    fileContentParts(composerInput?.files ?? [])),
                ];
                get().updateTargetSession(session, (target) => {
                  target.messages = target.messages.concat([
                    createMessage({
                      role: "user",
                      content: parts,
                      composerInput,
                    }),
                    createMessage({
                      role: "assistant",
                      model: modelConfig.model,
                      content:
                        error instanceof Error
                          ? error.message
                          : "本地模型设置读取失败，请重试",
                      isError: true,
                      streaming: false,
                    }),
                  ]);
                });
              }
              return;
            }
          }
          const modelCapabilities = localPreview
            ? undefined
            : getModelCapabilities(modelConfig.model, modelConfig.providerName);
          if (
            retryBranch?.liveModelConfigSnapshot &&
            modelCapabilities?.category !== "video"
          )
            throw new Error(
              "原视频模型当前不支持视频生成，请检查模型分类后重试。",
            );
          const requestChatApiFormat =
            modelCapabilities?.apiFormat ?? modelConfig.chatApiFormat;
          const source = useAccessStore.getState();
          const imageApiMode = usesCustomProvider(
            source,
            modelConfig.providerName,
          )
            ? source.customApiMode
            : "auto";
          const imageRoute = (hasFiles: boolean) =>
            shouldUseImageGenerationApi(modelConfig, {
              hasFiles,
              capabilities: modelCapabilities,
              customImageMode: imageApiMode !== "auto",
            });
          const installedSkill =
            !localPreview && !isMcpResponse && session.activeSkillId
              ? useSkillStore.getState().installed[session.activeSkillId]
              : undefined;
          const selectedSkill = installedSkill?.enabled
            ? { ...installedSkill }
            : undefined;
          const webSearchMode =
            !localPreview &&
            !isMcpResponse &&
            modelCapabilities?.category !== "video"
              ? getWebSearchMode(session, installedSkill)
              : "off";
          if (turn && preparationController) {
            const currentTurn = turn;
            const syncItems = () => {
              if (getLocalScope() !== currentTurn.scope) return;
              currentTurn.user.materialItems =
                currentTurn.preparation.getSnapshot().items;
              get().updateTargetSession(session, (target) => {
                target.messages = target.messages.map((message) =>
                  message.id === currentTurn.user.id
                    ? { ...currentTurn.user }
                    : message.id === currentTurn.bot.id
                    ? currentTurn.bot
                    : message,
                );
              });
            };
            unsubscribe = turn.preparation.subscribe(syncItems);
            syncItems();
            const signal = preparationController.signal;
            let rejectAborted: (() => void) | undefined;
            const aborted = new Promise<never>((_, reject) => {
              rejectAborted = () => reject(new Error("素材处理已取消"));
              signal.addEventListener("abort", rejectAborted, { once: true });
            });
            let prepared;
            try {
              prepared = await Promise.race([
                Promise.all([
                  turn.preparation.wait(signal),
                  ...previousReady,
                ]).then(([result]) => result),
                aborted,
              ]);
            } finally {
              if (rejectAborted)
                signal.removeEventListener("abort", rejectAborted);
            }
            const live = get().sessions.find((item) => item.id === session.id);
            if (
              signal.aborted ||
              !isLocalWorkspaceActive() ||
              getLocalScope() !== turn.scope ||
              relaySelection(modelConfig.providerName) !== turn.selection ||
              !live?.messages.some((message) => message.id === turn!.user.id) ||
              !live.messages.some(
                (message) => message.id === turn!.bot.id && message.streaming,
              ) ||
              JSON.stringify(live.mask.modelConfig) !==
                JSON.stringify(modelConfig)
            ) {
              throw new Error("账号、模型或会话已变更，本次请求已取消");
            }
            attachImages = prepared.images;
            composerInput = {
              ...composerInput,
              text: composerInput?.text ?? content,
              files: prepared.files,
            };
            materialParts =
              originalMaterialParts ?? fileContentParts(prepared.files);
            const preparedInput = formatQuoteInput(
              composerInput.text,
              composerInput.quote,
            );
            content = prepared.files.length
              ? formatFileContent(prepared.files) + "\n\n" + preparedInput
              : preparedInput;
            if (!localPreview && imageRoute(materialParts.length > 0)) {
              validateImagePrompt(
                prepared.images.length
                  ? content
                  : fillTemplateWith(content, modelConfig),
              );
            }
            const historyIds = new Set(
              session.messages.map((message) => message.id),
            );
            session = {
              ...session,
              messages: live.messages.filter((message) =>
                historyIds.has(message.id),
              ),
            };
            unsubscribe();
            unsubscribe = undefined;
          }

          if (optionSubmission && !optionSubmission.isCurrent()) return;
          if (localPreview) {
            const owner = turn?.scope ?? getLocalScope();
            const user =
              turn?.user ??
              retryBranch?.user ??
              createMessage({
                role: "user",
                composerInput,
                ...(optionSubmission
                  ? {
                      optionResponse: structuredClone(
                        optionSubmission.response,
                      ),
                    }
                  : {}),
              });
            user.content = [
              { type: "text", text: content },
              ...(attachImages ?? []).map((url) => ({
                type: "image_url" as const,
                image_url: { url },
              })),
              ...(materialParts ??
                fileContentParts(composerInput?.files ?? [])),
            ];
            user.composerInput = composerInput;
            const bot =
              turn?.bot ??
              retryBranch?.bot ??
              createMessage({
                role: "assistant",
                model: modelConfig.model,
                streaming: true,
              });
            if (turn) {
              user.materialStatus = undefined;
              user.materialItems = turn.preparation.getSnapshot().items;
              bot.materialStatus = undefined;
              get().updateTargetSession(session, (target) => {
                target.messages = target.messages.map((message) =>
                  message.id === user.id
                    ? { ...user }
                    : message.id === bot.id
                    ? bot
                    : message,
                );
              });
              turn.finishPreparation();
              materialTurns.delete(user.id);
            } else if (!retryBranch) {
              get().updateTargetSession(session, (target) => {
                target.messages = target.messages.concat([user, bot]);
                if (optionSubmission) optionSubmission.accepted = true;
              });
            }
            const controller = new AbortController();
            ChatControllerPool.addController(session.id, bot.id, controller);
            const previewIsActive = () =>
              !controller.signal.aborted &&
              isLocalWorkspaceActive() &&
              getLocalScope() === owner &&
              get().sessions.some(
                (target) =>
                  target.id === session.id &&
                  target.messages.some(
                    (message) => message.id === bot.id && message.streaming,
                  ),
              );
            const updatePreview = (update: (message: ChatMessage) => void) => {
              if (!isLocalWorkspaceActive() || getLocalScope() !== owner)
                return false;
              let updated = false;
              get().updateTargetSession(session, (target) => {
                const message = target.messages.find(
                  (item) => item.id === bot.id && item.streaming,
                );
                if (!message) return;
                update(message);
                target.messages = [...target.messages];
                if (!message.streaming) target.lastUpdate = Date.now();
                updated = true;
              });
              return updated;
            };
            let completedPreview = false;
            try {
              const { streamLocalPreviewResponse } = await import(
                "../utils/local-preview-response"
              );
              if (modelConfig.model === LOCAL_PREVIEW_COMPRESSION_MODEL) {
                await prepareSessionContext({
                  session,
                  bot,
                  input: user,
                  prefix: session.mask.context,
                  controller,
                  owner,
                  selection: relaySelection(modelConfig.providerName),
                  modelConfig,
                });
                if (!previewIsActive()) {
                  controller.abort();
                  throw new DOMException("Local preview stopped", "AbortError");
                }
              }
              const response = await streamLocalPreviewResponse({
                signal: controller.signal,
                model: modelConfig.model,
                onReasoning(text) {
                  if (
                    controller.signal.aborted ||
                    !updatePreview((message) => {
                      message.reasoning = text;
                    })
                  )
                    controller.abort();
                },
                onUpdate(text) {
                  if (
                    controller.signal.aborted ||
                    !updatePreview((message) => {
                      message.content = text;
                    })
                  )
                    controller.abort();
                },
                onGenerationProgress(progress) {
                  if (
                    !Number.isSafeInteger(progress.outputTokens) ||
                    progress.outputTokens < 0 ||
                    !Number.isFinite(progress.durationMs) ||
                    progress.durationMs <= 0
                  )
                    return;
                  if (
                    controller.signal.aborted ||
                    !updatePreview((message) => {
                      message.generationProgress = { ...progress };
                    })
                  )
                    controller.abort();
                },
              });
              completedPreview = updatePreview((message) => {
                message.tools = response?.tools;
                message.responseMetrics = response?.responseMetrics;
                message.generationProgress = undefined;
                message.streaming = false;
                message.date = new Date().toLocaleString();
              });
            } catch (error) {
              updatePreview((message) => {
                message.generationProgress = undefined;
                message.streaming = false;
                message.interrupted = controller.signal.aborted || undefined;
                message.isError = !controller.signal.aborted;
                if (!controller.signal.aborted)
                  message.content =
                    error instanceof Error
                      ? error.message
                      : LOCAL_PREVIEW_MESSAGE;
              });
            } finally {
              ChatControllerPool.remove(session.id, bot.id);
              if (completedPreview)
                compressAfterReply(session.id, bot.id, owner, modelConfig);
            }
            return;
          }

          // MCP Response no need to fill template
          let mContent: string | MultimodalContent[] = isMcpResponse
            ? content
            : fillTemplateWith(content, modelConfig);

          // 检查是否有图片 — 强制更新 store hasImages 为 true
          const hasImages =
            Array.isArray(attachImages) && attachImages.length > 0;
          // === 统一前端消息组装 ===
          // 所有 user 角色消息 content 强制统一为数组格式
          if (!isMcpResponse && hasImages) {
            const imageArray: MultimodalContent[] = [];

            // 添加文本内容
            if (content && content.trim()) {
              imageArray.push({ type: "text" as const, text: content });
            }

            // 添加图片内容 — 严格按 NewAPI 标准封装 image_url 双层对象
            for (const url of attachImages!) {
              let imageUrl = url;
              // 强制拼接完整 data:image/xxx;base64, 前缀（从 base64 数据头推断真实格式）
              if (!imageUrl.startsWith("data:image/")) {
                const mime = detectBase64Mime(imageUrl);
                imageUrl = `data:${mime};base64,${imageUrl}`;
              }

              // 格式校验：非法结构弹窗拦截
              if (
                !imageUrl.startsWith("data:image/") ||
                !imageUrl.includes(";base64,")
              ) {
                if (turn) throw new Error("图片格式不符合规范，请重新上传");
                showToast("图片格式不符合规范，请重新上传");
                return;
              }

              imageArray.push({
                type: "image_url" as const,
                image_url: { url: imageUrl },
              });
            }

            mContent = imageArray;
          } else if (
            !isMcpResponse &&
            mContent &&
            typeof mContent === "string"
          ) {
            // 纯文本消息也转为数组格式
            mContent = [{ type: "text" as const, text: mContent }];
          }

          if (!isMcpResponse) {
            const files =
              materialParts ?? fileContentParts(composerInput?.files || []);
            if (files.length) {
              mContent = [
                ...(typeof mContent === "string"
                  ? [{ type: "text" as const, text: mContent }]
                  : mContent),
                ...files,
              ];
            }
          }

          let userMessage: ChatMessage =
            turn?.user ??
            retryBranch?.user ??
            createMessage({
              role: "user",
              content: mContent,
              isMcpResponse,
              composerInput,
              ...(optionSubmission
                ? { optionResponse: structuredClone(optionSubmission.response) }
                : {}),
            });
          if (retryBranch?.rebuildUserContent) {
            userMessage.content = mContent;
            userMessage.composerInput = composerInput;
          }

          const botMessage: ChatMessage =
            turn?.bot ??
            retryBranch?.bot ??
            createMessage({
              role: "assistant",
              streaming: true,
              model: modelConfig.model,
            });

          botMessage.quotaExceeded = undefined;
          const accountBilling =
            isAccountModelMode(useAccessStore.getState()) &&
            modelConfig.providerName !== CUSTOM_MODEL_PROVIDER;
          const markQuotaError = (error: unknown) => {
            botMessage.quotaExceeded =
              accountBilling && isInsufficientBalance(error);
          };

          botMessage.generation = {
            prompt: getMessageTextContent(userMessage),
            model: modelConfig.model,
            references: [...(attachImages ?? [])],
            ...(session.remixSourceWorkId
              ? { sourceWorkId: session.remixSourceWorkId }
              : {}),
          };

          // get recent messages
          const scope = turn?.scope ?? getLocalScope();
          const selection =
            turn?.selection ?? relaySelection(modelConfig.providerName);
          let generationDurationMs: number | undefined;
          const requestIsActive = () =>
            isLocalWorkspaceActive() &&
            getLocalScope() === scope &&
            get().sessions.some(
              (target) =>
                target.id === session.id &&
                target.messages.some(
                  (message) =>
                    message.id === botMessage.id && message.streaming,
                ),
            );
          const updateBotContent = (message: string) => {
            if (!requestIsActive()) return;
            botMessage.content = extractMessageInteractions(
              message,
              botMessage.id,
              "stream",
            ).content;
            botMessage.interactions = undefined;
            get().updateTargetSession(session, (target) => {
              target.messages = [...target.messages];
            });
          };
          const updateReasoning = (reasoning: string) => {
            if (!requestIsActive()) return;
            get().updateTargetSession(session, (target) => {
              const message = target.messages.find(
                (item) => item.id === botMessage.id && item.streaming,
              );
              if (!message) return;
              botMessage.reasoning = reasoning;
              message.reasoning = reasoning;
              target.messages = [...target.messages];
            });
          };
          const updateUsage = (usage: ChatResponseUsage) => {
            if (!requestIsActive()) return;
            botMessage.responseMetrics = { usage: { ...usage } };
            get().updateTargetSession(session, (target) => {
              const message = target.messages.find(
                (item) => item.id === botMessage.id && item.streaming,
              );
              if (!message) return;
              message.responseMetrics = botMessage.responseMetrics;
              target.messages = [...target.messages];
            });
          };
          const updateGenerationTiming = (durationMs: number) => {
            if (
              requestIsActive() &&
              modelConfig.stream !== false &&
              Number.isFinite(durationMs) &&
              durationMs > 0
            )
              generationDurationMs = durationMs;
          };
          const updateGenerationProgress = (
            progress: ChatGenerationProgress,
          ) => {
            if (
              !requestIsActive() ||
              modelConfig.stream === false ||
              !Number.isSafeInteger(progress.outputTokens) ||
              progress.outputTokens < 0 ||
              !Number.isFinite(progress.durationMs) ||
              progress.durationMs <= 0
            )
              return;
            botMessage.generationProgress = { ...progress };
            get().updateTargetSession(session, (target) => {
              const message = target.messages.find(
                (item) => item.id === botMessage.id && item.streaming,
              );
              if (!message) return;
              message.generationProgress = botMessage.generationProgress;
              target.messages = [...target.messages];
            });
          };
          const finishBotMessage = (message: string, response?: Response) => {
            if (!requestIsActive()) {
              if (
                response?.status === 499 &&
                isLocalWorkspaceActive() &&
                getLocalScope() === scope
              )
                get().updateTargetSession(session, (target) => {
                  const current = target.messages.find(
                    (item) => item.id === botMessage.id,
                  );
                  if (current) current.interrupted = true;
                });
              ChatControllerPool.remove(session.id, botMessage.id);
              return;
            }
            if (
              generationDurationMs !== undefined &&
              (botMessage.responseMetrics || botMessage.generationProgress) &&
              response?.ok !== false &&
              response?.status !== 499
            ) {
              const metrics = botMessage.responseMetrics;
              const estimatedOutputTokens =
                metrics?.usage.outputTokens === undefined
                  ? botMessage.generationProgress?.outputTokens
                  : undefined;
              botMessage.responseMetrics = {
                ...metrics,
                usage: metrics?.usage ?? {},
                generationDurationMs,
                ...(estimatedOutputTokens === undefined
                  ? {}
                  : { estimatedOutputTokens }),
              };
            }
            botMessage.generationProgress = undefined;
            botMessage.streaming = false;
            botMessage.interrupted =
              response?.status === 499 ? true : undefined;
            botMessage.interactions = undefined;
            if (message) {
              if (typeof message === "string") {
                const parsed = extractMessageInteractions(
                  message,
                  botMessage.id,
                  response?.ok === false || response?.status === 499
                    ? "interrupted"
                    : "finish",
                );
                botMessage.content = parsed.content;
                botMessage.interactions =
                  !isMcpJson(parsed.content) &&
                  !botMessage.tools?.some((tool) => tool.isError === undefined)
                    ? parsed.interactions
                    : undefined;
              } else {
                botMessage.content = message;
              }
              botMessage.date = new Date().toLocaleString();
            }
            if (isLocalWorkspaceActive() && getLocalScope() === scope) {
              if ((message || botMessage.reasoning) && response?.ok !== false) {
                get().onNewMessage(botMessage, session, accountTokenId);
              } else {
                get().updateTargetSession(session, (target) => {
                  target.messages = [...target.messages];
                });
              }
            }
            ChatControllerPool.remove(session.id, botMessage.id);
            if (
              !botMessage.interrupted &&
              !botMessage.isError &&
              response?.ok !== false
            )
              compressAfterReply(
                session.id,
                botMessage.id,
                scope,
                modelConfig,
                accountTokenId,
              );
          };
          if (turn) {
            userMessage.content = mContent;
            userMessage.composerInput = composerInput;
            userMessage.materialStatus = undefined;
            userMessage.materialItems = turn.preparation.getSnapshot().items;
            botMessage.materialStatus = undefined;
            get().updateTargetSession(session, (target) => {
              target.messages = target.messages.map((message) =>
                message.id === userMessage.id
                  ? { ...userMessage }
                  : message.id === botMessage.id
                  ? botMessage
                  : message,
              );
            });
            turn.finishPreparation();
          }
          let memory =
            session.lastSummarizeIndex > (session.clearContextIndex ?? 0)
              ? session.memoryPrompt
              : "";
          // Capture history before inserting this turn, without delaying its UI.
          const historyController = !turn ? new AbortController() : undefined;
          const readHistory = () => {
            const live = get().sessions.find((item) => item.id === session.id);
            if (live) {
              session = {
                ...session,
                memoryPrompt: live.memoryPrompt,
                lastSummarizeIndex: live.lastSummarizeIndex,
              };
              memory =
                session.lastSummarizeIndex > (session.clearContextIndex ?? 0)
                  ? session.memoryPrompt
                  : "";
            }
            return get().getMessagesWithMemory(session, false);
          };
          const compressionWait = waitForContextCompression(
            scope,
            session.id,
            (
              historyController ??
              preparationController ??
              new AbortController()
            ).signal,
          );
          const history = compressionWait
            ? compressionWait.then(readHistory)
            : readHistory();
          if (!turn) {
            if (!retryBranch)
              get().updateTargetSession(session, (target) => {
                target.messages = target.messages.concat([
                  { ...userMessage, content: mContent },
                  botMessage,
                ]);
                if (optionSubmission) optionSubmission.accepted = true;
              });
            ChatControllerPool.addController(
              session.id,
              botMessage.id,
              historyController!,
            );
          }
          let cancelHistory: (() => void) | undefined;
          let recentMessages: ChatMessage[];
          try {
            const aborted = historyController
              ? new Promise<never>((_, reject) => {
                  cancelHistory = () => reject(new Error("请求已取消"));
                  historyController.signal.addEventListener(
                    "abort",
                    cancelHistory,
                    { once: true },
                  );
                })
              : undefined;
            recentMessages = await (aborted
              ? Promise.race([history, aborted])
              : history);
            if (
              !isLocalWorkspaceActive() ||
              getLocalScope() !== scope ||
              relaySelection(modelConfig.providerName) !== selection ||
              !get().sessions.some(
                (target) =>
                  target.id === session.id &&
                  (!(turn || retryBranch) ||
                    JSON.stringify(target.mask.modelConfig) ===
                      expectedConfigSnapshot) &&
                  target.messages.some(
                    (message) => message.id === userMessage.id,
                  ) &&
                  target.messages.some(
                    (message) =>
                      message.id === botMessage.id && message.streaming,
                  ),
              ) ||
              preparationController?.signal.aborted ||
              historyController?.signal.aborted
            )
              throw new Error("账号、密钥或会话已变更，本次请求已取消");
          } catch (error) {
            if (!historyController) throw error;
            botMessage.streaming = false;
            botMessage.interrupted =
              historyController.signal.aborted || undefined;
            botMessage.isError = !historyController.signal.aborted;
            markQuotaError(error);
            botMessage.content = historyController.signal.aborted
              ? ""
              : getUserFriendlyError(
                  error instanceof Error ? error : new Error(String(error)),
                );
            if (isLocalWorkspaceActive() && getLocalScope() === scope)
              get().updateTargetSession(session, (target) => {
                target.messages = [...target.messages];
              });
            return;
          } finally {
            if (historyController) {
              if (cancelHistory)
                historyController.signal.removeEventListener(
                  "abort",
                  cancelHistory,
                );
              ChatControllerPool.remove(session.id, botMessage.id);
            }
          }
          let sendMessages = [
            ...(memory
              ? [
                  createMessage({
                    role: "system",
                    content: Locale.Store.Prompt.History(memory),
                  }),
                ]
              : []),
            ...recentMessages,
            userMessage,
          ];
          const messageIndex = session.messages.length + 1;

          if (turn) {
            ChatControllerPool.remove(session.id, botMessage.id);
            materialTurns.delete(userMessage.id);
          }

          if (modelCapabilities?.category === "video") {
            try {
              const { chatVideoDraft } = await import("../utils/chat-video");
              const { generateVideoRequest } = await import(
                "../utils/video-generation"
              );
              if (
                !requestIsActive() ||
                relaySelection(modelConfig.providerName) !== selection
              )
                throw new Error("账号或会话已变化，请重新发送。");
              const draft = chatVideoDraft(
                composerInput
                  ? formatQuoteInput(composerInput.text, composerInput.quote)
                  : getMessageTextContent(userMessage),
                modelConfig.model,
                modelConfig.providerName,
                attachImages ?? [],
                session.remixSourceWorkId,
                modelConfig.videoConfig,
                messageFiles(userMessage),
              );
              botMessage.videoResultId = botMessage.id;
              botMessage.content = "视频生成任务";
              botMessage.streaming = false;
              get().updateTargetSession(session, (target) => {
                target.messages = [...target.messages];
              });
              await generateVideoRequest(draft, botMessage.id, accountTokenId);
            } catch (error) {
              if (isLocalWorkspaceActive() && getLocalScope() === scope) {
                botMessage.videoResultId = undefined;
                botMessage.streaming = false;
                botMessage.isError = true;
                botMessage.content =
                  error instanceof Error ? error.message : "视频生成失败";
                markQuotaError(error);
                get().updateTargetSession(session, (target) => {
                  target.messages = [...target.messages];
                });
              }
            }
            return;
          }
          const api: ClientApi = getClientApi(modelConfig.providerName);
          const createReasoningFallback = () => {
            const { model, providerName, reasoningEffort } = modelConfig;
            return () => {
              if (
                !isLocalWorkspaceActive() ||
                getLocalScope() !== scope ||
                relaySelection(providerName) !== selection
              )
                return false;
              let applied = false;
              get().updateTargetSession(session, (target) => {
                const current = target.mask.modelConfig;
                if (
                  current.model !== model ||
                  current.providerName !== providerName ||
                  current.reasoningEffort !== reasoningEffort ||
                  (getModelCapabilities(model, providerName).apiFormat ??
                    current.chatApiFormat) !== requestChatApiFormat ||
                  !target.messages.some(
                    (message) =>
                      message.id === botMessage.id && message.streaming,
                  )
                )
                  return;
                current.reasoningEffort = "auto";
                target.mask.syncGlobalConfig = false;
                applied = true;
              });
              if (applied)
                showToast("当前模型或接口不支持所选推理档位，已恢复自动");
              return applied;
            };
          };

          let normalizedMessages = normalizeMessages(sendMessages);

          // === 严格区分模型路由 ===
          // gpt-image/gpt-4v 等多模态识图模型：走 chat/completions，图片按 image_url 格式
          // DALL·E 等文生图模型：走 images/generations，图片按 init_images 格式
          const isVisionModel =
            modelCapabilities?.vision ||
            isVisionModelCheck(modelConfig.model, modelConfig.providerName);
          const isImageGenModel = imageRoute(
            hasFileContent(normalizedMessages),
          );

          if (!isImageGenModel) {
            const controller = new AbortController();
            ChatControllerPool.addController(
              session.id,
              botMessage.id,
              controller,
            );
            const active = () =>
              !controller.signal.aborted &&
              requestIsActive() &&
              relaySelection(modelConfig.providerName) === selection;
            try {
              if (webSearchMode !== "off") {
                const context = await webSearchRequestContext(
                  webSearchMode,
                  content,
                  controller.signal,
                );
                if (!active()) throw new Error("请求已取消");
                recentMessages.unshift(
                  createMessage({
                    role: skillContextRole(
                      modelConfig.model,
                      requestChatApiFormat,
                    ),
                    content: context,
                  }),
                );
              }
              if (selectedSkill && acceptsSkill(selectedSkill, false)) {
                const context = await skillRequestContext(
                  selectedSkill,
                  content,
                  controller.signal,
                );
                if (!active()) throw new Error("请求已取消");
                recentMessages.unshift(
                  createMessage({
                    role: skillContextRole(
                      modelConfig.model,
                      requestChatApiFormat,
                    ),
                    content: context,
                  }),
                );
              }
              const historyIds = new Set(
                session.messages.map((message) => message.id),
              );
              const result = await prepareSessionContext({
                accountTokenId,
                session,
                bot: botMessage,
                input: userMessage,
                prefix: recentMessages.filter(
                  (message) => !historyIds.has(message.id),
                ),
                eligibleHistoryIds: new Set(
                  recentMessages
                    .filter((message) => historyIds.has(message.id))
                    .map((message) => message.id),
                ),
                controller,
                owner: scope,
                selection,
                modelConfig,
                modelCapabilities,
                chatApiFormat: requestChatApiFormat,
              });
              sendMessages = result.messages as ChatMessage[];
              normalizedMessages = normalizeMessages(sendMessages);
              ChatControllerPool.remove(session.id, botMessage.id);
            } catch (error) {
              botMessage.streaming = false;
              botMessage.isError = !controller.signal.aborted;
              botMessage.content =
                error instanceof Error
                  ? error.message
                  : "上下文检查失败，请重试。";
              if (isLocalWorkspaceActive() && getLocalScope() === scope) {
                get().updateTargetSession(session, (target) => {
                  target.messages = [...target.messages];
                });
              }
              ChatControllerPool.remove(session.id, botMessage.id);
              return;
            }
          }

          if (
            isImageGenModel &&
            selectedSkill &&
            acceptsSkill(selectedSkill, true)
          ) {
            try {
              normalizedMessages = normalizedMessages.map((message, index) =>
                index === normalizedMessages.length - 1
                  ? styleImageMessage(message, selectedSkill)
                  : message,
              );
            } catch (error) {
              botMessage.streaming = false;
              botMessage.isError = true;
              botMessage.content =
                error instanceof Error ? error.message : "图片风格应用失败";
              get().updateTargetSession(session, (target) => {
                target.messages = [...target.messages];
              });
              return;
            }
          }

          if (isImageGenModel && botMessage.generation) {
            botMessage.generation.prompt = getMessageTextContent(
              normalizedMessages[normalizedMessages.length - 1] as ChatMessage,
            );
          }

          if (!isImageGenModel) {
            normalizedMessages.unshift({
              role: skillContextRole(modelConfig.model, requestChatApiFormat),
              content: [
                { type: "text", text: messageInteractionPrompt(botMessage.id) },
              ],
            });
          }

          if (isVisionModel && hasImages && !isImageGenModel) {
            // 多模态识图模型：走 chat completions API
            // 图片按 NewAPI 标准封装为 image_url 对象，嵌入 user 消息 content 数组
            api.llm.chat({
              accountTokenId,
              modelCapabilities,
              imageApiMode,
              messages: normalizedMessages,
              config: {
                ...modelConfig,
                max_tokens: effectiveOutputTokens(modelConfig.max_tokens),
                stream: modelConfig.stream ?? true,
              },
              onUpdate: updateBotContent,
              onUsage: updateUsage,
              onGenerationTiming: updateGenerationTiming,
              onGenerationProgress: updateGenerationProgress,
              onFinish: finishBotMessage,
              onReasoningUpdate: updateReasoning,
              onReasoningFallback: createReasoningFallback(),
              onError(error) {
                if (!requestIsActive()) {
                  ChatControllerPool.remove(session.id, botMessage.id);
                  return;
                }
                botMessage.generationProgress = undefined;
                markQuotaError(error);
                const msg = error.message || String(error);
                const hints: [string, string, string][] = [
                  [
                    "401",
                    "认证失败",
                    "访问密码错误或已过期，请刷新页面重新输入密码",
                  ],
                  [
                    "Unauthorized",
                    "认证失败",
                    "访问密码错误或已过期，请刷新页面重新输入密码",
                  ],
                  [
                    "Failed to fetch",
                    "无法连接到服务器",
                    "请检查网络连接，确认服务是否正常运行",
                  ],
                  ["network", "网络连接失败", "请检查网络连接后重试"],
                  ["TypeError", "网络连接失败", "请检查网络连接后重试"],
                  ["timeout", "请求超时", "上游服务响应过慢，请稍后重试"],
                  ["超时", "请求超时", "上游服务响应过慢，请稍后重试"],
                  ["429", "请求过于频繁", "请稍等一段时间后再试"],
                  ["Rate limit", "请求过于频繁", "请稍等一段时间后再试"],
                  ["500", "服务端错误", "上游服务暂时不可用，请稍后重试"],
                  ["502", "服务端错误", "上游服务暂时不可用，请稍后重试"],
                  ["503", "服务端错误", "上游服务暂时不可用，请稍后重试"],
                ];
                let title = "请求失败";
                let solution = "请重试";
                for (const [key, t, s] of hints) {
                  if (msg.includes(key)) {
                    title = t;
                    solution = s;
                    break;
                  }
                }
                botMessage.content += `\n\n> ⚠️ **${title}**\n> 💡 ${solution}`;
                botMessage.streaming = false;
                botMessage.isError = true;
                get().updateTargetSession(session, (session) => {
                  session.messages = [...session.messages];
                });
                ChatControllerPool.remove(session.id, botMessage.id);
              },
              onController(controller) {
                ChatControllerPool.addController(
                  session.id,
                  botMessage.id ?? messageIndex,
                  controller,
                );
              },
            });
          } else if (isImageGenModel) {
            // DALL·E 等文生图模型：走 images/generations API
            const imageService = getImageGenerationService(api.llm);
            const imageRequestStarted = performance.now();
            const imagePreferences = useAppConfig.getState().modelConfig;
            const asyncImageRequest =
              imagePreferences.imageRequestMode === "async";
            if (botMessage.generation) {
              botMessage.generation.config = imageGenerationConfig({
                ...modelConfig,
                imageResponseFormat:
                  imagePreferences.imageResponseFormat ?? "url",
                imageRequestMode: imagePreferences.imageRequestMode ?? "sync",
                imageStream: asyncImageRequest
                  ? false
                  : imagePreferences.imageStream ?? false,
                imagePartialImages: imagePreferences.imagePartialImages ?? 1,
              });
            }

            imageService.setCallbacks({
              onPreview: (imageUrl) => {
                botMessage.content = `![生成预览](${imageUrl})`;
                get().updateTargetSession(session, (session) => {
                  session.messages = [...session.messages];
                });
              },
              onStatusChange: (status) => {
                if (status === "cancelled") {
                  botMessage.content = asyncImageRequest
                    ? "已停止等待，异步任务可能仍在运行，刷新页面可恢复查询"
                    : "⚠️ 已取消生图任务";
                  botMessage.streaming = false;
                  get().updateTargetSession(session, (session) => {
                    session.messages = [...session.messages];
                  });
                } else if (status === "success") {
                  botMessage.content = "✅ 生成完成";
                  get().updateTargetSession(session, (session) => {
                    session.messages = [...session.messages];
                  });
                } else if (status === "failed") {
                  botMessage.content = "❌ 生成失败";
                  botMessage.streaming = false;
                  botMessage.isError = true;
                  get().updateTargetSession(session, (session) => {
                    session.messages = [...session.messages];
                  });
                }
              },
              onComplete: (imageUrl, imageUrls = [imageUrl]) => {
                // 空 URL 不渲染，转为错误提示
                if (!imageUrl) {
                  botMessage.content = "图片生成失败：未返回图片数据";
                  botMessage.streaming = false;
                  botMessage.isError = true;
                  get().updateTargetSession(session, (s) => {
                    s.messages = [...s.messages];
                  });
                  ChatControllerPool.remove(session.id, botMessage.id);
                  return;
                }
                const markdown = imageUrls
                  .map((url) => `![Generated Image](${url})`)
                  .join("\n\n");
                botMessage.content = markdown;
                botMessage.imageRequestDurationMs = Math.round(
                  performance.now() - imageRequestStarted,
                );
                botMessage.streaming = false;
                botMessage.date = new Date().toLocaleString();
                get().onNewMessage(botMessage, session, accountTokenId);
                ChatControllerPool.remove(session.id, botMessage.id);

                // 立即保存到作品库（添加详细日志）
                const userPrompt =
                  botMessage.generation?.prompt ??
                  getMessageTextContent(userMessage);
                void get().saveGeneratedImage(
                  session.id,
                  botMessage.id,
                  imageUrls,
                  userPrompt,
                  modelConfig.model,
                );
              },
              onError: (error, cause) => {
                const rawError = cause ?? error;
                markQuotaError(rawError);
                const msg = String(error);
                const hints: [string, string, string][] = [
                  [
                    "timeout",
                    "绘图请求超时",
                    "上游生成过慢，请点击重新生成或更换模型",
                  ],
                  ["Failed to fetch", "网络连接失败", "请检查网络连接后重试"],
                  ["network", "网络连接失败", "请检查网络连接后重试"],
                  ["TypeError", "网络连接失败", "请检查网络连接后重试"],
                  [
                    "401",
                    "认证失败",
                    "访问密码错误或已过期，请刷新页面重新输入密码",
                  ],
                  [
                    "Unauthorized",
                    "认证失败",
                    "访问密码错误或已过期，请刷新页面重新输入密码",
                  ],
                  ["not supported", "当前渠道不支持该模型", "请更换其他模型"],
                  ["400", "参数非法", "该模型不支持当前参数，请调整参数后重试"],
                  ["429", "请求限流", "调用过于频繁，请稍后再试"],
                  [
                    "API未返回图片URL",
                    "上游未返回图片数据",
                    "请更换模型或稍后重试",
                  ],
                ];
                let title = "生图失败";
                let solution = msg || "请重试";
                for (const [key, t, s] of hints) {
                  if (msg.includes(key)) {
                    title = t;
                    solution = s;
                    break;
                  }
                }
                const balanceError = isInsufficientBalance(rawError);
                if (balanceError) {
                  title = "余额不足";
                  solution = botMessage.quotaExceeded
                    ? "当前账户额度不足，请点击下方“前往充值”查看模型价格并充值后重试"
                    : "当前接口账户余额不足，请在对应服务商充值后重试";
                }
                botMessage.content =
                  asyncImageRequest && !balanceError
                    ? msg
                    : `> ⚠️ **${title}**\n> 💡 ${solution}`;
                botMessage.streaming = false;
                botMessage.isError = true;
                get().updateTargetSession(session, (session) => {
                  session.messages = [...session.messages];
                });
                ChatControllerPool.remove(session.id, botMessage.id);
              },
            });

            imageService
              .generateImage(
                {
                  accountTokenId,
                  taskContext: {
                    sessionId: session.id,
                    messageId: botMessage.id,
                  },
                  messages: normalizedMessages,
                  modelCapabilities,
                  imageApiMode,
                  config: { ...modelConfig, stream: true },
                  onController: (controller) => {
                    ChatControllerPool.addController(
                      session.id,
                      botMessage.id ?? messageIndex,
                      controller,
                    );
                  },
                  onFinish: (message, response) => {
                    if (botMessage.streaming === false) return;
                    finishBotMessage(message, response);
                  },
                },
                {
                  referenceImages: attachImages,
                },
              )
              .catch((error) => {
                console.error("[Chat] image generation failed", error);
              });
          } else {
            // 普通对话：使用 chat completions API
            api.llm.chat({
              accountTokenId,
              modelCapabilities,
              imageApiMode,
              messages: normalizedMessages,
              config: {
                ...modelConfig,
                max_tokens: effectiveOutputTokens(modelConfig.max_tokens),
                stream: modelConfig.stream ?? true,
              },
              onUpdate: updateBotContent,
              onUsage: updateUsage,
              onGenerationTiming: updateGenerationTiming,
              onGenerationProgress: updateGenerationProgress,
              onFinish: finishBotMessage,
              onReasoningUpdate: updateReasoning,
              onReasoningFallback: createReasoningFallback(),
              onBeforeTool(tool: ChatMessageTool) {
                (botMessage.tools = botMessage?.tools || []).push(tool);
                get().updateTargetSession(session, (session) => {
                  session.messages = [...session.messages];
                });
              },
              onAfterTool(tool: ChatMessageTool) {
                botMessage?.tools?.forEach((t, i, tools) => {
                  if (tool.id == t.id) {
                    tools[i] = { ...tool };
                  }
                });
                get().updateTargetSession(session, (session) => {
                  session.messages = [...session.messages];
                });
              },
              onError(error) {
                if (!requestIsActive()) {
                  ChatControllerPool.remove(session.id, botMessage.id);
                  return;
                }
                botMessage.generationProgress = undefined;
                markQuotaError(error);
                const isAborted = error.message?.includes?.("aborted");
                if (isAborted) {
                  botMessage.content += "\n\n> ⚠️ **请求已取消**";
                  botMessage.streaming = false;
                  userMessage.isError = false;
                  botMessage.isError = false;
                  get().updateTargetSession(session, (session) => {
                    session.messages = [...session.messages];
                  });
                  ChatControllerPool.remove(
                    session.id,
                    botMessage.id ?? messageIndex,
                  );
                  return;
                }
                // 统一使用友好错误提示
                const friendlyMsg = getUserFriendlyError(error);
                botMessage.content += `\n\n> ⚠️ **请求失败**\n> 💡 ${friendlyMsg}`;
                botMessage.streaming = false;
                userMessage.isError = !isAborted;
                botMessage.isError = !isAborted;
                get().updateTargetSession(session, (session) => {
                  session.messages = [...session.messages];
                });
                ChatControllerPool.remove(
                  session.id,
                  botMessage.id ?? messageIndex,
                );

                console.error("[Chat] failed ", error);
              },
              onController(controller) {
                // collect controller for stop/retry
                ChatControllerPool.addController(
                  session.id,
                  botMessage.id ?? messageIndex,
                  controller,
                );
              },
            });
          }
        } catch (error) {
          if (retryBranch) {
            retryBranch.bot.streaming = false;
            retryBranch.bot.isError = true;
            retryBranch.bot.content = getUserFriendlyError(
              error instanceof Error ? error : new Error(String(error)),
            );
            get().updateTargetSession(session, (target) => {
              target.messages = target.messages.map((message) =>
                message.id === retryBranch.bot.id ? retryBranch.bot : message,
              );
            });
            ChatControllerPool.remove(session.id, retryBranch.bot.id);
            return;
          }
          if (!turn) throw error;
          failPreparation(error);
        } finally {
          unsubscribe?.();
        }
      },

      async retryPreparedMaterials(sessionId: string, userMessageId: string) {
        const turn = materialTurns.get(userMessageId);
        if (!turn) {
          showToast("素材原文件已不在当前页面，请重新上传");
          return;
        }
        if (
          turn.session.id !== sessionId ||
          turn.user.materialStatus !== "failed" ||
          getLocalScope() !== turn.scope
        )
          return;
        const live = get().sessions.find((item) => item.id === sessionId);
        if (
          !live?.messages.some((message) => message.id === turn.user.id) ||
          !live.messages.some((message) => message.id === turn.bot.id)
        ) {
          releaseMaterialTurns(new Set([sessionId]));
          return;
        }
        turn.preparation.retry();
        await turn.retry();
      },

      getMemoryPrompt() {
        const session = get().currentSession();

        if (session.memoryPrompt.length) {
          return {
            role: "system",
            content: Locale.Store.Prompt.History(session.memoryPrompt),
            date: "",
          } as ChatMessage;
        }
      },

      async getMessagesWithMemory(
        targetSession?: ChatSession,
        includeMemory = true,
      ) {
        const session = targetSession ?? get().currentSession();
        const modelConfig = session.mask.modelConfig;
        const clearContextIndex = session.clearContextIndex ?? 0;
        const messages = session.messages.slice();
        const totalMessageCount = session.messages.length;

        // in-context prompts
        const contextPrompts = session.mask.context.slice();

        // system prompts, to get close to OpenAI Web ChatGPT
        const shouldInjectSystemPrompts =
          modelConfig.enableInjectSystemPrompts &&
          (session.mask.modelConfig.model.startsWith("gpt-") ||
            session.mask.modelConfig.model.startsWith("chatgpt-"));

        const mcpEnabled = await isMcpAvailable();
        const mcpSystemPrompt = mcpEnabled ? await getMcpSystemPrompt() : "";

        var systemPrompts: ChatMessage[] = [];

        if (shouldInjectSystemPrompts) {
          systemPrompts = [
            createMessage({
              role: "system",
              content:
                fillTemplateWith("", {
                  ...modelConfig,
                  template: DEFAULT_SYSTEM_TEMPLATE,
                }) + mcpSystemPrompt,
            }),
          ];
        } else if (mcpSystemPrompt) {
          systemPrompts = [
            createMessage({
              role: "system",
              content: mcpSystemPrompt,
            }),
          ];
        }

        const memoryPrompt = session.memoryPrompt
          ? ({
              role: "system" as const,
              content: Locale.Store.Prompt.History(session.memoryPrompt),
            } as ChatMessage)
          : undefined;
        // long term memory
        const shouldSendLongTermMemory =
          session.memoryPrompt &&
          session.memoryPrompt.length > 0 &&
          session.lastSummarizeIndex > clearContextIndex;
        const longTermMemoryPrompts =
          includeMemory && shouldSendLongTermMemory && memoryPrompt
            ? [memoryPrompt]
            : [];
        const longTermMemoryStartIndex = session.lastSummarizeIndex;

        // short term memory
        // lets concat send messages, including 4 parts:
        // 0. system prompt: to get close to OpenAI Web ChatGPT
        // 1. long term memory: summarized memory messages
        // 2. pre-defined in-context prompts
        // 3. short term memory: latest n messages
        // 4. newest input message
        // get recent messages as much as possible
        const reversedRecentMessages = [];
        for (let i = totalMessageCount - 1; i >= clearContextIndex; i -= 1) {
          const msg = messages[i];
          if (!msg || msg.isError || msg.streaming || msg.materialStatus)
            continue;
          if (shouldSendLongTermMemory && i < longTermMemoryStartIndex) {
            const media = historyMedia(msg);
            if (media) reversedRecentMessages.push(media as ChatMessage);
          } else {
            reversedRecentMessages.push(msg);
          }
        }
        // concat all messages
        const recentMessages = [
          ...systemPrompts,
          ...longTermMemoryPrompts,
          ...contextPrompts,
          ...reversedRecentMessages.reverse(),
        ];

        return recentMessages;
      },

      updateMessage(
        sessionIndex: number,
        messageIndex: number,
        updater: (message?: ChatMessage) => void,
      ) {
        const sessions = get().sessions.slice();
        const session = sessions.at(sessionIndex);
        if (session) {
          const messages = session.messages.slice();
          session.messages = messages;
          updater(messages.at(messageIndex));
        }
        set(() => ({ sessions }));
      },

      resetSession(session: ChatSession) {
        get().updateTargetSession(session, (session) => {
          session.messages = [];
          session.messageBranches = undefined;
          session.branchSelections = undefined;
          session.memoryPrompt = "";
          session.lastSummarizeIndex = 0;
          session.clearContextIndex = undefined;
        });
      },

      summarizeSession(
        refreshTitle: boolean = false,
        targetSession: ChatSession,
        accountTokenId?: number | null,
      ) {
        if (!isLocalWorkspaceActive()) return;
        const config = useAppConfig.getState();
        const session = targetSession;
        const modelConfig = session.mask.modelConfig;
        if (
          isLocalPreviewModel(modelConfig.providerName) ||
          isDalle3(modelConfig.model)
        ) {
          return;
        }

        // if not config compressModel, then using getSummarizeModel
        const [model, providerName] = getSummarizeModel(
          session.mask.modelConfig.model,
          session.mask.modelConfig.providerName,
        );
        const api: ClientApi = getClientApi(providerName);

        // remove error messages if any
        const messages = session.messages;

        // should summarize topic after chating more than 50 words
        const SUMMARIZE_MIN_LEN = 50;
        if (
          (config.enableAutoGenerateTitle &&
            session.topic === DEFAULT_TOPIC &&
            countMessages(messages) >= SUMMARIZE_MIN_LEN) ||
          refreshTitle
        ) {
          const startIndex = Math.max(
            0,
            messages.length - modelConfig.historyMessageCount,
          );
          const topicMessages = messages
            .slice(
              startIndex < messages.length ? startIndex : messages.length - 1,
              messages.length,
            )
            .filter((message) => !message.isError && !message.streaming)
            .map((message) => ({
              role: message.role,
              content: topicMessageText(message),
            }))
            .filter((message) => message.content)
            .concat({
              role: "user",
              content: Locale.Store.Prompt.Topic,
            });
          const initialTopic = session.topic;
          const saveTopic = (output: string) => {
            get().updateTargetSession(session, (target) => {
              if (target.topic === initialTopic) {
                target.topic = resolveChatTopic(
                  output,
                  messages,
                  DEFAULT_TOPIC,
                );
              }
            });
          };
          // Image-only models cannot answer a text title request.
          if (isImageModelCheck(model, providerName)) {
            saveTopic("");
          } else {
            api.llm.chat({
              accountTokenId,
              messages: topicMessages,
              config: {
                model,
                chatApiFormat: modelConfig.chatApiFormat ?? "chat-completions",
                stream: false,
                providerName,
              },
              onFinish(message, responseRes) {
                if (responseRes?.status === 200) {
                  saveTopic(message);
                } else {
                  saveTopic("");
                }
              },
              onError() {
                saveTopic("");
              },
            });
          }
        }
        // History compression is awaited before sending the next chat request.
      },

      updateStat(message: ChatMessage, session: ChatSession) {
        get().updateTargetSession(session, (session) => {
          const contentLength = Array.isArray(message.content)
            ? message.content.reduce(
                (acc, item) => acc + (item.text?.length || 0),
                0,
              )
            : message.content.length;
          session.stat.charCount += contentLength;
        });
      },
      updateTargetSession(
        targetSession: ChatSession,
        updater: (session: ChatSession) => void,
      ) {
        if (!isLocalWorkspaceActive()) return;
        const sessions = get().sessions;
        const index = sessions.findIndex((s) => s.id === targetSession.id);
        if (index < 0) return;
        const newSessions = sessions.slice();
        newSessions[index] = { ...newSessions[index] };
        const legacySkill =
          useSkillStore.getState().installed[
            newSessions[index].activeSkillId ?? ""
          ];
        if (
          newSessions[index].webSearchMode === undefined &&
          legacySkill?.kind === "web" &&
          legacySkill.enabled
        ) {
          newSessions[index].webSearchMode = "quick";
        }
        const previousMessages = sessions[index].messages.slice();
        updater(newSessions[index]);
        synchronizeBranches(newSessions[index], sessions[index]);
        const retainedIds = new Set(
          newSessions[index].messages.map((message) => message.id),
        );
        set(() => ({ sessions: newSessions }));
        for (const message of previousMessages) {
          if (!retainedIds.has(message.id)) {
            ChatControllerPool.stop(targetSession.id, message.id);
            for (const tool of message.tools ?? [])
              ChatControllerPool.stop(targetSession.id, tool.id);
          }
        }
        for (const [id, turn] of materialTurns) {
          if (
            turn.session.id === targetSession.id &&
            (!newSessions[index].messages.some(
              (message) => message.id === id,
            ) ||
              !newSessions[index].messages.some(
                (message) => message.id === turn.bot.id,
              ))
          ) {
            materialTurns.delete(id);
            turn.finishPreparation();
            ChatControllerPool.stop(turn.session.id, turn.bot.id);
            turn.preparation.cancel();
          }
        }
      },
      async saveGeneratedImage(
        sessionId: string,
        messageId: string,
        url: string | string[],
        prompt: string,
        model: string,
      ) {
        if (!isLocalWorkspaceActive()) return;
        const session = get().sessions.find((item) => item.id === sessionId);
        if (!session) return;
        const status = (value: ChatMessage["gallerySave"]) =>
          get().updateTargetSession(session, (s) => {
            s.messages = s.messages.map((message) =>
              message.id === messageId
                ? { ...message, gallerySave: value }
                : message,
            );
          });
        status("saving");
        const urls = Array.isArray(url) ? url : [url];
        const source = session.messages.find(
          (message) => message.id === messageId,
        )?.generation;
        const generation = source
          ? {
              ...source,
              references: [...source.references],
              ...(source.config
                ? { config: imageGenerationConfig(source.config) }
                : {}),
            }
          : undefined;
        let saved = urls.length > 0;
        for (let index = 0; index < urls.length; index++) {
          const result = await saveImageToGallery(
            urls[index],
            prompt,
            model,
            index === 0 ? messageId : `${messageId}-${index}`,
            generation,
          );
          saved = result && saved;
        }
        if (!isLocalWorkspaceActive()) return;
        status(saved ? "saved" : "failed");
        if (saved) forgetTask(messageId);
      },
      async clearAllData() {
        selectionRevision++;
        releaseMaterialTurns();
        await beginLocalMaintenance();
        ChatControllerPool.stopAll();
        try {
          await removeChatSnapshot(localKey(StoreKey.Chat));
          await indexedDBStorage.removeItem(localKey(StoreKey.Skills));
          await indexedDBStorage.removeItem(localKey("before-last-import"));
          await clearAllImages(getLocalScope());
          const { removeVideoWorkspaceData } = await import("./video");
          await removeVideoWorkspaceData();
          for (const key of Object.keys(window.localStorage)) {
            if (
              key === localKey(StoreKey.Chat) ||
              key === localKey(StoreKey.Skills) ||
              key === localKey("video-workspace-draft") ||
              key === localKey("video-workspace-results") ||
              key.startsWith(localKey("task:")) ||
              key.startsWith(localKey("async-submission:")) ||
              key.startsWith(localKey("unfinished-input-"))
            )
              localStorage.removeItem(key);
          }
          endLocalMaintenance(true);
          location.reload();
        } catch (error) {
          endLocalMaintenance();
          throw error;
        }
      },
      setLastInput(lastInput: string) {
        set({
          lastInput,
        });
      },

      /** check if the message contains MCP JSON and execute the MCP action */
      async checkMcpJson(
        message: ChatMessage,
        accountTokenId = getLocalTokenId(),
      ) {
        if (message.role !== "assistant" || !isLocalWorkspaceActive()) return;
        const scope = getLocalScope();
        const session = get().sessions.find((entry) =>
          entry.messages.some((item) => item.id === message.id),
        );
        if (!session) return;
        const selection = relaySelection(session.mask.modelConfig.providerName);
        const active = () =>
          isLocalWorkspaceActive() &&
          getLocalScope() === scope &&
          relaySelection(session.mask.modelConfig.providerName) === selection &&
          get().sessions.some(
            (entry) =>
              entry.id === session.id &&
              entry.messages.some((item) => item.id === message.id),
          );
        const mcpEnabled = await isMcpAvailable();
        if (!mcpEnabled || !active()) return;
        const content = getMessageTextContent(message);
        if (isMcpJson(content)) {
          try {
            const mcpRequest = extractMcpJson(content);
            if (mcpRequest) {
              const name =
                typeof mcpRequest.mcp.params?.name === "string"
                  ? mcpRequest.mcp.params.name
                  : mcpRequest.mcp.method;
              const args = JSON.stringify(
                mcpRequest.mcp.params?.arguments ?? mcpRequest.mcp.params ?? {},
              );
              const tool: ChatMessageTool = {
                id: nanoid(),
                type:
                  mcpRequest.mcp.method === "tools/call"
                    ? "mcp"
                    : "mcp-request",
                clientId: mcpRequest.clientId,
                function: { name, arguments: args },
              };
              let started = false;
              get().updateTargetSession(session, (target) => {
                const entry = target.messages.find(
                  (item) => item.id === message.id,
                );
                if (
                  !entry ||
                  entry.tools?.some(
                    (item) =>
                      item.clientId === tool.clientId &&
                      item.function?.name === name &&
                      item.function?.arguments === args,
                  )
                )
                  return;
                entry.tools = [...(entry.tools ?? []), tool];
                target.messages = [...target.messages];
                started = true;
              });
              if (!started) return;
              const toolController = new AbortController();
              const updateTool = (update: Partial<ChatMessageTool>) => {
                if (!active()) return;
                get().updateTargetSession(session, (target) => {
                  const entry = target.messages.find(
                    (item) => item.id === message.id,
                  );
                  if (!entry) return;
                  entry.tools = entry.tools?.map((item) =>
                    item.id === tool.id ? { ...item, ...update } : item,
                  );
                  target.messages = [...target.messages];
                });
              };
              toolController.signal.addEventListener("abort", () => {
                updateTool({
                  isError: true,
                  errorMsg: "已停止等待，工具可能仍在运行",
                });
                if (
                  ChatControllerPool.controllers[
                    ChatControllerPool.key(session.id, tool.id)
                  ] === toolController
                )
                  ChatControllerPool.remove(session.id, tool.id);
              });
              ChatControllerPool.addController(
                session.id,
                tool.id,
                toolController,
              );
              try {
                const result = await waitForToolResult(
                  executeMcpAction(mcpRequest.clientId, mcpRequest.mcp),
                  toolController.signal,
                );
                if (toolController.signal.aborted) return;
                const mcpResponse =
                  typeof result === "object"
                    ? JSON.stringify(result)
                    : String(result);
                const failed =
                  !!result &&
                  typeof result === "object" &&
                  ("error" in result ||
                    ("isError" in result && result.isError === true));
                updateTool({
                  content: mcpResponse,
                  isError: failed,
                  errorMsg: failed ? "工具执行失败，请查看结果" : undefined,
                });
                if (!active() || get().currentSession().id !== session.id)
                  return;
                await get().onUserInput(
                  `\`\`\`json:mcp-response:${mcpRequest.clientId}\n${mcpResponse}\n\`\`\``,
                  [],
                  true,
                  undefined,
                  undefined,
                  undefined,
                  undefined,
                  undefined,
                  undefined,
                  accountTokenId,
                );
              } catch (error) {
                if (toolController.signal.aborted) return;
                const errorMsg =
                  error instanceof Error ? error.message : String(error);
                updateTool({ isError: true, errorMsg });
                if (active()) showToast("MCP 执行失败: " + errorMsg);
              } finally {
                if (
                  ChatControllerPool.controllers[
                    ChatControllerPool.key(session.id, tool.id)
                  ] === toolController
                )
                  ChatControllerPool.remove(session.id, tool.id);
              }
            }
          } catch (error) {
            console.error("[Check MCP JSON]", error);
          }
        }
      },
    };

    return methods;
  },
  {
    name: StoreKey.Chat,
    version: 3.6,
    merge(persistedState, currentState) {
      const persisted = persistedState as
        | Partial<typeof DEFAULT_CHAT_STATE>
        | undefined;
      const projects = normalizeChatProjects(persisted?.projects);
      const sessions = persisted?.sessions;
      return {
        ...currentState,
        ...persisted,
        projects,
        sessions: normalizeChatProjectSessions(
          Array.isArray(sessions) ? sessions : currentState.sessions,
          projects,
        ),
      };
    },
    migrate(persistedState, version) {
      const state = persistedState as any;
      const newState = {
        ...state,
        projects: normalizeChatProjects(state.projects),
        sessions: (state.sessions || []).map((s: any) => ({
          ...s,
          messages: [...(s.messages || [])],
          mask: { ...s.mask, modelConfig: { ...s.mask?.modelConfig } },
        })),
      } as typeof DEFAULT_CHAT_STATE;

      if (version < 2) {
        newState.sessions = [];

        const oldSessions = state.sessions;
        for (const oldSession of oldSessions) {
          const newSession = createEmptySession();
          newSession.topic = oldSession.topic;
          newSession.messages = [...oldSession.messages];
          newSession.mask.modelConfig.sendMemory = true;
          newSession.mask.modelConfig.historyMessageCount = 4;
          newSession.mask.modelConfig.compressMessageLengthThreshold = 1000;
          newState.sessions.push(newSession);
        }
      }

      if (version < 3) {
        // migrate id to nanoid
        newState.sessions.forEach((s) => {
          s.id = nanoid();
          s.messages.forEach((m) => (m.id = nanoid()));
        });
      }

      // Enable `enableInjectSystemPrompts` attribute for old sessions.
      // Resolve issue of old sessions not automatically enabling.
      if (version < 3.1) {
        newState.sessions.forEach((s) => {
          if (
            // Exclude those already set by user
            !s.mask.modelConfig.hasOwnProperty("enableInjectSystemPrompts")
          ) {
            // Because users may have changed this configuration,
            // the user's current configuration is used instead of the default
            const config = useAppConfig.getState();
            s.mask.modelConfig.enableInjectSystemPrompts =
              config.modelConfig.enableInjectSystemPrompts;
          }
        });
      }

      // add default summarize model for every session
      if (version < 3.2) {
        newState.sessions.forEach((s) => {
          const config = useAppConfig.getState();
          s.mask.modelConfig.compressModel = config.modelConfig.compressModel;
          s.mask.modelConfig.compressProviderName =
            config.modelConfig.compressProviderName;
        });
      }
      // revert default summarize model for every session
      if (version < 3.3) {
        newState.sessions.forEach((s) => {
          s.mask.modelConfig.compressModel = "";
          s.mask.modelConfig.compressProviderName = "";
        });
      }

      if (version < 3.4) {
        newState.sessions.forEach((session) => {
          if (hasLeakedTopicReasoning(session.topic)) {
            session.topic = resolveChatTopic(
              "",
              session.messages,
              DEFAULT_TOPIC,
            );
          }
        });
      }

      if (version < 3.5) {
        newState.sessions.forEach((session) =>
          migrateChatParams(session.mask.modelConfig),
        );
      }
      newState.sessions = normalizeChatProjectSessions(
        newState.sessions,
        newState.projects,
      );
      return newState as any;
    },
  },
);
