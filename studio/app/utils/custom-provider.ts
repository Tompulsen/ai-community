import { getLocalScope, localKey } from "./local-workspace";

export type CustomApiMode = "auto" | "images" | "responses";
export const CUSTOM_MODEL_PROVIDER = "octopus-custom";

export function usesCustomProvider(
  _state: { newApiEnabled: boolean; useCustomConfig: boolean },
  providerName?: string,
) {
  return providerName === CUSTOM_MODEL_PROVIDER;
}

export const DEFAULT_CUSTOM_PROVIDER = {
  useCustomConfig: false,
  customConfigName: "",
  customApiMode: "auto" as CustomApiMode,
  customModelNames: "",
  openaiUrl: "",
  openaiApiKey: "",
};

export function readCustomProvider(legacy?: typeof DEFAULT_CUSTOM_PROVIDER) {
  try {
    const input = JSON.parse(
      localStorage.getItem(localKey("custom-provider")) || "null",
    );
    if (!input) {
      if (legacy && getLocalScope() === "legacy") {
        saveCustomProvider(legacy);
        return legacy;
      }
      return { ...DEFAULT_CUSTOM_PROVIDER };
    }
    return {
      useCustomConfig: input.useCustomConfig === true,
      customConfigName:
        typeof input.customConfigName === "string"
          ? input.customConfigName
          : "",
      customApiMode: ["auto", "images", "responses"].includes(
        input.customApiMode,
      )
        ? (input.customApiMode as CustomApiMode)
        : ("auto" as CustomApiMode),
      customModelNames:
        typeof input.customModelNames === "string"
          ? input.customModelNames
          : "",
      openaiUrl: typeof input.openaiUrl === "string" ? input.openaiUrl : "",
      openaiApiKey:
        typeof input.openaiApiKey === "string" ? input.openaiApiKey : "",
    };
  } catch {
    return { ...DEFAULT_CUSTOM_PROVIDER };
  }
}

export function saveCustomProvider(profile: typeof DEFAULT_CUSTOM_PROVIDER) {
  localStorage.setItem(localKey("custom-provider"), JSON.stringify(profile));
}

export function customApiPath(base: string, endpoint: string) {
  const url = new URL(base.trim());
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "API URL 必须是有效的 HTTP(S) 地址，不能包含密钥或查询参数",
    );
  const path =
    url.pathname === "/" && !base.trim().endsWith("/") ? "/v1" : url.pathname;
  url.pathname = `${path.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
  return url.href;
}

export function isAccountModelMode(state: {
  newApiEnabled: boolean;
  useCustomConfig: boolean;
}) {
  return state.newApiEnabled;
}
