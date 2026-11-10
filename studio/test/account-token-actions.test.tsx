import React, { useSyncExternalStore } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import type {
  NewApiAutoGroups,
  NewApiGroup,
  NewApiLog,
  NewApiPage,
  NewApiSelection,
  NewApiSession,
  NewApiStatus,
  NewApiToken,
} from "../app/client/new-api";

const accountId = 17;
const currentTokenId = 101;
const otherTokenId = 202;
const navigate = jest.fn();
const setSearchParams = jest.fn();
const location = { pathname: "/account" };
const searchParams = new URLSearchParams("view=keys");
const selectToken =
  jest.fn<
    (id: number, userId: number) => Promise<{ selectedTokenId: number }>
  >();
const fetchModels = jest.fn<() => Promise<void>>();
const refreshSelectedModels =
  jest.fn<(selection: NewApiSelection) => Promise<void>>();
const refetchModels = jest.fn<() => Promise<void>>();
const pendingGeneration = jest.fn<() => boolean>();
const setTokenStatus =
  jest.fn<(id: number, status: number, userId: number) => Promise<void>>();
const deleteToken = jest.fn<(id: number, userId: number) => Promise<void>>();
const showConfirm = jest.fn<(message: string) => Promise<boolean>>();
const getTokens =
  jest.fn<
    (
      page: number,
      size: number,
      userId: number,
      force?: boolean,
    ) => Promise<NewApiPage<NewApiToken>>
  >();
let session: NewApiSession;
let tokens: NewApiToken[];
let localTokenId: number | null;
let expectedUserId: number | null;
type AccessState = {
  switchingToken: boolean;
  modelListStatus: "ready" | "loading" | "error";
  modelRefreshError: boolean;
  fetch: typeof fetchModels;
};
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
class MockNewApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
const status: NewApiStatus = {
  enabled: true,
  configured: true,
  publicUrl: "",
  passwordLoginEnabled: true,
  turnstileSiteKey: "",
  quotaPerUnit: 100,
  currencySymbol: "$",
};
const groups: NewApiGroup[] = [
  { id: "default", name: "Default group", ratio: 1, description: "" },
];
const autoGroups: NewApiAutoGroups = {
  supported: false,
  defaultGroups: [],
  maxCount: 0,
};
const emptyLogs: NewApiPage<NewApiLog> = {
  items: [],
  total: 0,
  page: 1,
  size: 10,
};

