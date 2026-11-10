import { jest } from "@jest/globals";
import { estimateTokenLength } from "../app/utils/token-estimate";
import {
  estimateTokenLength as legacyEstimateTokenLength,
  verifyTokenClient,
} from "../app/utils/token";

test.each([
  ["", 0],
  ["a", 1],
  ["abcd", 1],
  ["abcde", 2],
  ["hello world", 3],
  ["\u4e2d\u6587", 2],
  ["Hi\u4e2d\u6587", 3],
  ["\ud83d\ude42", 2],
  ["a".repeat(4000), 1000],
])("preserves token estimates for %s", (text, expected) => {
  expect(estimateTokenLength(text as string)).toBe(expected);
  expect(legacyEstimateTokenLength(text as string)).toBe(expected);
});

describe("legacy token validation", () => {
  const now = 1700000000000;
  const day = 24 * 60 * 60 * 1000;
  const encode = (verified: boolean, ts: number) =>
    Buffer.from(JSON.stringify({ verified, ts, sig: "legacy" })).toString(
      "base64",
    );

  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("keeps the existing verification and expiry boundaries", () => {
    expect(verifyTokenClient(encode(true, now))).toBe(true);
    expect(verifyTokenClient(encode(false, now))).toBe(false);
    expect(verifyTokenClient(encode(true, now - day))).toBe(true);
    expect(verifyTokenClient(encode(true, now - day - 1))).toBe(false);
    expect(verifyTokenClient(encode(true, now + 1000))).toBe(true);
    expect(verifyTokenClient("invalid-token")).toBe(false);
  });

  test("still decodes through Buffer when atob is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "atob");
    Object.defineProperty(globalThis, "atob", {
      configurable: true,
      value: undefined,
    });

    try {
      expect(verifyTokenClient(encode(true, now))).toBe(true);
      expect(verifyTokenClient(encode(true, now - day - 1))).toBe(false);
      expect(verifyTokenClient("invalid-token")).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "atob", descriptor);
      else Reflect.deleteProperty(globalThis, "atob");
    }
  });
});
