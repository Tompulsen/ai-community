export const OWNER = "qzq00767";
export const REPO = "octopus_chat";
export const REPO_URL = `https://github.com/${OWNER}/${REPO}`;
export const ISSUE_URL = `https://github.com/${OWNER}/${REPO}/issues`;
export const UPDATE_URL = `${REPO_URL}#keep-updated`;
export const RELEASE_URL = `${REPO_URL}/releases`;
export const FETCH_COMMIT_URL = `https://api.github.com/repos/${OWNER}/${REPO}/commits?per_page=1`;
export const FETCH_TAG_URL = `https://api.github.com/repos/${OWNER}/${REPO}/tags?per_page=1`;

export const OPENAI_BASE_URL = "https://zhangyuapi.com";

export const CACHE_URL_PREFIX = "/studio/api/cache";
export const UPLOAD_URL = `${CACHE_URL_PREFIX}/upload`;

export enum Path {
  Home = "/",
  Chat = "/chat",
  Settings = "/settings",
  Account = "/account",
  Pricing = "/pricing",
  NewChat = "/new-chat",
  Masks = "/masks",
  Auth = "/auth",
  Artifacts = "/artifacts",
  SearchChat = "/search-chat",
  McpMarket = "/mcp-market",
  Gallery = "/gallery",
  Share = "/share",
  Video = "/video-workspace",
  Skills = "/skills",
}

export enum ApiPath {
  Cors = "",
  V1 = "/studio/api/v1",
  Artifacts = "/studio/api/artifacts",
}

export enum ModelType {
  Text = "text",
  Image = "image",
  Video = "video",
}

export enum SlotID {
  AppBody = "app-body",
  CustomModel = "custom-model",
}

export enum FileName {
  Masks = "masks.json",
  Prompts = "prompts.json",
}

export enum StoreKey {
  Chat = "chat-next-web-store",
  Access = "access-control",
  Config = "app-config",
  Mask = "mask-store",
  Prompt = "prompt-store",
  Update = "chat-update",
  Sync = "sync",
  SdList = "sd-list",
  Mcp = "mcp-store",
  Skills = "skills-store",
  ModelPreferences = "model-preferences",
}

export const DEFAULT_SIDEBAR_WIDTH = 300;
export const MAX_SIDEBAR_WIDTH = 500;
export const MIN_SIDEBAR_WIDTH = 230;
export const NARROW_SIDEBAR_WIDTH = 48;

export const UNFINISHED_INPUT = (id: string) => "unfinished-input-" + id;

export const STORAGE_KEY = "chatgpt-next-web";

export const REQUEST_TIMEOUT_MS = 360000;
export const REQUEST_TIMEOUT_MS_FOR_THINKING = REQUEST_TIMEOUT_MS * 5;

export const EXPORT_MESSAGE_CLASS_NAME = "export-markdown";

export const OpenaiPath = {
  ChatPath: "chat/completions",
  ImagePath: "images/generations",
  EditPath: "images/edits",
  VariationPath: "images/variations",
  UsagePath: "dashboard/billing/usage",
  SubsPath: "dashboard/billing/subscription",
  ListModelPath: "models",
};

export const DEFAULT_INPUT_TEMPLATE = `{{input}}`; // input / time / model / lang

export const DEFAULT_SYSTEM_TEMPLATE = `
You are ChatGPT, a large language model trained by {{ServiceProvider}}.
Knowledge cutoff: {{cutoff}}
Current model: {{model}}
Current time: {{time}}
Latex inline: \\(x^2\\) 
Latex block: $$e=mc^2$$
`;

export const SUMMARIZE_MODEL = "gpt-4o-mini";

export const KnowledgeCutOffDate: Record<string, string> = {
  default: "2021-09",
  "gpt-4-turbo": "2023-12",
  "gpt-4-turbo-2024-04-09": "2023-12",
  "gpt-4-turbo-preview": "2023-12",
  "gpt-4.1": "2024-06",
  "gpt-4.1-2025-04-14": "2024-06",
  "gpt-4.1-mini": "2024-06",
  "gpt-4.1-mini-2025-04-14": "2024-06",
  "gpt-4.1-nano": "2024-06",
  "gpt-4.1-nano-2025-04-14": "2024-06",
  "gpt-4.5-preview": "2023-10",
  "gpt-4.5-preview-2025-02-27": "2023-10",
  "gpt-4o": "2023-10",
  "gpt-4o-2024-05-13": "2023-10",
  "gpt-4o-2024-08-06": "2023-10",
  "gpt-4o-2024-11-20": "2023-10",
  "chatgpt-4o-latest": "2023-10",
  "gpt-4o-mini": "2023-10",
  "gpt-4o-mini-2024-07-18": "2023-10",
  "gpt-4-vision-preview": "2023-04",
  "o1-mini-2024-09-12": "2023-10",
  "o1-mini": "2023-10",
  "o1-preview-2024-09-12": "2023-10",
  "o1-preview": "2023-10",
  "o1-2024-12-17": "2023-10",
  o1: "2023-10",
  "o3-mini-2025-01-31": "2023-10",
  "o3-mini": "2023-10",
};

export const VISION_MODEL_REGEXES = [
  /vision/,
  /gpt-4o/,
  /gpt-4\.1/,
  /gpt-4-turbo(?!.*preview)/,
  /^dall-e-3$/,
  /o3/,
  /o4-mini/,
  /gpt-5/,
  /claude-(?:3|sonnet-4|opus-4|haiku-4)/,
  /gemini-(?:1\.5|2|3)/,
  /qwen(?:\d+(?:\.\d+)?)?-vl/,
];

/**
 * 视频生成模型名称正则列表
 * 用于从模型列表中自动识别视频模型（文生视�?/ 图生视频 / 首尾帧）
 */
export const VIDEO_MODEL_REGEXES = [
  /seedance/i,
  /^veo(?:[-_.]?\d|$)/i,
  /t2v/i,
  /i2v/i,
  /s2v/i,
  /video/i,
  /sora/i,
  /runway/i,
  /pika/i,
  /gen-[23]/i,
  /luma/i,
  /kling/i,
  /hailuo/i,
  /minimax-m[12]/i,
  /wanx2\.1-(t2v|i2v)/i,
  /chat_fast_video/i,
];

export const CHAT_PAGE_SIZE = 15;

export const DEFAULT_GA_ID = "G-89WN60ZK2E";

export const SAAS_CHAT_URL = "https://zhangyuapi.com";
export const SAAS_CHAT_UTM_URL = "https://zhangyuapi.com?utm=github";