jest.unstable_mockModule("react-router-dom", () => ({
  useLocation: () => location,
  useNavigate: () => navigate,
  useSearchParams: () => [searchParams, setSearchParams],
}));
jest.unstable_mockModule("@/app/client/new-api", () => ({
  NewApiError: MockNewApiError,
  getExpectedNewApiUserId: () => expectedUserId,
  setNewApiExpectedUser: (id: number | null) => {
    expectedUserId = id;
  },
  newApiClient: {
    status: async () => status,
    session: async () => session,
    tokens: getTokens,
    logs: async () => emptyLogs,
    groups: async () => groups,
    autoGroups: async () => autoGroups,
    selectToken,
    setTokenStatus,
    deleteToken,
  },
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
  refetchModels,
  refreshSelectedNewApiModels: refreshSelectedModels,
}));
jest.unstable_mockModule("@/app/utils/account-model-source", () => ({
  hasPendingGeneration: pendingGeneration,
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalTokenId: () => localTokenId,
}));
jest.unstable_mockModule("@/app/utils/turnstile", () => ({
  loadTurnstile: async () => undefined,
}));
jest.unstable_mockModule("@/app/utils/local-preview-models", () => ({
  isLocalPreviewEnabled: () => false,
}));
jest.unstable_mockModule("@/app/utils/local-account-preview", () => ({
  getLocalAccountPreviewClient: () => undefined,
  localAccountPreview: {},
}));
jest.unstable_mockModule("@/app/components/account-model-pricing", () => ({
  AccountModelPricing: () => null,
}));
jest.unstable_mockModule("@/app/components/account-wallet", () => ({
  AccountWallet: () => null,
}));
jest.unstable_mockModule("@/app/components/local-account-form", () => ({
  LocalAccountForm: () => null,
}));
jest.unstable_mockModule("@/app/components/auto-group-label", () => ({
  AutoGroupLabel: () => <span>Auto</span>,
}));
jest.unstable_mockModule("@/app/components/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  LoadingState: () => <div role="status">Loading</div>,
  EmptyState: ({ text }: { text: string }) => <p>{text}</p>,
}));
jest.unstable_mockModule("@/app/components/form-controls", () => ({
  TextField: ({
    fullWidth: _fullWidth,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & { fullWidth?: boolean }) => (
    <input {...props} />
  ),
  Checkbox: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} type="checkbox" />
  ),
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showConfirm,
  Modal: ({
    title,
    children,
    actions,
  }: {
    title: string;
    children: React.ReactNode;
    actions: React.ReactNode[];
  }) => (
    <div>
      <h2>{title}</h2>
      {children}
      {actions}
    </div>
  ),
  Select: ({
    align: _align,
    ...props
  }: React.SelectHTMLAttributes<HTMLSelectElement> & { align?: string }) => (
    <select {...props} />
  ),
  Input: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    Account: {
      Title: "Account and keys",
      MyTokens: "My API keys",
      UserId: "Account ID",
      Group: "Group",
      Balance: "Balance",
      UsedQuota: "Used quota",
      RequestCount: "Request count",
      RefreshBalance: "Refresh balance",
      Logout: "Sign out",
      RefreshTokens: "Refresh keys",
      CreateToken: "Create key",
      EditToken: "Edit key",
      DeleteToken: "Delete key",
      EnableToken: "Enable key",
      DisableToken: "Disable key",
      MoreTokenActions: "More key actions",
      StartChat: "Start chat",
      UseForChat: "Use for chat",
      TokenName: "Key name",
      TokenNamePlaceholder: "Chat key",
      QuotaUsage: "Quota / usage",
      TokenActions: "Actions",
      Enabled: "Enabled",
      Disabled: "Disabled",
      Expired: "Expired",
      Exhausted: "Quota exhausted",
      Unavailable: "Unavailable",
      Selected: "Current chat key",
      Unlimited: "Unlimited",
      UnlimitedQuota: "Unlimited key quota",
      RemainingQuota: "Remaining quota",
      Expiry: "Expiry",
      Never: "Never expires",
      Usage: "Usage history",
      RefreshUsage: "Refresh usage",
      NoLogs: "No usage history",
      NoTokens: "No API keys",
      RequestFailed: "Request failed",
      PreviousPage: "Previous page",
      NextPage: "Next page",
      PageCount: (page: number, pages: number, total: number) =>
        `Page ${page} / ${pages}, ${total} keys`,
      CurrentToken: (name: string) => `Current key: ${name}`,
      SelectTokenHint: "Choose a chat key",
      FirstTokenHint: "Create a chat key",
      InheritedGroup: (group: string) => `Inherited group (${group})`,
      DeleteConfirm: (name: string) => `Delete key "${name}"?`,
      GroupMode: "Routing mode",
      InheritGroup: "Follow account",
      SingleGroup: "Single group",
      MultiGroup: "Multiple groups",
      MultiGroupNotEnabled: "Multiple groups unavailable",
      MultiGroupUnsupported: "Multiple groups unsupported",
      GroupUnavailable: "Group unavailable",
      InheritGroupHint: (group: string) => `Follow ${group}`,
      KeepExpiry: (expiry: string) => `Keep expiry: ${expiry}`,
      ExpireInDays: (days: number) => `Expires in ${days} days`,
      TokenQuotaHint: "Key quota is the maximum usage",
      LimitModels: "Limit models",
      AllowedModels: "Allowed models",
      ModelsPlaceholder: "Enter models",
      Save: "Save",
      Saving: "Saving",
    },
    Settings: {
      ModelSource: {
        Switching: "A key switch is already in progress",
        Pending: "Generation is still in progress",
        ModelsFailed: "Models unavailable",
      },
    },
    UI: { Loading: "Loading", Cancel: "Cancel", Retry: "Retry" },
  },
}));

