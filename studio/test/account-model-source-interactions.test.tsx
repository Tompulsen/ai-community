import React, { useSyncExternalStore } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import type {
  NewApiModelGroups,
  NewApiSelection,
  NewApiSession,
} from "../app/client/new-api";

type AccessState = {
  switchingToken: boolean;
  modelListStatus: "ready" | "loading" | "error";
  modelRefreshError: boolean;
};
type GroupSelection = { selectedTokenId: number; group: string };

const userId = 17;
const originalToken = 100;
const selectedToken = 200;
let expectedUserId: number | null = userId;
let localTokenId: number | null = originalToken;
let access: AccessState;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const setAccess = (patch: Partial<AccessState>) => {
  access = { ...access, ...patch };
  listeners.forEach((listener) => listener());
};
const session: NewApiSession = {
  authenticated: true,
  selectedTokenId: originalToken,
  user: {
    id: userId,
    username: "test-user",
    display_name: "Test User",
    quota: 100,
    used_quota: 0,
    request_count: 0,
    group: "default",
  },
};
const groups: NewApiModelGroups = {
  selectedGroup: "auto",
  groups: [
    { id: "auto", name: "Auto", ratio: "auto", description: "" },
    { id: "creative", name: "Creative", ratio: 1, description: "" },
  ],
};
const modelGroups =
  jest.fn<(id: number, force?: boolean) => Promise<NewApiModelGroups>>();
const selectModelGroup =
  jest.fn<(group: string, id: number) => Promise<GroupSelection>>();
const refreshModels = jest.fn<(force?: boolean) => Promise<void>>();
const refreshSelectedModels =
  jest.fn<(selection: NewApiSelection) => Promise<void>>();
const refetchModels = jest.fn<() => Promise<void>>();

jest.unstable_mockModule("@/app/client/new-api", () => ({
  newApiClient: {
    session: async () => session,
    modelGroups,
    selectModelGroup,
  },
  getCachedModelSource: () => ({ session, modelGroups: groups }),
  getExpectedNewApiUserId: () => expectedUserId,
}));
jest.unstable_mockModule("@/app/store/access", () => ({
  useAccessStore: Object.assign(
    (selector: (state: AccessState) => unknown) =>
      useSyncExternalStore(
        subscribe,
        () => selector(access),
        () => selector(access),
      ),
    { getState: () => access, setState: setAccess },
  ),
  refreshNewApiModels: refreshModels,
  refreshSelectedNewApiModels: refreshSelectedModels,
  refetchModels,
}));
jest.unstable_mockModule("@/app/utils/account-model-source", () => ({
  hasPendingGeneration: () => true,
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalTokenId: () => localTokenId,
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    Settings: {
      ModelSource: {
        Title: "Model group",
        Switching: "Preparing group",
        Loading: "Loading groups",
        Choose: "Choose group",
        SignIn: "Sign in",
        Manage: "Manage account",
        Pending: "Generation in progress",
        ModelsFailed: "Models unavailable",
        Retry: "Retry",
      },
    },
    Account: {
      RequestFailed: "Request failed",
      SystemDefault: "System",
      SystemDefaultHint: "Choose a group automatically",
      MultiGroup: "Multiple groups",
    },
  },
}));

const { AccountModelSource } = await import(
  "../app/components/account-model-source"
);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}

beforeEach(() => {
  access = {
    switchingToken: false,
    modelListStatus: "ready",
    modelRefreshError: false,
  };
  expectedUserId = userId;
  localTokenId = originalToken;
  modelGroups.mockReset().mockResolvedValue(groups);
  selectModelGroup.mockReset().mockImplementation(async (group) => {
    localTokenId = selectedToken;
    return { selectedTokenId: selectedToken, group };
  });
  refreshModels.mockReset().mockResolvedValue();
  refreshSelectedModels.mockReset().mockResolvedValue();
  refetchModels.mockReset().mockResolvedValue();
});

afterEach(() => {
  cleanup();
  listeners.clear();
});

async function setup() {
  const onGroupChange = jest.fn();
  await act(async () => {
    render(<AccountModelSource onGroupChange={onGroupChange} />);
  });
  return onGroupChange;
}

async function chooseCreativeGroup() {
  fireEvent.click(screen.getByRole("button", { name: "Model group" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Creative\b/ }));
  });
}

test("initial loading and background refreshes do not select a model", async () => {
  const onGroupChange = await setup();
  expect(refreshModels).toHaveBeenCalledTimes(1);
  await act(async () => {
    window.dispatchEvent(new Event("new-api-model-source-ready"));
  });
  await act(async () => {
    window.dispatchEvent(new Event("new-api-session-changed"));
  });
  expect(modelGroups).toHaveBeenCalledTimes(3);
  expect(onGroupChange).not.toHaveBeenCalled();
  expect(selectModelGroup).not.toHaveBeenCalled();
});

test("an explicit selection waits for its models and notifies once when ready", async () => {
  const pending = deferred();
  refreshSelectedModels.mockImplementation(() => {
    setAccess({ modelListStatus: "loading" });
    return pending.promise;
  });
  const onGroupChange = await setup();
  await chooseCreativeGroup();
  expect(selectModelGroup).toHaveBeenCalledWith("creative", userId);
  expect(refreshSelectedModels).toHaveBeenCalledWith({
    userId,
    tokenId: selectedToken,
    group: "creative",
  });
  expect(onGroupChange).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Model group" })).toBeDisabled();
  await act(async () => {
    setAccess({ modelListStatus: "ready" });
    pending.resolve();
  });
  expect(onGroupChange).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Model group" })).toBeEnabled();
});

test("a confirmed cached list is usable before background validation finishes", async () => {
  const pending = deferred();
  refreshSelectedModels.mockReturnValue(pending.promise);
  const onGroupChange = await setup();
  await chooseCreativeGroup();
  expect(onGroupChange).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Model group" })).toBeEnabled();
  await act(async () => {
    pending.resolve();
  });
  expect(onGroupChange).toHaveBeenCalledTimes(1);
});

test("changing the account or key during model loading discards the selection callback", async () => {
  for (const changedSource of ["account", "key"]) {
    expectedUserId = userId;
    localTokenId = originalToken;
    const pending = deferred();
    refreshSelectedModels.mockImplementation(() => {
      setAccess({ modelListStatus: "loading" });
      return pending.promise;
    });
    const onGroupChange = await setup();
    await chooseCreativeGroup();
    expect(onGroupChange).not.toHaveBeenCalled();
    await act(async () => {
      if (changedSource === "account") expectedUserId = userId + 1;
      else localTokenId = selectedToken + 1;
      setAccess({ modelListStatus: "ready" });
      pending.resolve();
    });
    expect(onGroupChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Model group" })).toBeEnabled();
    cleanup();
  }
});

test("a failed group request recovers its list without changing the model", async () => {
  selectModelGroup.mockRejectedValueOnce(new Error("Group request failed"));
  const onGroupChange = await setup();
  await chooseCreativeGroup();
  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent("Group request failed");
    expect(screen.getByRole("button", { name: "Model group" })).toBeEnabled();
  });
  expect(refetchModels).toHaveBeenCalledTimes(1);
  expect(refreshSelectedModels).not.toHaveBeenCalled();
  expect(onGroupChange).not.toHaveBeenCalled();
});
