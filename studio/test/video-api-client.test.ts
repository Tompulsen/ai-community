/** @jest-environment node */
import { jest } from "@jest/globals";

const access = {
  newApiEnabled: false,
  useCustomConfig: true,
  openaiUrl: "https://generativelanguage.googleapis.com/v1",
  openaiApiKey: "fixture-key",
  switchingToken: false,
};
jest.unstable_mockModule("@/app/store/access", () => ({
  useAccessStore: { getState: () => access },
}));
jest.unstable_mockModule("@/app/client/platforms/openai", () => ({
  ChatGPTApi: class {},
}));
jest.unstable_mockModule("@/app/client/new-api", () => ({
  getExpectedNewApiUserId: () => null,
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: { Settings: { ModelSource: { Switching: "Switching group" } } },
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => "legacy",
  localKey: (name: string) => name,
  getLocalTokenId: () => null,
}));
const { apiPath, apiFetch } = await import("../app/client/api");
const originalFetch = global.fetch;
beforeEach(() => {
  access.newApiEnabled = false;
  access.switchingToken = false;
  access.openaiUrl = "https://generativelanguage.googleapis.com/v1";
  global.fetch = jest
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ done: false }));
});

test("group switching allows pinned accepted submissions but blocks ambiguous new ones", async () => {
  access.newApiEnabled = true;
  access.switchingToken = true;
  for (const token of [undefined, "0", "invalid", "9007199254740992"]) {
    await expect(
      apiFetch("videos", {
        method: "POST",
        headers: token ? { "X-New-Api-Token": token } : {},
      }),
    ).rejects.toThrow("Switching group");
  }
  expect(fetch).not.toHaveBeenCalled();
  await apiFetch("videos", {
    method: "POST",
    headers: { "X-New-Api-Token": "7" },
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    new Headers(jest.mocked(fetch).mock.calls[0][1]?.headers).get(
      "X-New-Api-Token",
    ),
  ).toBe("7");
});
afterEach(() => {
  global.fetch = originalFetch;
});

test("native Gemini paths replace the version once and preserve media queries", () => {
  const provider = "octopus-custom";
  expect(apiPath("v1beta/models/veo:predictLongRunning", provider)).toBe(
    "https://generativelanguage.googleapis.com/v1beta/models/veo:predictLongRunning",
  );
  access.openaiUrl = "https://gateway.test/prefix/v1beta/";
  expect(apiPath("v1beta/files/id:download?alt=media", provider)).toBe(
    "https://gateway.test/prefix/v1beta/files/id:download?alt=media",
  );
  expect(apiPath("v1beta/models/veo/operations/op")).toBe(
    "/studio/api/v1beta/models/veo/operations/op",
  );
});

test.each([
  [
    "https://ark.cn-beijing.volces.com",
    "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
  ],
  [
    "https://ark.cn-beijing.volces.com/api/v3",
    "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
  ],
  [
    "https://gateway.test/prefix/v1",
    "https://gateway.test/prefix/api/v3/contents/generations/tasks",
  ],
])("Seedance replaces the version exactly once for %s", (base, expected) => {
  access.openaiUrl = base;
  expect(apiPath("api/v3/contents/generations/tasks", "octopus-custom")).toBe(
    expected,
  );
  expect(apiPath("api/v3/contents/generations/tasks/cgt_1")).toBe(
    "/studio/api/ark/contents/generations/tasks/cgt_1",
  );
});

test("Google native custom requests use x-goog-api-key instead of an invalid OAuth Bearer", async () => {
  await apiFetch(
    "v1beta/models/veo:predictLongRunning",
    { method: "POST", body: "{}" },
    "octopus-custom",
  );
  const headers = new Headers(
    (global.fetch as jest.Mock<typeof fetch>).mock.calls[0][1]?.headers,
  );
  expect(headers.get("x-goog-api-key")).toBe("fixture-key");
  expect(headers.has("authorization")).toBe(false);
});

test("custom Gemini gateways retain Bearer while ordinary OpenAI multipart has no JSON content type", async () => {
  access.openaiUrl = "https://gateway.test/v1";
  await apiFetch(
    "v1beta/models/veo:predictLongRunning",
    { method: "POST" },
    "octopus-custom",
  );
  await apiFetch(
    "videos",
    { method: "POST", body: new FormData() },
    "octopus-custom",
  );
  const calls = (global.fetch as jest.Mock<typeof fetch>).mock.calls;
  expect(new Headers(calls[0][1]?.headers).get("authorization")).toBe(
    "Bearer fixture-key",
  );
  expect(new Headers(calls[1][1]?.headers).has("content-type")).toBe(false);
});