const { AccountPage } = await import("../app/components/account");

function token(id: number, patch: Partial<NewApiToken> = {}): NewApiToken {
  return {
    id,
    name: `Key ${id}`,
    status: 1,
    created_time: 1,
    accessed_time: 1,
    expired_time: -1,
    remain_quota: 500,
    used_quota: 0,
    unlimited_quota: true,
    model_limits_enabled: false,
    model_limits: "",
    group: "default",
    ...patch,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ready, fail) => {
    resolve = ready;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  searchParams.set("view", "keys");
  session = {
    authenticated: true,
    selectedTokenId: currentTokenId,
    user: {
      id: accountId,
      username: "fixture",
      display_name: "Fixture",
      quota: 1000,
      used_quota: 0,
      request_count: 0,
      group: "default",
    },
  };
  tokens = [token(currentTokenId), token(otherTokenId)];
  localTokenId = currentTokenId;
  expectedUserId = accountId;
  access = {
    switchingToken: false,
    modelListStatus: "ready",
    modelRefreshError: false,
    fetch: fetchModels,
  };
  navigate.mockReset();
  setSearchParams.mockReset();
  selectToken.mockReset().mockImplementation(async (id) => {
    localTokenId = id;
    session = { ...session, selectedTokenId: id };
    return { selectedTokenId: id };
  });
  fetchModels.mockReset().mockResolvedValue();
  refreshSelectedModels.mockReset().mockImplementation(async () => {
    setAccess({ modelListStatus: "ready", modelRefreshError: false });
  });
  refetchModels.mockReset().mockImplementation(async () => {
    setAccess({ modelListStatus: "ready", modelRefreshError: false });
  });
  pendingGeneration.mockReset().mockReturnValue(false);
  setTokenStatus.mockReset().mockResolvedValue();
  deleteToken.mockReset().mockResolvedValue();
  showConfirm.mockReset().mockResolvedValue(true);
  getTokens.mockReset().mockImplementation(async () => ({
    items: tokens,
    total: tokens.length,
    page: 1,
    size: 10,
  }));
});

afterEach(() => {
  cleanup();
  listeners.clear();
});

async function setup() {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<AccountPage />);
  });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Create key" })).toBeEnabled();
  });
  return result;
}

function row(id = otherTokenId) {
  const result = document.querySelector<HTMLElement>(
    `article[data-token-id="${id}"]`,
  );
  expect(result).not.toBeNull();
  return result!;
}

function mainButton(id = otherTokenId) {
  return within(row(id)).getByRole("button", {
    name: new RegExp(` \\u00b7 Key ${id}$`),
  });
}

function openMenu(id = otherTokenId) {
  const article = row(id);
  const summary = within(article).getByRole("button", {
    name: "More key actions",
  });
  fireEvent.click(summary);
  const menu = article.querySelector("details");
  expect(menu).toHaveAttribute("open");
  return article;
}

test("the whole usable row waits for selection and its models before opening chat", async () => {
  const selection = deferred<{ selectedTokenId: number }>();
  const models = deferred<void>();
  selectToken.mockImplementationOnce(async (id) => {
    const result = await selection.promise;
    localTokenId = id;
    return result;
  });
  refreshSelectedModels.mockReturnValueOnce(models.promise);
  await setup();

  fireEvent.click(mainButton());
  expect(selectToken).toHaveBeenCalledWith(otherTokenId, accountId);
  expect(refreshSelectedModels).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => selection.resolve({ selectedTokenId: otherTokenId }));
  expect(refreshSelectedModels).toHaveBeenCalledWith({
    userId: accountId,
    tokenId: otherTokenId,
  });
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => models.resolve());
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith("/chat");
  expect(access.switchingToken).toBe(false);
});

