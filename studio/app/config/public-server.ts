import { getServerSideConfig } from "./server";

// Keep the browser configuration allowlist shared by both startup endpoints.
export function getPublicServerConfig() {
  const config = getServerSideConfig();
  return {
    needCode: config.needCode,
    hideUserApiKey: config.hideUserApiKey,
    disableGPT4: config.disableGPT4,
    hideBalanceQuery: config.hideBalanceQuery,
    disableFastLink: config.disableFastLink,
    customModels: config.customModels,
    defaultModel: config.defaultModel,
    hasModelApiKey: !!config.apiKey,
    hasModelsApiUrl: !!config.modelsApiUrl,
    newApiEnabled: config.newApiEnabled,
  };
}
