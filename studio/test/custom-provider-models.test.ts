import { jest } from "@jest/globals";
import {
  customModelNames,
  fetchCustomModels,
} from "../app/utils/custom-provider-models";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

test("fetches unique provider model IDs directly without site credentials", async () => {
  global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [
        { id: "gpt-first" },
        { id: "gpt-first" },
        {},
        { id: 7 },
        { id: "claude-last" },
      ],
    }),
  } as Response);
  const signal = new AbortController().signal;
  expect(
    await fetchCustomModels(
      "https://provider.test/v1",
      " sk-external ",
      signal,
    ),
  ).toEqual(["gpt-first", "claude-last"]);
  expect(fetch).toHaveBeenCalledWith("https://provider.test/v1/models", {
    headers: { Authorization: "Bearer sk-external" },
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal,
  });
});

test("parses saved selection and manual model IDs without duplicates", () => {
  expect(customModelNames("gpt-first,\n gpt-second\r\ngpt-first,,")).toEqual([
    "gpt-first",
    "gpt-second",
  ]);
});

test.each([401, 503])(
  "reports HTTP %s without exposing provider response or credentials",
  async (status) => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: false, status } as Response);
    await expect(
      fetchCustomModels(
        "https://provider.test/v1",
        "sk-secret",
        new AbortController().signal,
      ),
    ).rejects.toThrow(`HTTP ${status}`);
  },
);

test.each([{ data: "invalid" }, { data: [] }])(
  "rejects malformed or empty model lists",
  async (body) => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: async () => body } as Response);
    await expect(
      fetchCustomModels(
        "https://provider.test/v1",
        "sk-secret",
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  },
);
