/** @jest-environment node */
import { jest } from "@jest/globals";
import { webcrypto } from "node:crypto";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: webcrypto,
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  localKey: (key: string) => `user-7:${key}`,
  isLocalWorkspaceActive: () => true,
}));
const { prepareAsyncSubmission } = await import(
  "../app/utils/async-submission"
);
beforeEach(() => values.clear());

test("ambiguous submissions reuse the key across retries without retaining prompt or credential", async () => {
  const body = JSON.stringify({ prompt: "private prompt", model: "image" });
  const first = await prepareAsyncSubmission("image", "base:private-key", body);
  const second = await prepareAsyncSubmission(
    "image",
    "base:private-key",
    body,
  );
  expect(second.requestId).toBe(first.requestId);
  expect(JSON.stringify([...values])).not.toMatch(/private prompt|private-key/);
  first.accepted();
  expect(
    (await prepareAsyncSubmission("image", "base:private-key", body)).requestId,
  ).not.toBe(first.requestId);
});

test("changed credentials, parameters and media kinds receive independent keys", async () => {
  const keys = await Promise.all([
    prepareAsyncSubmission("image", "a", "one"),
    prepareAsyncSubmission("image", "b", "one"),
    prepareAsyncSubmission("image", "a", "two"),
    prepareAsyncSubmission("video", "a", "one"),
  ]);
  expect(new Set(keys.map((item) => item.requestId)).size).toBe(4);
});

test("multipart retries compare file contents without depending on the HTTP boundary", async () => {
  const body = (data: string) => {
    const form = new FormData();
    form.append("prompt", "test");
    form.append("image", new Blob([data], { type: "image/png" }), "image.png");
    return form;
  };
  const first = await prepareAsyncSubmission("image", "a", body("same bytes"));
  const retry = await prepareAsyncSubmission("image", "a", body("same bytes"));
  const changed = await prepareAsyncSubmission("image", "a", body("new bytes"));
  expect(retry.requestId).toBe(first.requestId);
  expect(changed.requestId).not.toBe(first.requestId);
});