test("the current usable key opens chat without selecting or refreshing models", async () => {
  await setup();
  fireEvent.click(mainButton(currentTokenId));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/chat"));
  expect(selectToken).not.toHaveBeenCalled();
  expect(fetchModels).not.toHaveBeenCalled();
  expect(refreshSelectedModels).not.toHaveBeenCalled();
});

test.each(["selection", "models"] as const)(
  "a failed %s request keeps the account page open and reports the failure",
  async (stage) => {
    const error = new Error(`${stage} failed`);
    if (stage === "selection") selectToken.mockRejectedValueOnce(error);
    else refreshSelectedModels.mockRejectedValueOnce(error);
    await setup();
    fireEvent.click(mainButton());
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(error.message),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(access.switchingToken).toBe(false);
  },
);

test("a model refresh that finishes in an error state never opens chat", async () => {
  refreshSelectedModels.mockImplementationOnce(async () => {
    setAccess({ modelListStatus: "error", modelRefreshError: true });
  });
  await setup();
  fireEvent.click(mainButton());
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(navigate).not.toHaveBeenCalled();
  expect(access.switchingToken).toBe(false);
});

test("the current key retries an unavailable model list before opening chat", async () => {
  access.modelListStatus = "error";
  access.modelRefreshError = true;
  const models = deferred<void>();
  refetchModels.mockImplementationOnce(async () => {
    await models.promise;
    setAccess({ modelListStatus: "ready", modelRefreshError: false });
  });
  await setup();
  fireEvent.click(mainButton(currentTokenId));
  expect(refetchModels).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => models.resolve());
  expect(navigate).toHaveBeenCalledWith("/chat");
  expect(selectToken).not.toHaveBeenCalled();
  expect(refreshSelectedModels).not.toHaveBeenCalled();
});

test.each([
  ["disabled", { status: 2 }],
  ["expired", { expired_time: 1 }],
  ["exhausted", { unlimited_quota: false, remain_quota: 0 }],
] as const)(
  "clicking a %s key opens its management menu without changing the chat key",
  async (_state, patch) => {
    tokens[1] = token(otherTokenId, patch);
    await setup();
    fireEvent.click(mainButton());
    expect(row().querySelector("details")).toHaveAttribute("open");
    expect(
      within(row()).getByRole("button", { name: "Edit key" }),
    ).toBeEnabled();
    expect(selectToken).not.toHaveBeenCalled();
    expect(fetchModels).not.toHaveBeenCalled();
    expect(refreshSelectedModels).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  },
);

test("an existing generation allows selecting a new chat key and its models", async () => {
  pendingGeneration.mockReturnValue(true);
  await setup();
  fireEvent.click(mainButton());

  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/chat"));
  expect(selectToken).toHaveBeenCalledTimes(1);
  expect(selectToken).toHaveBeenCalledWith(otherTokenId, accountId);
  expect(refreshSelectedModels).toHaveBeenCalledTimes(1);
  expect(refreshSelectedModels).toHaveBeenCalledWith({
    userId: accountId,
    tokenId: otherTokenId,
  });
  expect(fetchModels).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(access.switchingToken).toBe(false);
});

test("an existing switch prevents a second key switch", async () => {
  access.switchingToken = true;
  await setup();
  fireEvent.click(mainButton());

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A key switch is already in progress",
    ),
  );
  expect(selectToken).not.toHaveBeenCalled();
  expect(fetchModels).not.toHaveBeenCalled();
  expect(refreshSelectedModels).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});

test("synchronous repeated row clicks only perform one selection and navigation", async () => {
  await setup();
  const button = mainButton();
  await act(async () => {
    button.click();
    button.click();
  });
  expect(selectToken).toHaveBeenCalledTimes(1);
  expect(refreshSelectedModels).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledTimes(1);
});

test("the separate more menu edits its key without selecting or opening chat", async () => {
  await setup();
  const article = openMenu();
  fireEvent.click(within(article).getByRole("button", { name: "Edit key" }));
  expect(screen.getByRole("dialog", { name: "Edit key" })).toBeInTheDocument();
  expect(selectToken).not.toHaveBeenCalled();
  expect(fetchModels).not.toHaveBeenCalled();
  expect(refreshSelectedModels).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});

