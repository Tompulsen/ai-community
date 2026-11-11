/** @jest-environment node */

import { jest } from "@jest/globals";

let scope = "user-7";
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => scope,
}));
const { imagePreviewKey } = await import("../app/utils/image-preview");

afterEach(() => {
  scope = "user-7";
  jest.restoreAllMocks();
});

test("length-prefixed keys distinguish arbitrary scope, id and source tuples", () => {
  const values = [
    "",
    ":",
    "1:a",
    "a",
    "a:1",
    '[""]',
    "\u0000",
    "\ud83d\ude00",
    "\ud800",
    "line\nbreak",
  ];
  const keys = new Set<string>();
  for (const owner of values)
    for (const id of values)
      for (const src of values) keys.add(imagePreviewKey(src, id, owner));
  expect(keys.size).toBe(values.length ** 3);
});

test("keys preserve the default scope and optional-id semantics", () => {
  const src = "https://fixture/image.png";
  expect(imagePreviewKey(src)).toBe(imagePreviewKey(src, "", "user-7"));
  const previous = imagePreviewKey(src, "image");
  scope = "user-8";
  expect(imagePreviewKey(src, "image")).not.toBe(previous);
  expect(imagePreviewKey(src, "image", "user-7")).toBe(previous);
});

test("large data sources are keyed without JSON serialization or escaping", () => {
  const src = "data:image/png;base64," + "A".repeat(3 * 1024 * 1024);
  const stringify = jest.spyOn(JSON, "stringify");
  const key = imagePreviewKey(src, "large-image");
  expect(stringify).not.toHaveBeenCalled();
  expect(key.endsWith(src)).toBe(true);
  expect(key.length).toBe(
    "6:user-711:large-image".length + `${src.length}:`.length + src.length,
  );
});
