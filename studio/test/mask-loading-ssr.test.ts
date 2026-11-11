/** @jest-environment node */

import { jest } from "@jest/globals";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  BUILTIN_MASK_STORE,
  loadBuiltinMasks,
  useBuiltinMasksLoaded,
} from "../app/masks";

test("server imports, loading and rendering keep the empty server snapshot", async () => {
  function Preview() {
    return createElement("span", null, String(useBuiltinMasksLoaded()));
  }

  jest.mocked(fetch).mockClear();
  await loadBuiltinMasks();

  expect(renderToString(createElement(Preview))).toBe("<span>false</span>");
  expect(BUILTIN_MASK_STORE.getServerSnapshot()).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
