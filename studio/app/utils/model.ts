import { LLMModel } from "../client/api";

const MODEL_VENDORS = [
  ["agnes", /^agnes(?:-|$)/, "Agnes AI"],
  ["openai", /^(?:gpt(?:-|$)|chatgpt|dall-?e|o[134](?:-|$))/, "OpenAI"],
  ["gemini", /^(?:gemini|learnlm)/, "Google"],
  ["gemma", /^gemma/, "Google"],
  ["claude", /^claude/, "Anthropic"],
  ["meta", /llama/, "Meta"],
  [
    "mistral",
    /^(?:mistral|mixtral|codestral|pixtral|devstral|magistral)/,
    "Mistral",
  ],
  ["deepseek", /deepseek/, "DeepSeek"],
  ["moonshot", /^(?:moonshot|kimi)/, "月之暗面"],
  ["qwen", /^(?:qwen|qwq|qvq|wanx)/, "通义千问"],
  ["wenxin", /^(?:ernie|wenxin)/, "文心一言"],
  ["grok", /^grok/, "xAI"],
  ["hunyuan", /^hunyuan/, "混元"],
  ["doubao", /^(?:doubao|ep-)/, "豆包"],
  ["chatglm", /^(?:glm|chatglm|cogview|cogvideo)/, "智谱"],
  ["minimax", /^(?:minimax|abab|hailuo)/, "MiniMax"],
  ["stepfun", /^(?:step(?:-|fun))/, "阶跃星辰"],
  ["spark", /^(?:spark|iflytek)/, "讯飞"],
  ["baichuan", /^baichuan/, "百川"],
  ["yi", /^yi(?:-|$)/, "零一万物"],
  ["cohere", /^(?:command(?:-|$)|cohere)/, "Cohere"],
  ["nvidia", /^(?:nvidia|nemotron)/, "NVIDIA"],
  ["perplexity", /^(?:sonar|perplexity)/, "Perplexity"],
  ["baai", /^(?:bge|baai)/, "BAAI"],
] as const;

export type ModelVendor = (typeof MODEL_VENDORS)[number][0] | "other";

function findModelVendor(modelName: string) {
  const name = modelName.toLowerCase().split("/").pop() ?? "";
  return MODEL_VENDORS.find(([, pattern]) => pattern.test(name));
}

export function getModelVendor(modelName: string): ModelVendor {
  return findModelVendor(modelName)?.[0] ?? "other";
}

export function getModelVendorName(modelName: string): string | undefined {
  return findModelVendor(modelName)?.[2];
}

const CustomSeq = {
  val: -1000, //To ensure the custom model located at front, start from -1000, refer to constant.ts
  cache: new Map<string, number>(),
  next: (id: string) => {
    if (CustomSeq.cache.has(id)) {
      return CustomSeq.cache.get(id) as number;
    } else {
      let seq = CustomSeq.val++;
      CustomSeq.cache.set(id, seq);
      return seq;
    }
  },
};

const customProvider = (providerName: string) => ({
  id: providerName.toLowerCase(),
  providerName: providerName,
  providerType: "custom",
  sorted: CustomSeq.next(providerName),
});

/**
 * Sorts an array of models based on specified rules.
 *
 * First, sorted by provider; if the same, sorted by model
 */
const sortModelTable = (models: ReturnType<typeof collectModels>) =>
  models.sort((a, b) => {
    if (a.provider && b.provider) {
      let cmp = a.provider.sorted - b.provider.sorted;
      return cmp === 0 ? a.sorted - b.sorted : cmp;
    } else {
      return a.sorted - b.sorted;
    }
  });

/**
 * get model name and provider from a formatted string,
 * e.g. `gpt-4@OpenAi` or `claude-3-5-sonnet@20240620@Google`
 * @param modelWithProvider model name with provider separated by last `@` char,
 * @returns [model, provider] tuple, if no `@` char found, provider is undefined
 */
export function getModelProvider(modelWithProvider: string): [string, string?] {
  const [model, provider] = modelWithProvider.split(/@(?!.*@)/);
  return [model, provider];
}

