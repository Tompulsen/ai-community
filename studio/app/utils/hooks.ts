import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { collectModelsWithDefaultModel } from "./model";
import { isAccountModelMode, CUSTOM_MODEL_PROVIDER } from "./custom-provider";
import { customModelNames } from "./custom-provider-models";
import { getLocalPreviewModels } from "./local-preview-models";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const accountMode = isAccountModelMode(accessStore);
  const models = useMemo(() => {
    const standard = collectModelsWithDefaultModel(
      configStore.models,
      accountMode
        ? ""
        : [configStore.customModels, accessStore.customModels].join(","),
      accessStore.defaultModel,
    );
    const external = accessStore.useCustomConfig
      ? customModelNames(accessStore.customModelNames).map((name, sorted) => ({
          name,
          displayName: name,
          available: true,
          sorted,
          isDefault: false,
          provider: {
            id: CUSTOM_MODEL_PROVIDER,
            providerName: CUSTOM_MODEL_PROVIDER,
            providerType: "custom",
            sorted: 0,
          },
        }))
      : [];
    return [...standard, ...external, ...getLocalPreviewModels()];
  }, [
    accessStore.customModels,
    accountMode,
    accessStore.useCustomConfig,
    accessStore.customModelNames,
    accessStore.defaultModel,
    configStore.customModels,
    configStore.models,
  ]);

  return models;
}
