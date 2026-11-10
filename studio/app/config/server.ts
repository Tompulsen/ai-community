import { DEFAULT_GA_ID } from "../constant";
import { isGPT4Model } from "../utils/model";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PROXY_URL?: string; // docker only

      OPENAI_API_KEY?: string;

      BASE_URL?: string;
      OPENAI_ORG_ID?: string; // openai only

      VERCEL?: string;
      BUILD_MODE?: "standalone" | "export";
      BUILD_APP?: string; // is building desktop app

      HIDE_USER_API_KEY?: string; // disable user's api key input
      DISABLE_GPT4?: string; // allow user to use gpt-4 or not
      ENABLE_BALANCE_QUERY?: string; // allow user to query balance or not
      DISABLE_FAST_LINK?: string; // disallow parse settings from url or not
      CUSTOM_MODELS?: string; // to control custom models
      DEFAULT_MODEL?: string; // to control default model in every new chat window

      // google tag manager
      GTM_ID?: string;

      // custom template for preprocessing user input
      DEFAULT_INPUT_TEMPLATE?: string;

      ENABLE_MCP?: string; // enable mcp functionality

      // site access password (supports multiple, comma-separated)
      ACCESS_PASSWORD?: string;

      // remote models api url (NewAPI compatible)
      MODELS_API_URL?: string;

      // upstream API key (server-side only, never exposed to client)
      MODEL_API_KEY?: string;
      NEW_API_BASE_URL?: string;
      NEW_API_PUBLIC_URL?: string;
      NEW_API_SESSION_SECRET?: string;
      NEW_API_REDIS_URL?: string;
      NEW_API_TRUST_PROXY?: string;

      // rate limit config
      ENABLE_RATE_LIMIT?: string;
      RATE_LIMIT_MAX?: string;
      RATE_LIMIT_WINDOW?: string;

      // announcement config
      ANNOUNCEMENT_ID?: string;
      ANNOUNCEMENT_TITLE?: string;
      ANNOUNCEMENT_CONTENT?: string;
      ANNOUNCEMENT_TYPE?: string;
    }
  }
}

function getApiKey(keys?: string) {
  const apiKeyEnvVar = keys ?? "";
  const apiKeys = apiKeyEnvVar.split(",").map((v) => v.trim());
  const randomIndex = Math.floor(Math.random() * apiKeys.length);
  const apiKey = apiKeys[randomIndex];
  return apiKey;
}

export const getServerSideConfig = () => {
  if (typeof process === "undefined") {
    throw Error(
      "[Server Config] you are importing a nodejs-only module outside of nodejs",
    );
  }

  const disableGPT4 = !!process.env.DISABLE_GPT4;
  const accessPassword = process.env.ACCESS_PASSWORD?.trim() || "";
  const accessPasswords = accessPassword
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  let customModels = process.env.CUSTOM_MODELS ?? "";
  let defaultModel = process.env.DEFAULT_MODEL ?? "";

  if (disableGPT4) {
    if (defaultModel && isGPT4Model(defaultModel)) {
      defaultModel = "";
    }
  }

  return {
    baseUrl: process.env.BASE_URL || "https://zhangyuapi.com",
    apiKey: getApiKey(process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY),

    gtmId: process.env.GTM_ID,
    gaId: process.env.GA_ID || DEFAULT_GA_ID,

    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    cloudflareKVNamespaceId: process.env.CLOUDFLARE_KV_NAMESPACE_ID,
    cloudflareKVApiKey: getApiKey(process.env.CLOUDFLARE_KV_API_KEY),
    cloudflareKVTTL: process.env.CLOUDFLARE_KV_TTL,

    needCode: accessPasswords.length > 0,

    proxyUrl: process.env.PROXY_URL,
    isVercel: !!process.env.VERCEL,

    newApiEnabled: Boolean(process.env.NEW_API_BASE_URL?.trim()),
    hideUserApiKey:
      Boolean(process.env.NEW_API_BASE_URL?.trim()) ||
      !!process.env.HIDE_USER_API_KEY,
    disableGPT4,
    hideBalanceQuery: !process.env.ENABLE_BALANCE_QUERY,
    disableFastLink: !!process.env.DISABLE_FAST_LINK,
    customModels,
    defaultModel,
    enableMcp: process.env.ENABLE_MCP === "true",

    modelsApiUrl: process.env.MODELS_API_URL,

    accessPassword,
    accessPasswords,
  };
};
