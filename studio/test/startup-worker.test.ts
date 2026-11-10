import { jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

test.each(["loading", "complete"])("the built-in studio leaves the community worker and draft intact when the document is %s", (readyState) => {
  const register = jest.fn(), reload = jest.fn(), events = jest.fn(), timer = jest.fn();
  const window = { draft: "A draft in progress", location: { reload }, addEventListener: events, setTimeout: timer };
  runInNewContext(readFileSync(resolve("public/serviceWorkerRegister.js"), "utf8"), {
    window, document: { readyState }, navigator: { serviceWorker: { register, addEventListener: events } },
  });
  expect(register).not.toHaveBeenCalled();
  expect(events).not.toHaveBeenCalled();
  expect(timer).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  expect(window.draft).toBe("A draft in progress");
});
