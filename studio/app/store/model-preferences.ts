import { StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";
import { isLocalWorkspaceActive } from "../utils/local-workspace";
import type { ModelTypeOverride } from "../utils/model-metadata";
import { CHAT_API_FORMATS, type ChatApiFormat } from "../utils/chat-api-format";
import {
  modelApiFormatsSchema,
  modelTypeOverridesSchema,
  validModelPreferenceKey,
  type ModelApiFormats,
  type ModelTypeOverrides,
} from "../utils/model-preferences";

let hydration = Promise.resolve<unknown>(undefined);

export async function waitForModelPreferences() {
  const error = await hydration;
  if (error) throw new Error("模型设置读取失败，请刷新后重试");
}

export const useModelPreferenceStore = createPersistStore(
  { overrides: {} as ModelTypeOverrides, apiFormats: {} as ModelApiFormats },
  (set, get) => ({
    setModelType(key: string, type: ModelTypeOverride) {
      const state = get();
      if (!state._hasHydrated || !isLocalWorkspaceActive())
        throw new Error("本地设置尚未就绪，请稍后重试");
      if (
        !validModelPreferenceKey(key) ||
        !["auto", "chat", "image", "video"].includes(type)
      )
        throw new Error("模型类型或来源无效，请重新选择模型");
      const overrides = { ...state.overrides };
      if (type === "auto") delete overrides[key];
      else overrides[key] = type;
      if (Object.keys(overrides).length > 2000)
        throw new Error("最多保存 2000 个模型类型设置");
      set({ overrides });
    },
    setModelApiFormat(key: string, format: ChatApiFormat | "auto") {
      const state = get();
      if (!state._hasHydrated || !isLocalWorkspaceActive())
        throw new Error("本地设置尚未就绪，请稍后重试");
      if (
        !validModelPreferenceKey(key) ||
        (format !== "auto" && !CHAT_API_FORMATS.includes(format))
      )
        throw new Error("接口格式或模型来源无效，请重新选择模型");
      const apiFormats = { ...state.apiFormats };
      if (format === "auto") delete apiFormats[key];
      else apiFormats[key] = format;
      if (Object.keys(apiFormats).length > 2000)
        throw new Error("最多保存 2000 个模型接口设置");
      set({ apiFormats });
    },
  }),
  {
    name: StoreKey.ModelPreferences,
    version: 1,
    onRehydrateStorage() {
      let complete!: (error?: unknown) => void;
      hydration = new Promise((resolve) => {
        complete = resolve;
      });
      return (_state, error) => complete(error);
    },
    merge(persisted: unknown, current) {
      const saved = persisted as
        | { overrides?: unknown; apiFormats?: unknown }
        | undefined;
      const parsed = modelTypeOverridesSchema.safeParse(saved?.overrides ?? {});
      const formats = modelApiFormatsSchema.safeParse(saved?.apiFormats ?? {});
      return {
        ...current,
        overrides: parsed.success ? parsed.data : {},
        apiFormats: formats.success ? formats.data : {},
      };
    },
  },
);
