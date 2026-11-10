import { jest } from "@jest/globals";
import {
  getLocalPreviewModels,
  isLocalPreviewEnabled,
  isLocalPreviewModel,
  LOCAL_PREVIEW_COMPRESSION_MODEL,
  LOCAL_PREVIEW_METRICS_MODEL,
  LOCAL_PREVIEW_MEDIA_MODEL,
  LOCAL_PREVIEW_NO_USAGE_MODEL,
  LOCAL_PREVIEW_PROVIDER,
} from "../app/utils/local-preview-models";
import { getModelMetadata } from "../app/utils/model-metadata";

const originalLocation = Object.getOwnPropertyDescriptor(window, "location")!;

function setHostname(hostname: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { hostname } as Location,
  });
}

afterEach(() => {
  Object.defineProperty(window, "location", originalLocation);
  jest.restoreAllMocks();
});

test.each(["production", "test"] as const)(
  "does not add preview models in %s",
  (mode) => {
    jest.replaceProperty(process.env, "NODE_ENV", mode);
    expect(isLocalPreviewEnabled()).toBe(false);
    expect(getLocalPreviewModels()).toEqual([]);
  },
);

test("local development includes text, image and video previews with separate identities", () => {
  jest.replaceProperty(process.env, "NODE_ENV", "development");
  expect(isLocalPreviewEnabled()).toBe(true);
  const models = getLocalPreviewModels();
  expect(models.length).toBeGreaterThan(0);
  expect(new Set(models.map((model) => model.name)).size).toBe(models.length);
  expect(
    new Set(models.map((model) => getModelMetadata(model.name).category)),
  ).toEqual(new Set(["chat", "image", "video"]));
  expect(
    models.every(
      (model) =>
        model.available &&
        model.displayName?.includes("预览") &&
        model.provider.providerName === LOCAL_PREVIEW_PROVIDER,
    ),
  ).toBe(true);
});

test("only the reserved preview provider blocks requests, independently of environment", () => {
  jest.replaceProperty(process.env, "NODE_ENV", "production");
  expect(isLocalPreviewModel(LOCAL_PREVIEW_PROVIDER)).toBe(true);
  expect(isLocalPreviewModel("OpenAI")).toBe(false);
  expect(isLocalPreviewModel("octopus-custom")).toBe(false);
  expect(isLocalPreviewModel()).toBe(false);
});

test("development exposes separately named metrics and compression scenes", () => {
  jest.replaceProperty(process.env, "NODE_ENV", "development");
  const models = getLocalPreviewModels();
  for (const [model, name] of [
    [LOCAL_PREVIEW_MEDIA_MODEL, "图片与视频"],
    [LOCAL_PREVIEW_METRICS_MODEL, "统计变化"],
    [LOCAL_PREVIEW_NO_USAGE_MODEL, "估算统计"],
    [LOCAL_PREVIEW_COMPRESSION_MODEL, "自动压缩"],
  ]) {
    expect(models.find((item) => item.name === model)).toMatchObject({
      displayName: `${name} · 本地预览`,
      available: true,
      provider: {
        providerName: LOCAL_PREVIEW_PROVIDER,
        providerType: "preview",
      },
    });
  }
});

test.each(["localhost", "127.0.0.1", "[::1]", "::1"])(
  "development permits local simulation on %s",
  (hostname) => {
    jest.replaceProperty(process.env, "NODE_ENV", "development");
    setHostname(hostname);
    expect(isLocalPreviewEnabled()).toBe(true);
    expect(getLocalPreviewModels().length).toBeGreaterThan(0);
  },
);

test.each(["example.com", "localhost.example.com", "192.168.1.10"])(
  "development on %s cannot enable simulation or add preview models",
  (hostname) => {
    jest.replaceProperty(process.env, "NODE_ENV", "development");
    setHostname(hostname);
    expect(isLocalPreviewEnabled()).toBe(false);
    expect(getLocalPreviewModels()).toEqual([]);
    expect(isLocalPreviewModel(LOCAL_PREVIEW_PROVIDER)).toBe(true);
  },
);

test("a production loopback origin cannot enable simulation", () => {
  jest.replaceProperty(process.env, "NODE_ENV", "production");
  setHostname("localhost");
  expect(isLocalPreviewEnabled()).toBe(false);
  expect(getLocalPreviewModels()).toEqual([]);
  expect(isLocalPreviewModel(LOCAL_PREVIEW_PROVIDER)).toBe(true);
});
