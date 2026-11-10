import { LLMModel } from "../client/api";
import { DalleQuality, DalleStyle, ModelSize } from "../typing";
import { getClientConfig } from "../config/client";
import {
  DEFAULT_INPUT_TEMPLATE,
  DEFAULT_SIDEBAR_WIDTH,
  StoreKey,
} from "../constant";
import { createPersistStore } from "../utils/store";
import type { ChatApiFormat } from "../utils/chat-api-format";
import { migrateChatParams, type ReasoningEffort } from "../utils/chat-params";
import {
  validCompressThreshold,
  validContextBudget,
} from "../utils/context-budget";
import { getMotionPreference, type MotionPreference } from "../utils/motion";
import type { VideoDraft } from "./video";

export type ModelType = string;

export enum SubmitKey {
  Enter = "Enter",
  CtrlEnter = "Ctrl + Enter",
  ShiftEnter = "Shift + Enter",
  AltEnter = "Alt + Enter",
  MetaEnter = "Meta + Enter",
}

export enum Theme {
  Auto = "auto",
  Dark = "dark",
  Light = "light",
}

export type ColorTheme =
  | "blue"
  | "teal"
  | "coral"
  | "violet"
  | "green"
  | "rose"
  | "graphite"
  | "indigo"
  | "emerald"
  | "fuchsia"
  | "amber"
  | "sky"
  | "pink"
  | "orange"
  | "slate"
  | "lime"
  | "red"
  | "cyan"
  | "yellow"
  | "purple"
  | "stone";

export const COLOR_THEMES: {
  value: ColorTheme;
  label: string;
}[] = [
  { value: "blue", label: "苹果蓝" },
  { value: "indigo", label: "靛蓝" },
  { value: "sky", label: "天蓝" },
  { value: "cyan", label: "霓虹青" },
  { value: "teal", label: "海洋青" },
  { value: "emerald", label: "翡翠绿" },
  { value: "green", label: "森林绿" },
  { value: "lime", label: "青柠" },
  { value: "amber", label: "琥珀金" },
  { value: "orange", label: "活力橙" },
  { value: "coral", label: "暖阳珊瑚" },
  { value: "red", label: "红色" },
  { value: "rose", label: "玫瑰粉" },
  { value: "pink", label: "樱花粉" },
  { value: "fuchsia", label: "品红" },
  { value: "violet", label: "紫罗兰" },
  { value: "graphite", label: "暗夜石墨" },
  { value: "slate", label: "岩灰蓝" },
  { value: "yellow", label: "明黄" },
  { value: "purple", label: "深紫" },
  { value: "stone", label: "暖石灰" },
];

const config = getClientConfig();

export const DEFAULT_CONFIG = {
  lastUpdate: Date.now(), // timestamp, to merge state

  submitKey: SubmitKey.Enter,
  avatar: "1f603",
  fontSize: 17,
  fontFamily: "",
  theme: Theme.Light as Theme,
  colorTheme: "blue" as ColorTheme,
  motionPreference: "system" as MotionPreference,
  reduceMotion: false,
  tightBorder: !!config?.isApp,
  sendPreviewBubble: true,
  enableAutoGenerateTitle: true,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,

  enableArtifacts: true, // show artifacts config

  enableCodeFold: true, // code fold config

  showGridBackground: false, // grid background toggle

  disablePromptHint: false,

  dontShowMaskSplashScreen: true, // 新建聊天默认跳过面具选择
  hideBuiltinMasks: false, // dont add builtin masks

  customModels: "",
  models: [] as LLMModel[],
  favoriteModels: [] as string[],
  videoRequestMode: "sync" as "sync" | "async",
  speechVoiceURI: "",
  speechRate: 1,

  modelConfig: {
    model: "gpt-image-2" as ModelType,
    chatApiFormat: "chat-completions" as ChatApiFormat,
    providerName: "OpenAI" as string,
    temperature: 0.4,
    top_p: 0.5,
    max_tokens: 128000,
    stream: true,
    reasoningEffort: "auto" as ReasoningEffort,
    stop: "",
    compressionThreshold: 272000,
    presence_penalty: 0,
    frequency_penalty: 0,
    sendMemory: true,
    historyMessageCount: 30,
    compressMessageLengthThreshold: 12000,
    contextBudget: 32768,
    compressModel: "",
    compressProviderName: "",
    enableInjectSystemPrompts: true,
    template: config?.template ?? DEFAULT_INPUT_TEMPLATE,
    size: "auto" as ModelSize,
    resolution: "auto" as import("../utils/image-params").ImageResolution,
    quality: "auto" as DalleQuality,
    style: "auto" as DalleStyle,
    imageOutputFormat:
      "png" as import("../utils/image-params").ImageOutputFormat,
    imageBackground: "auto" as import("../utils/image-params").ImageBackground,
    imageOutputCompression: 100,
    imageResponseFormat:
      "url" as import("../utils/image-params").ImageResponseFormat,
    imageStream: false,
    imageRequestMode: "sync" as "sync" | "async",
    imagePartialImages: 1,
  },
};

