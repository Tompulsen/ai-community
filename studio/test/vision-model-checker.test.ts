import { jest } from "@jest/globals";
import { getModelMetadata } from "../app/utils/model-metadata";

jest.unstable_mockModule("@/app/store", () => ({
  useAccessStore: {
    getState: () => ({
      visionModels: process.env.VISION_MODELS,
      customApiMode: "images",
    }),
  },
}));
jest.unstable_mockModule("@/app/utils/model-capabilities", () => ({
  getModelCapabilities: (model: string) => ({
    ...getModelMetadata(model),
    override: "auto",
  }),
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showToast: jest.fn(),
}));
jest.unstable_mockModule("@/app/locales", () => ({ default: {} }));
const {
  isImageGenerationModel,
  isImageModel,
  isVisionModel,
  shouldUseImageGenerationApi,
} = await import("../app/utils");

test.each([
  ["gemini-3-pro-image", false],
  ["gemini-3.1-flash-image", false],
  ["gemini-nano-banana-2.1", false],
  ["gpt-image-2", true],
  ["dall-e-3", true],
  ["grok-imagine-image", true],
  ["grok-imagine-image-2.0", true],
])("%s preserves its Images endpoint routing", (model, expected) => {
  expect(isImageGenerationModel(model)).toBe(expected);
});

test("vision input capability does not expose image generation controls", () => {
  expect(isVisionModel("gpt-4o")).toBe(true);
  expect(isImageModel("gpt-4o")).toBe(false);
  expect(
    shouldUseImageGenerationApi(
      { model: "gpt-4o" },
      { customImageMode: false },
    ),
  ).toBe(false);
});

test("explicit model types take priority over saved formats and custom image mode", () => {
  const config = {
    model: "alias",
    providerName: "octopus-custom",
    chatApiFormat: "responses",
  };
  const metadata = getModelMetadata("alias");
  expect(
    shouldUseImageGenerationApi(config, {
      capabilities: {
        ...metadata,
        category: "image",
        usesImageApi: true,
        override: "image",
      },
      customImageMode: false,
    }),
  ).toBe(true);
  for (const override of ["chat", "video"] as const) {
    expect(
      shouldUseImageGenerationApi(
        { ...config, chatApiFormat: "chat-completions" },
        {
          capabilities: { ...metadata, category: override, override },
          customImageMode: true,
        },
      ),
    ).toBe(false);
  }
});

test("automatic routing keeps Gemini image chat and isolates custom endpoint defaults", () => {
  expect(
    shouldUseImageGenerationApi({
      model: "gemini-3-pro-image",
      providerName: "OpenAI",
    }),
  ).toBe(false);
  expect(
    shouldUseImageGenerationApi({
      model: "unknown-image-alias",
      providerName: "octopus-custom",
    }),
  ).toBe(true);
  expect(
    shouldUseImageGenerationApi({
      model: "unknown-image-alias",
      providerName: "OpenAI",
    }),
  ).toBe(false);
  expect(
    shouldUseImageGenerationApi(
      { model: "grok-imagine-image" },
      { hasFiles: true, customImageMode: false },
    ),
  ).toBe(false);
});

test.each(["sora-2", "grok-imagine-video", "veo-3"])(
  "video model %s keeps video routing when custom image mode is enabled",
  (model) => {
    expect(
      shouldUseImageGenerationApi(
        { model, providerName: "octopus-custom" },
        { customImageMode: true },
      ),
    ).toBe(false);
  },
);

describe("isVisionModel", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("should identify vision models using regex patterns", () => {
    const visionModels = [
      "gpt-4-vision",
      "claude-3-opus",
      "claude-3-5-haiku-20241022",
      "gemini-1.5-pro",
      "gemini-2.0",
      "gemini-exp-vision",
      "learnlm-vision",
      "qwen-vl-max",
      "qwen2-vl-max",
      "gpt-4-turbo",
      "dall-e-3",
    ];

    visionModels.forEach((model) => {
      expect(isVisionModel(model)).toBe(true);
    });
  });

  test("should not identify non-vision models", () => {
    const nonVisionModels = [
      "gpt-3.5-turbo",
      "gpt-4-turbo-preview",
      "claude-2",
      "regular-model",
    ];

    nonVisionModels.forEach((model) => {
      expect(isVisionModel(model)).toBe(false);
    });
  });

  test("should identify models from VISION_MODELS env var", () => {
    process.env.VISION_MODELS = "custom-vision-model,another-vision-model";

    expect(isVisionModel("custom-vision-model")).toBe(true);
    expect(isVisionModel("another-vision-model")).toBe(true);
    expect(isVisionModel("unrelated-model")).toBe(false);
  });

  test("should handle empty or missing VISION_MODELS", () => {
    process.env.VISION_MODELS = "";
    expect(isVisionModel("unrelated-model")).toBe(false);

    delete process.env.VISION_MODELS;
    expect(isVisionModel("unrelated-model")).toBe(false);
    expect(isVisionModel("gpt-4-vision")).toBe(true);
  });
});
