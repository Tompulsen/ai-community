import { getModelVendor, getModelVendorName } from "../app/utils/model";

describe("model vendor matching shared by chat avatars and the model picker", () => {
  it.each([
    ["agnes-2.5-flash", "agnes", "Agnes AI"],
    ["custom/Agnes-2.5-flash", "agnes", "Agnes AI"],
    ["openai/gpt-4o", "openai", "OpenAI"],
    ["o4-mini", "openai", "OpenAI"],
    ["gemini-2.5-flash", "gemini", "Google"],
    ["claude-sonnet-4", "claude", "Anthropic"],
    ["MiniMax-M2", "minimax", "MiniMax"],
    ["step-3", "stepfun", "阶跃星辰"],
    ["kimi-k2", "moonshot", "月之暗面"],
    ["QwQ-32B", "qwen", "通义千问"],
    ["mistral-small", "mistral", "Mistral"],
    ["spark-v4", "spark", "讯飞"],
    ["baichuan-4", "baichuan", "百川"],
    ["yi-large", "yi", "零一万物"],
    ["command-r-plus", "cohere", "Cohere"],
    ["nvidia/nemotron-70b", "nvidia", "NVIDIA"],
    ["sonar-pro", "perplexity", "Perplexity"],
  ])("%s resolves to its manufacturer", (model, vendor, name) => {
    expect(getModelVendor(model)).toBe(vendor);
    expect(getModelVendorName(model)).toBe(name);
  });

  it.each(["agents-a1", "custom-model", "unknown@OpenAI"])(
    "does not infer a manufacturer for unknown alias %s",
    (model) => {
      expect(getModelVendor(model)).toBe("other");
      expect(getModelVendorName(model)).toBeUndefined();
    },
  );
});