export type ChatConfig = typeof DEFAULT_CONFIG;

export type ModelConfig = ChatConfig["modelConfig"] & {
  videoConfig?: Partial<VideoDraft>;
};

export function limitNumber(
  x: number,
  min: number,
  max: number,
  defaultValue: number,
) {
  if (isNaN(x)) {
    return defaultValue;
  }

  return Math.min(max, Math.max(min, x));
}

export const ModalConfigValidator = {
  model(x: string) {
    return x as ModelType;
  },
  max_tokens(x: number) {
    return limitNumber(x, 0, 512000, 1024);
  },
  compressMessageLengthThreshold: validCompressThreshold,
  contextBudget: validContextBudget,
  presence_penalty(x: number) {
    return limitNumber(x, -2, 2, 0);
  },
  frequency_penalty(x: number) {
    return limitNumber(x, -2, 2, 0);
  },
  temperature(x: number) {
    return limitNumber(x, 0, 2, 1);
  },
  top_p(x: number) {
    return limitNumber(x, 0, 1, 1);
  },
};

export const useAppConfig = createPersistStore(
  { ...DEFAULT_CONFIG },
  (set, get) => ({
    reset() {
      set(() => ({ ...DEFAULT_CONFIG }));
    },

    clearModels() {
      set(() => ({ models: [] }));
    },

    mergeModels(newModels: LLMModel[]) {
      if (!newModels || newModels.length === 0) {
        return;
      }

      const oldModels = get().models;
      const modelMap: Record<string, LLMModel> = {};

      for (const model of oldModels) {
        model.available = false;
        modelMap[`${model.name}@${model?.provider?.id}`] = model;
      }

      for (const model of newModels) {
        model.available = true;
        modelMap[`${model.name}@${model?.provider?.id}`] = model;
      }

      set(() => ({
        models: Object.values(modelMap),
      }));
    },
  }),
  {
    name: StoreKey.Config,
    version: 4.4,

    migrate(persistedState, version) {
      const state = persistedState as ChatConfig;
      if (version < 4.4) migrateChatParams(state.modelConfig);
      if (version < 4.3 && state.modelConfig) {
        const previousDefaults = {
          temperature: 0.5,
          top_p: 1,
          max_tokens: 4000,
          historyMessageCount: 4,
          compressMessageLengthThreshold: 1000,
        };
        for (const key of Object.keys(
          previousDefaults,
        ) as (keyof typeof previousDefaults)[]) {
          if (state.modelConfig[key] === previousDefaults[key]) {
            state.modelConfig[key] = DEFAULT_CONFIG.modelConfig[key];
          }
        }
      }
      return state as any;
    },

    merge(persistedState, currentState) {
      const state = persistedState as ChatConfig | undefined;
      if (!state) return { ...currentState };
      const models = currentState.models.slice();
      state.models.forEach((pModel) => {
        const idx = models.findIndex(
          (v) => v.name === pModel.name && v.provider === pModel.provider,
        );
        if (idx !== -1) models[idx] = pModel;
        else models.push(pModel);
      });
      const motionPreference = getMotionPreference(state);
      return {
        ...currentState,
        ...state,
        motionPreference,
        reduceMotion: motionPreference === "reduced",
        models: models,
      };
    },
  },
);
