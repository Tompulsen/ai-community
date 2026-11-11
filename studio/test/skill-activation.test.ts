import { jest } from "@jest/globals";
import type { SkillDefinition } from "../app/skills/catalog";
import type { LLMModel } from "../app/client/api";
import {
  getModelMetadata,
  type ModelTypeOverride,
} from "../app/utils/model-metadata";

const overrides = new Map<string, ModelTypeOverride>();
jest.unstable_mockModule("@/app/store", () => ({
  useAccessStore: { getState: () => ({}) },
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showToast: jest.fn(),
}));
jest.unstable_mockModule("@/app/locales", () => ({ default: {} }));
jest.unstable_mockModule("@/app/utils/model-capabilities", () => ({
  getModelCapabilities: (name: string, providerName?: string) => {
    const metadata = getModelMetadata(name);
    const override = overrides.get(`${providerName ?? ""}:${name}`) ?? "auto";
    return {
      ...metadata,
      ...(override !== "auto"
        ? { category: override, usesImageApi: override === "image" }
        : {}),
      override,
    };
  },
}));
const { skillModelSelection } = await import("../app/skills/activate");

const skill = { kind: "prompt" } as SkillDefinition;
const style = { kind: "image-style" } as SkillDefinition;
const model = (name: string, available = true): LLMModel => ({
  name,
  available,
  sorted: 0,
  provider: {
    id: "provider",
    providerName: "OpenAI",
    providerType: "openai",
    sorted: 0,
  },
});

beforeEach(() => overrides.clear());

test("one-click activation preserves compatible user-selected models", () => {
  expect(
    skillModelSelection(skill, { model: "gpt-4o" }, [], false),
  ).toBeUndefined();
  expect(
    skillModelSelection(style, { model: "gpt-image-2" }, [], false),
  ).toBeUndefined();
});

test("image styles automatically select a usable image model without changing unrelated settings", () => {
  expect(
    skillModelSelection(
      style,
      { model: "gpt-4o", chatApiFormat: "responses" },
      [
        model("gpt-image-1", false),
        model("gemini-3-pro-image"),
        model("gpt-image-2"),
      ],
      false,
    ),
  ).toEqual({
    model: "gpt-image-2",
    providerName: "OpenAI",
    chatApiFormat: "chat-completions",
  });
});

test("translation switches from image to available chat model and avoids video or embeddings", () => {
  expect(
    skillModelSelection(
      skill,
      { model: "gpt-image-2" },
      [model("sora-2"), model("text-embedding-3"), model("gpt-4o")],
      false,
    ),
  ).toEqual({ model: "gpt-4o", providerName: "OpenAI" });
});

test("missing compatible models and custom image endpoints report actionable requirements", () => {
  expect(() =>
    skillModelSelection(style, { model: "gpt-4o" }, [], false),
  ).toThrow("生图模型");
  expect(() =>
    skillModelSelection(skill, { model: "gpt-image-2" }, [], false),
  ).toThrow("聊天模型");
  expect(() =>
    skillModelSelection(skill, { model: "alias" }, [model("gpt-4o")], true),
  ).toThrow("聊天接口");
  expect(
    skillModelSelection(style, { model: "alias" }, [], true),
  ).toBeUndefined();
  expect(
    skillModelSelection(
      style,
      { model: "alias", chatApiFormat: "responses" },
      [],
      true,
    ),
  ).toEqual({ chatApiFormat: "chat-completions" });
});

test("a manual chat correction allows chat skills despite a custom image default", () => {
  overrides.set("octopus-custom:alias", "chat");
  expect(
    skillModelSelection(
      skill,
      { model: "alias", providerName: "octopus-custom" },
      [],
      true,
    ),
  ).toBeUndefined();
  expect(() =>
    skillModelSelection(
      style,
      { model: "alias", providerName: "octopus-custom" },
      [],
      true,
    ),
  ).toThrow("生图模型");
});

test("style skills use corrected aliases only within their selected provider", () => {
  overrides.set("OpenAI:unknown-alias", "image");
  expect(
    skillModelSelection(
      style,
      { model: "gpt-4o", providerName: "OpenAI" },
      [model("unknown-alias")],
      false,
    ),
  ).toEqual({
    model: "unknown-alias",
    providerName: "OpenAI",
    chatApiFormat: "chat-completions",
  });
  expect(() =>
    skillModelSelection(
      style,
      { model: "unknown-alias", providerName: "octopus-custom" },
      [],
      false,
    ),
  ).toThrow("生图模型");
});

test("document skill keeps text models and switches away from video", () => {
  const document = { kind: "document" } as SkillDefinition;
  expect(
    skillModelSelection(document, { model: "gpt-4o" }, [], false),
  ).toBeUndefined();
  expect(
    skillModelSelection(
      document,
      { model: "sora-2" },
      [model("gpt-4o")],
      false,
    ),
  ).toEqual({ model: "gpt-4o", providerName: "OpenAI" });
});
