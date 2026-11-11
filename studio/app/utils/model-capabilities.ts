import { useCallback } from "react";
import { useAccessStore } from "../store/access";
import { useModelPreferenceStore } from "../store/model-preferences";
import { CUSTOM_MODEL_PROVIDER, customApiPath } from "./custom-provider";
import { getLocalTokenId } from "./local-workspace";
import { getModelMetadata, type ModelTypeOverride } from "./model-metadata";
import type { MediaModelType } from "./model-group";
import type { ChatApiFormat } from "./chat-api-format";

function preferenceKey(
  model: string,
  providerName: string | undefined,
  access: { newApiEnabled: boolean; openaiUrl: string },
) {
  if (providerName === CUSTOM_MODEL_PROVIDER) {
    try {
      const endpoint = customApiPath(access.openaiUrl, "");
      return JSON.stringify(["custom", endpoint, model]);
    } catch {
      return "";
    }
  }
  // A selected key identifies the account's group route, without storing its secret.
  if (access.newApiEnabled)
    return JSON.stringify(["account", getLocalTokenId(), model]);
  return JSON.stringify(["site", providerName ?? "", model]);
}

export function getModelPreferenceKey(model: string, providerName?: string) {
  return preferenceKey(model, providerName, useAccessStore.getState());
}

function groupDefault(
  model: string,
  providerName: string | undefined,
  access: ReturnType<typeof useAccessStore.getState>,
) {
  return providerName !== CUSTOM_MODEL_PROVIDER &&
    access.newApiEnabled &&
    access.modelGroupModels?.includes(model) &&
    access.modelGroupTokenId === getLocalTokenId()
    ? access.modelGroupType
    : undefined;
}

function resolveCapabilities(
  model: string,
  override: ModelTypeOverride,
  apiFormat?: ChatApiFormat,
  groupType?: MediaModelType,
) {
  const metadata = getModelMetadata(model);
  return {
    ...metadata,
    ...(groupType
      ? {
          defaultType: groupType,
          category: groupType,
          // Gemini image models keep their native chat transport.
          usesImageApi:
            groupType === "image" &&
            (metadata.category !== "image" || metadata.usesImageApi),
        }
      : {}),
    ...(override !== "auto"
      ? { category: override, usesImageApi: override === "image" }
      : {}),
    override,
    ...(apiFormat ? { apiFormat } : {}),
  };
}

export function getModelCapabilities(model: string, providerName?: string) {
  const key = getModelPreferenceKey(model, providerName);
  return resolveCapabilities(
    model,
    useModelPreferenceStore.getState().overrides[key] ?? "auto",
    useModelPreferenceStore.getState().apiFormats?.[key],
    groupDefault(model, providerName, useAccessStore.getState()),
  );
}

export function useModelCapabilitiesResolver() {
  const access = useAccessStore();
  const overrides = useModelPreferenceStore((state) => state.overrides);
  const apiFormats = useModelPreferenceStore((state) => state.apiFormats);
  return useCallback(
    (model: string, providerName?: string) =>
      resolveCapabilities(
        model,
        overrides[preferenceKey(model, providerName, access)] ?? "auto",
        apiFormats?.[preferenceKey(model, providerName, access)],
        groupDefault(model, providerName, access),
      ),
    [access, overrides, apiFormats],
  );
}

export function useModelCapabilities(model: string, providerName?: string) {
  const key = useAccessStore((access) =>
    preferenceKey(model, providerName, access),
  );
  const override = useModelPreferenceStore(
    (state) => state.overrides[key] ?? "auto",
  );
  const apiFormat = useModelPreferenceStore((state) => state.apiFormats?.[key]);
  const groupType = useAccessStore((access) =>
    groupDefault(model, providerName, access),
  );
  return resolveCapabilities(model, override, apiFormat, groupType);
}
