import { jest } from "@jest/globals";
import type { TurnstileApi } from "../app/utils/turnstile";

const turnstileWindow = window as Window & { turnstile?: TurnstileApi };
const scriptSelector = "script[data-octopus-turnstile]";

function sdk(): TurnstileApi {
  return { render: jest.fn(() => "widget"), remove: jest.fn() };
}

function script() {
  return document.querySelector<HTMLScriptElement>(scriptSelector)!;
}

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
});

afterEach(() => {
  delete turnstileWindow.turnstile;
  document.querySelectorAll(scriptSelector).forEach((node) => node.remove());
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test("parallel callers share one script and cleanup after successful loading", async () => {
  const { loadTurnstile } = await import("../app/utils/turnstile");
  const first = loadTurnstile();
  const second = loadTurnstile();
  expect(second).toBe(first);
  expect(document.querySelectorAll(scriptSelector)).toHaveLength(1);
  expect(script().src).toBe(
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
  );
  expect(script().async).toBe(true);
  const removeListener = jest.spyOn(script(), "removeEventListener");
  const api = sdk();
  turnstileWindow.turnstile = api;
  script().dispatchEvent(new Event("load"));
  await expect(first).resolves.toBe(api);
  await expect(second).resolves.toBe(api);
  expect(removeListener.mock.calls.map(([type]) => type)).toEqual([
    "load",
    "error",
  ]);
  expect(jest.getTimerCount()).toBe(0);
  expect(script().isConnected).toBe(true);
});

test("reuses the available SDK without adding a script or timer", async () => {
  const { loadTurnstile } = await import("../app/utils/turnstile");
  const api = sdk();
  turnstileWindow.turnstile = api;
  await expect(loadTurnstile()).resolves.toBe(api);
  expect(script()).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
});

test("reuses an existing pending script", async () => {
  const existingScript = document.createElement("script");
  existingScript.dataset.octopusTurnstile = "true";
  document.head.appendChild(existingScript);
  const { loadTurnstile } = await import("../app/utils/turnstile");
  const result = loadTurnstile();
  expect(script()).toBe(existingScript);
  expect(document.querySelectorAll(scriptSelector)).toHaveLength(1);
  const api = sdk();
  turnstileWindow.turnstile = api;
  existingScript.dispatchEvent(new Event("load"));
  await expect(result).resolves.toBe(api);
});

test("listeners are attached before the script is appended", async () => {
  const { loadTurnstile } = await import("../app/utils/turnstile");
  const append = document.head.appendChild.bind(document.head);
  const api = sdk();
  jest.spyOn(document.head, "appendChild").mockImplementation((node) => {
    const result = append(node);
    turnstileWindow.turnstile = api;
    node.dispatchEvent(new Event("load"));
    return result;
  });
  await expect(loadTurnstile()).resolves.toBe(api);
  expect(jest.getTimerCount()).toBe(0);
});

test.each(["error", "timeout", "missing-sdk"] as const)(
  "a %s failure cleans up and permits a fresh successful attempt",
  async (failure) => {
    const { loadTurnstile } = await import("../app/utils/turnstile");
    const first = loadTurnstile();
    const failedScript = script();
    const removeListener = jest.spyOn(failedScript, "removeEventListener");
    const rejected = expect(first).rejects.toThrow(
      failure === "error"
        ? "failed to load"
        : failure === "timeout"
        ? "timed out"
        : "unavailable",
    );
    if (failure === "timeout") {
      await jest.advanceTimersByTimeAsync(15000);
    } else {
      failedScript.dispatchEvent(
        new Event(failure === "missing-sdk" ? "load" : "error"),
      );
    }
    await rejected;
    expect(failedScript.isConnected).toBe(false);
    expect(removeListener).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);

    const retry = loadTurnstile();
    expect(script()).not.toBe(failedScript);
    expect(document.querySelectorAll(scriptSelector)).toHaveLength(1);
    const api = sdk();
    turnstileWindow.turnstile = api;
    script().dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBe(api);
    expect(jest.getTimerCount()).toBe(0);
  },
);

test("callbacks from a failed attempt cannot affect a newer load", async () => {
  const { loadTurnstile } = await import("../app/utils/turnstile");
  const addListener = jest.spyOn(
    HTMLScriptElement.prototype,
    "addEventListener",
  );
  const first = loadTurnstile();
  const oldError = addListener.mock.calls.find(
    ([event]) => event === "error",
  )![1] as EventListener;
  const rejected = expect(first).rejects.toThrow("failed to load");
  script().dispatchEvent(new Event("error"));
  await rejected;

  const retry = loadTurnstile();
  const retryScript = script();
  oldError(new Event("error"));
  expect(retryScript.isConnected).toBe(true);
  expect(jest.getTimerCount()).toBe(1);
  const api = sdk();
  turnstileWindow.turnstile = api;
  retryScript.dispatchEvent(new Event("load"));
  await expect(retry).resolves.toBe(api);
});

test("rejects safely when called without a browser window", async () => {
  const { loadTurnstile } = await import("../app/utils/turnstile");
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window")!;
  Object.defineProperty(globalThis, "window", {
    value: undefined,
    configurable: true,
  });
  try {
    await expect(loadTurnstile()).rejects.toThrow("browser environment");
  } finally {
    Object.defineProperty(globalThis, "window", descriptor);
  }
});
