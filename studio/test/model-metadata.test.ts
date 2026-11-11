import { getModelMetadata } from "../app/utils/model-metadata";

test.each([
  "doubao-seedance-2-0-260128",
  "seedance-2.5",
  "volcengine/doubao-seedance-1-5-pro",
])("%s is classified as a video model", (model) =>
  expect(getModelMetadata(model).category).toBe("video"),
);
test.each([
  "veo-2.0-generate-001",
  "veo-3.1-generate-preview",
  "google/veo3.1",
])("%s is available in the video workspace", (model) =>
  expect(getModelMetadata(model).category).toBe("video"),
);

test.each([
  "gemini-3-pro-image",
  "gemini-3.1-flash-image",
  "gemini-nano-banana-2.1",
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.5-flash-image-preview",
  "google/GEMINI-3-PRO-IMAGE",
])(
  "%s has an image label without switching to the Images endpoint",
  (model) => {
    expect(getModelMetadata(model)).toMatchObject({
      category: "image",
      vendor: "gemini",
      usesImageApi: false,
    });
  },
);

test.each(["gemini-3-pro", "gemini-3.1-flash", "gemini-2.5-flash"])(
  "%s remains a chat model",
  (model) => {
    expect(getModelMetadata(model)).toMatchObject({
      category: "chat",
      usesImageApi: false,
    });
  },
);

test.each([
  "gpt-image-2",
  "gpt-image-2.5-flare",
  "dall-e-3",
  "flux-1",
  "grok-imagine-image",
  "grok-imagine-image-2.0",
  "xai/GROK-IMAGINE-IMAGE",
])("%s retains the Images endpoint", (model) => {
  expect(getModelMetadata(model)).toMatchObject({
    category: "image",
    usesImageApi: true,
  });
});

test.each(["grok-4", "grok-4-vision", "grok-imagine-video"])(
  "%s does not acquire the Images endpoint from its vendor",
  (model) => {
    expect(getModelMetadata(model).usesImageApi).toBe(false);
  },
);
