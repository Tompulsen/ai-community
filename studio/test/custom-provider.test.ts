import { jest } from "@jest/globals";

let scope = "user-7";
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => scope,
  localKey: (name: string) =>
    scope === "legacy" ? name : `octopus:${scope}:${name}`,
}));
const {
  customApiPath,
  readCustomProvider,
  saveCustomProvider,
  DEFAULT_CUSTOM_PROVIDER,
  usesCustomProvider,
  isAccountModelMode,
  CUSTOM_MODEL_PROVIDER,
} = await import("../app/utils/custom-provider");

beforeEach(() => {
  localStorage.clear();
  scope = "user-7";
});

test("enabling custom models keeps account mode and routes only marked models externally", () => {
  const state = { newApiEnabled: true, useCustomConfig: true };
  expect(isAccountModelMode(state)).toBe(true);
  expect(usesCustomProvider(state, "OpenAI")).toBe(false);
  expect(usesCustomProvider(state)).toBe(false);
  expect(usesCustomProvider(state, CUSTOM_MODEL_PROVIDER)).toBe(true);
  expect(usesCustomProvider({ ...state, newApiEnabled: false })).toBe(false);
});

test.each([
  ["https://api.example.test", "https://api.example.test/v1/models"],
  ["https://api.example.test/v1", "https://api.example.test/v1/models"],
  ["https://api.example.test/", "https://api.example.test/models"],
  [
    "https://api.example.test/custom/",
    "https://api.example.test/custom/models",
  ],
])("normalizes provider base %s", (base, expected) => {
  expect(customApiPath(base, "/models")).toBe(expected);
});

test.each([
  "javascript:alert(1)",
  "https://user:secret@example.test",
  "https://example.test?apiKey=secret",
  "https://example.test#secret",
  "/api/openai",
])("rejects an ambiguous or credential-bearing base %s", (base) => {
  expect(() => customApiPath(base, "models")).toThrow();
});

test("custom keys remain scoped to the confirmed account", () => {
  const profile = {
    ...DEFAULT_CUSTOM_PROVIDER,
    useCustomConfig: true,
    openaiApiKey: "sk-user-seven",
    openaiUrl: "https://provider.test/v1",
    customModelNames: "private-alias",
  };
  saveCustomProvider(profile);
  expect(readCustomProvider()).toEqual(profile);
  scope = "user-8";
  expect(readCustomProvider(profile)).toEqual(DEFAULT_CUSTOM_PROVIDER);
  scope = "user-7";
  expect(readCustomProvider()).toEqual(profile);
});

test("only a legacy workspace can migrate a previous global provider", () => {
  const previous = { ...DEFAULT_CUSTOM_PROVIDER, openaiApiKey: "legacy-key" };
  expect(readCustomProvider(previous).openaiApiKey).toBe("");
  scope = "legacy";
  expect(readCustomProvider(previous).openaiApiKey).toBe("legacy-key");
  expect(readCustomProvider().openaiApiKey).toBe("legacy-key");
});
