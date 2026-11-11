import { isModelNotavailableInServer } from "../app/utils/model";

describe("isModelNotavailableInServer", () => {
  test("test model will return false, which means the model is available", () => {
    const customModels = "";
    const modelName = "gpt-4";
    const result = isModelNotavailableInServer(customModels, modelName);
    expect(result).toBe(false);
  });

  test("test model will return true when model is not available in custom models", () => {
    const customModels = "-all,gpt-4o-mini";
    const modelName = "gpt-4";
    const result = isModelNotavailableInServer(customModels, modelName);
    expect(result).toBe(true);
  });

  test("should respect DISABLE_GPT4 setting", () => {
    process.env.DISABLE_GPT4 = "1";
    const result = isModelNotavailableInServer("", "gpt-4");
    expect(result).toBe(true);
    delete process.env.DISABLE_GPT4;
  });

  test("should handle custom models with -all and specific model", () => {
    // -all disables all models, then gpt-4 enables it
    const result = isModelNotavailableInServer("-all,gpt-4", "gpt-4");
    expect(result).toBe(false);
  });

  test("should be case insensitive for model names", () => {
    const result = isModelNotavailableInServer("-all,GPT-4", "gpt-4");
    expect(result).toBe(true);
  });

  test("test custom model without setting provider", () => {
    const customModels = "-all,mistral-large";
    const modelName = "mistral-large";
    const result = isModelNotavailableInServer(customModels, modelName);
    expect(result).toBe(false);
  });
});