test("the more menu changes key status without selecting or opening chat", async () => {
  await setup();
  fireEvent.click(
    within(openMenu()).getByRole("button", { name: "Disable key" }),
  );
  await waitFor(() =>
    expect(setTokenStatus).toHaveBeenCalledWith(otherTokenId, 2, accountId),
  );
  expect(selectToken).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});

test("the more menu confirms and deletes only its key", async () => {
  await setup();
  fireEvent.click(
    within(openMenu()).getByRole("button", { name: "Delete key" }),
  );
  await waitFor(() =>
    expect(deleteToken).toHaveBeenCalledWith(otherTokenId, accountId),
  );
  expect(showConfirm).toHaveBeenCalledWith(`Delete key "Key ${otherTokenId}"?`);
  expect(selectToken).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});

test.each(["selection", "models"] as const)(
  "an account change during %s discards late chat navigation",
  async (stage) => {
    const selection = deferred<{ selectedTokenId: number }>();
    const models = deferred<void>();
    if (stage === "selection") {
      selectToken.mockReturnValueOnce(selection.promise);
    } else {
      refreshSelectedModels.mockReturnValueOnce(models.promise);
    }
    await setup();
    fireEvent.click(mainButton());
    if (stage === "models")
      await waitFor(() =>
        expect(refreshSelectedModels).toHaveBeenCalledTimes(1),
      );
    await act(async () => {
      session = {
        ...session,
        user: { ...session.user!, id: accountId + 1 },
        selectedTokenId: null,
      };
      localTokenId = null;
      window.dispatchEvent(new Event("new-api-session-changed"));
    });
    await act(async () => {
      if (stage === "selection")
        selection.resolve({ selectedTokenId: otherTokenId });
      else models.resolve();
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(access.switchingToken).toBe(false);
  },
);

test("a same-account selection event does not cancel the selected key's navigation", async () => {
  selectToken.mockImplementationOnce(async (id) => {
    localTokenId = id;
    session = { ...session, selectedTokenId: id };
    window.dispatchEvent(new Event("new-api-session-changed"));
    return { selectedTokenId: id };
  });
  await setup();
  fireEvent.click(mainButton());
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/chat"));
  expect(selectToken).toHaveBeenCalledTimes(1);
  expect(refreshSelectedModels).toHaveBeenCalledTimes(1);
});

test("an external key change during model loading discards the old navigation", async () => {
  const models = deferred<void>();
  refreshSelectedModels.mockReturnValueOnce(models.promise);
  await setup();
  fireEvent.click(mainButton());
  await waitFor(() => expect(refreshSelectedModels).toHaveBeenCalledTimes(1));
  await act(async () => {
    localTokenId = currentTokenId;
    models.resolve();
  });
  expect(navigate).not.toHaveBeenCalled();
});

test("a current key cannot open chat when its account balance is empty", async () => {
  session.user!.quota = 0;
  await setup();
  fireEvent.click(mainButton(currentTokenId));
  expect(selectToken).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});

test.each(["selection", "models"] as const)(
  "opening the wallet during %s keeps a late key switch from reopening chat",
  async (stage) => {
    const selection = deferred<{ selectedTokenId: number }>();
    const models = deferred<void>();
    if (stage === "selection") {
      selectToken.mockImplementationOnce(async (id) => {
        const result = await selection.promise;
        localTokenId = id;
        return result;
      });
    } else {
      refreshSelectedModels.mockReturnValueOnce(models.promise);
    }
    const view = await setup();
    fireEvent.click(mainButton());
    if (stage === "models")
      await waitFor(() =>
        expect(refreshSelectedModels).toHaveBeenCalledTimes(1),
      );
    await act(async () => {
      searchParams.set("view", "wallet");
      view.rerender(<AccountPage />);
    });
    await act(async () => {
      if (stage === "selection")
        selection.resolve({ selectedTokenId: otherTokenId });
      else models.resolve();
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(access.switchingToken).toBe(false);
  },
);