export function collectModelTable(
  models: readonly LLMModel[],
  customModels: string,
) {
  const modelTable: Record<
    string,
    {
      available: boolean;
      name: string;
      displayName: string;
      sorted: number;
      provider?: LLMModel["provider"]; // Marked as optional
      isDefault?: boolean;
    }
  > = {};

  // default models
  models.forEach((m) => {
    // using <modelName>@<providerId> as fullName
    modelTable[`${m.name}@${m?.provider?.id}`] = {
      ...m,
      displayName: m.name, // 'provider' is copied over if it exists
    };
  });

  // server custom models
  customModels
    .split(",")
    .filter((v) => !!v && v.length > 0)
    .forEach((m) => {
      const available = !m.startsWith("-");
      const nameConfig =
        m.startsWith("+") || m.startsWith("-") ? m.slice(1) : m;
      let [name, displayName] = nameConfig.split("=");

      // enable or disable all models
      if (name === "all") {
        Object.values(modelTable).forEach(
          (model) => (model.available = available),
        );
      } else {
        // 1. find model by name, and set available value
        const [customModelName, customProviderName] = getModelProvider(name);
        let count = 0;
        for (const fullName in modelTable) {
          const [modelName, providerName] = getModelProvider(fullName);
          if (
            customModelName == modelName &&
            (customProviderName === undefined ||
              customProviderName === providerName)
          ) {
            count += 1;
            modelTable[fullName]["available"] = available;
            if (displayName) {
              modelTable[fullName]["displayName"] = displayName;
            }
          }
        }
        // 2. if model not exists, create new model with available value
        if (count === 0) {
          let [customModelName, customProviderName] = getModelProvider(name);
          const provider = customProvider(
            customProviderName || customModelName,
          );
          modelTable[`${customModelName}@${provider?.id}`] = {
            name: customModelName,
            displayName: displayName || customModelName,
            available,
            provider, // Use optional chaining
            sorted: CustomSeq.next(`${customModelName}@${provider?.id}`),
          };
        }
      }
    });

  return modelTable;
}

export function collectModelTableWithDefaultModel(
  models: readonly LLMModel[],
  customModels: string,
  defaultModel: string,
) {
  let modelTable = collectModelTable(models, customModels);
  if (defaultModel && defaultModel !== "") {
    if (defaultModel.includes("@")) {
      if (defaultModel in modelTable) {
        modelTable[defaultModel].isDefault = true;
      }
    } else {
      for (const key of Object.keys(modelTable)) {
        if (
          modelTable[key].available &&
          getModelProvider(key)[0] == defaultModel
        ) {
          modelTable[key].isDefault = true;
          break;
        }
      }
    }
  }
  return modelTable;
}

/**
 * Generate full model table.
 */
export function collectModels(
  models: readonly LLMModel[],
  customModels: string,
) {
  const modelTable = collectModelTable(models, customModels);
  let allModels = Object.values(modelTable);

  allModels = sortModelTable(allModels);

  return allModels;
}

export function collectModelsWithDefaultModel(
  models: readonly LLMModel[],
  customModels: string,
  defaultModel: string,
) {
  const modelTable = collectModelTableWithDefaultModel(
    models,
    customModels,
    defaultModel,
  );
  let allModels = Object.values(modelTable);

  allModels = sortModelTable(allModels);

  return allModels;
}

export function isModelAvailableInServer(
  customModels: string,
  modelName: string,
  providerName: string,
) {
  const fullName = `${modelName}@${providerName}`;
  const modelTable = collectModelTable([], customModels);
  return modelTable[fullName]?.available === false;
}

/**
 * Check if the model name is a GPT-4 related model
 *
 * @param modelName The name of the model to check
 * @returns True if the model is a GPT-4 related model (excluding gpt-4o-mini)
 */
export function isGPT4Model(modelName: string): boolean {
  return (
    (modelName.startsWith("gpt-4") ||
      modelName.startsWith("chatgpt-4o") ||
      modelName.startsWith("o1")) &&
    !modelName.startsWith("gpt-4o-mini")
  );
}

/**
 * Checks if a model is not available on the server.
 *
 * @param {string} customModels - A string of custom models, comma-separated.
 * @param {string} modelName - The name of the model to check.
 *
 * @returns {boolean} True if the model is not available, false otherwise.
 */
export function isModelNotavailableInServer(
  customModels: string,
  modelName: string,
): boolean {
  // Check DISABLE_GPT4 environment variable
  if (
    process.env.DISABLE_GPT4 === "1" &&
    isGPT4Model(modelName.toLowerCase())
  ) {
    return true;
  }

  // If no custom models configured, all models are available
  if (!customModels || customModels.trim() === "") {
    return false;
  }

  const modelTable = collectModelTable([], customModels);

  // Check if model exists with any provider suffix
  for (const fullName in modelTable) {
    const [name] = getModelProvider(fullName);
    if (name === modelName && modelTable[fullName].available) {
      return false;
    }
  }
  return true;
}
