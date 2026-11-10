import React, { useSyncExternalStore } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";
import type { NewApiSession } from "../app/client/new-api";

const getSession = jest.fn<(initial?: boolean) => Promise<NewApiSession>>();
const getInitialSession = jest.fn<() => NewApiSession | undefined>();
let enabled = true;
const listeners = new Set<() => void>();
jest.unstable_mockModule("@/app/client/new-api", () => ({
  getAccountReadinessSession: getSession,
  getInitialAccountReadinessSession: getInitialSession,
}));
jest.unstable_mockModule("@/app/store/access", () => ({
  useAccessStore: (selector: (state: { newApiEnabled: boolean }) => unknown) =>
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => selector({ newApiEnabled: enabled }),
      () => selector({ newApiEnabled: enabled }),
    ),
}));
const { AccountReadiness } = await import(
  "../app/components/account-readiness"
);
const session = (quota = 100): NewApiSession => ({
  authenticated: true,
  user: {
    id: 7,
    username: "fixture",
    display_name: "Fixture",
    quota,
    used_quota: 0,
    request_count: 0,
    group: "default",
  },
  selectedTokenId: 100,
});
const guest: NewApiSession = {
  authenticated: false,
  user: null,
  selectedTokenId: null,
};

beforeEach(() => {
  enabled = true;
  getSession.mockReset().mockResolvedValue(session());
  getInitialSession.mockReset();
});
afterEach(() => {
  cleanup();
  listeners.clear();
  jest.restoreAllMocks();
});
async function setup() {
  await act(async () => {
    render(<AccountReadiness />);
  });
}

test("initial mount may claim bootstrap while a later mount still asks the client again", async () => {
  await setup();
  expect(getSession.mock.calls).toEqual([[true]]);
  cleanup();
  await setup();
  expect(getSession.mock.calls).toEqual([[true], [true]]);
});

test.each([
  ["anonymous", guest, "去登录"],
  ["missing key", { ...session(), selectedTokenId: null }, "选择密钥"],
  ["empty balance", session(0), "前往充值"],
] as const)(
  "verified startup guidance is visible immediately for %s",
  (_case, initial, action) => {
    getInitialSession.mockReturnValue(initial);
    getSession.mockImplementationOnce(() => new Promise(() => {}));
    render(<AccountReadiness />);
    expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
    expect(getSession.mock.calls).toEqual([[true]]);
  },
);

test("a verified usable startup account needs no readiness placeholder", () => {
  getInitialSession.mockReturnValue(session());
  getSession.mockImplementationOnce(() => new Promise(() => {}));
  render(<AccountReadiness />);
  expect(screen.queryByRole("status")).toBeNull();
});

test("disabled accounts perform no readiness queries", async () => {
  enabled = false;
  await setup();
  expect(getSession).not.toHaveBeenCalled();
  expect(getInitialSession).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});

test("enabling account mode shows verified bootstrap guidance before a live read settles", () => {
  enabled = false;
  getInitialSession.mockReturnValue(guest);
  getSession.mockImplementationOnce(() => new Promise(() => {}));
  render(<AccountReadiness />);
  expect(getSession).not.toHaveBeenCalled();
  act(() => {
    enabled = true;
    listeners.forEach((listener) => listener());
  });
  expect(screen.getByRole("button", { name: "去登录" })).toBeInTheDocument();
  expect(getSession.mock.calls).toEqual([[true]]);
});

test("account changes clear old guidance and discard late responses", async () => {
  let finish!: (value: NewApiSession) => void;
  getInitialSession.mockReturnValue(session(0));
  getSession.mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  );
  await setup();
  expect(screen.getByRole("button", { name: "前往充值" })).toBeInTheDocument();
  getSession.mockResolvedValue(guest);
  await act(async () => {
    window.dispatchEvent(new Event("new-api-session-changed"));
  });
  expect(screen.getByRole("button", { name: "去登录" })).toBeInTheDocument();
  await act(async () => {
    finish(session());
  });
  expect(screen.getByRole("button", { name: "去登录" })).toBeInTheDocument();
  expect(getSession.mock.calls).toEqual([[true], [false]]);
});

test("returning to the foreground refreshes the balance through the live path", async () => {
  getSession.mockResolvedValueOnce(session(0));
  await setup();
  expect(screen.getByRole("button", { name: "前往充值" })).toBeInTheDocument();
  getSession.mockResolvedValue(session(100));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(screen.queryByRole("status")).toBeNull();
  expect(getSession.mock.calls).toEqual([[true], [false]]);
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(getSession.mock.calls).toEqual([[true], [false], [false]]);
});

test("hidden documents wait until visible before refreshing", async () => {
  await setup();
  jest.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  expect(getSession).toHaveBeenCalledTimes(1);
});

test("a foreground refresh keeps unchanged balance guidance mounted while pending", async () => {
  getSession.mockResolvedValueOnce(session(0));
  await setup();
  const prompt = screen.getByRole("button", { name: "前往充值" });
  let finish!: (value: NewApiSession) => void;
  getSession.mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  );
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(screen.getByRole("button", { name: "前往充值" })).toBe(prompt);
  await act(async () => {
    finish(session(0));
  });
  expect(screen.getByRole("button", { name: "前往充值" })).toBe(prompt);
});

test("a failed foreground refresh clears the earlier account guidance", async () => {
  getSession.mockResolvedValueOnce(session(0));
  await setup();
  getSession.mockRejectedValue(new Error("Session unavailable"));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(screen.queryByRole("status")).toBeNull();
});

test("a late failed refresh cannot clear a newer account's guidance", async () => {
  await setup();
  let fail!: (error: Error) => void;
  getSession.mockImplementationOnce(
    () => new Promise((_resolve, reject) => (fail = reject)),
  );
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  getSession.mockResolvedValue(guest);
  await act(async () => {
    window.dispatchEvent(new Event("new-api-session-changed"));
  });
  await act(async () => {
    fail(new Error("Previous request failed"));
  });
  expect(screen.getByRole("button", { name: "去登录" })).toBeInTheDocument();
});

test("authentication failure clears guidance instead of retaining an earlier result", async () => {
  getSession.mockResolvedValueOnce(guest);
  await setup();
  expect(screen.getByRole("button", { name: "去登录" })).toBeInTheDocument();
  getSession.mockRejectedValue(new Error("Session unavailable"));
  await act(async () => {
    window.dispatchEvent(new Event("new-api-session-changed"));
  });
  expect(screen.queryByRole("status")).toBeNull();
});
