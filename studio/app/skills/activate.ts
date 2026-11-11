import type { LLMModel } from "../client/api";
import type { SkillDefinition } from "./catalog";
import { getModelCapabilities } from "../utils/model-capabilities";
import { shouldUseImageGenerationApi } from "../utils";

export function skillModelSelection(
  skill: SkillDefinition,
  current: { model: string; providerName?: string; chatApiFormat?: string },
  models: LLMModel[],
  customImageMode: boolean,
) {
  const wantsImage = skill.kind === "image-style";
  const capabilities = getModelCapabilities(
    current.model,
    current.providerName,
  );
  const usesImageApi = (model: LLMModel) =>
    getModelCapabilities(model.name, model.provider.providerName).usesImageApi;
  const imageRoute = shouldUseImageGenerationApi(current, {
    capabilities,
    customImageMode,
  });
  if (
    imageRoute === wantsImage &&
    !(
      skill.kind === "document" &&
      capabilities.category &&
      !["chat", "code"].includes(capabilities.category)
    )
  )
    return;
  const forcedImageMode = customImageMode && capabilities.override === "auto";
  if (forcedImageMode && wantsImage)
    return { chatApiFormat: "chat-completions" as const };
  if (forcedImageMode)
    throw new Error("当前使用生图接口，请切换为聊天接口后启用此技能");
  const compatible = models.find((model) => {
    if (!model.available) return false;
    if (wantsImage) return usesImageApi(model);
    const category = getModelCapabilities(
      model.name,
      model.provider.providerName,
    ).category;
    return !category || category === "chat" || category === "code";
  });
  if (!compatible)
    throw new Error(
      wantsImage
        ? "当前分组暂无可用的生图模型，请选择支持生图的分组"
        : "当前分组暂无可用的聊天模型，请选择支持聊天的分组",
    );
  return {
    model: compatible.name,
    providerName: compatible.provider.providerName,
    ...(wantsImage ? { chatApiFormat: "chat-completions" as const } : {}),
  };
}
