import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import type {
  NewApiSession,
  NewApiStatus,
  NewApiModelGroups,
} from "../app/client/new-api";
import type { ModelPricing } from "../app/utils/model-pricing";

const session = jest.fn<() => Promise<NewApiSession>>();
const status = jest.fn<() => Promise<NewApiStatus>>();
const modelGroups = jest.fn<() => Promise<NewApiModelGroups>>();
const modelPricing = jest.fn<() => Promise<ModelPricing>>();
const navigate = jest.fn();
let owner = "one",
  pending = false;
let chatChanged: () => void;
let videoChanged: (a: any, b: any) => void;
jest.unstable_mockModule("@/app/client/new-api", () => ({
  newApiClient: { session, status, modelGroups, modelPricing },
}));
jest.unstable_mockModule("react-router-dom", () => ({
  useNavigate: () => navigate,
}));
jest.unstable_mockModule("@/app/client/controller", () => ({
  ChatControllerPool: {
    hasPending: () => pending,
    subscribe: (fn: () => void) => {
      chatChanged = fn;
      return () => {};
    },
  },
}));
jest.unstable_mockModule("@/app/store/video", () => ({
  useVideoStore: {
    subscribe: (fn: typeof videoChanged) => {
      videoChanged = fn;
      return () => {};
    },
  },
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => owner,
  isLocalWorkspaceActive: () => true,
}));
const { ComposerBilling } = await import("../app/components/composer-billing");
const account = {
  authenticated: true,
  selectedTokenId: 1,
  user: {
    id: 1,
    username: "one",
    display_name: "One",
    quota: 10000,
    used_quota: 0,
    request_count: 0,
    group: "default",
  },
};
beforeEach(() => {
  jest.clearAllMocks();
  owner = "one";
  pending = false;
  session.mockResolvedValue(account);
  status.mockResolvedValue({
    quotaPerUnit: 500,
    currencySymbol: "¥",
  } as NewApiStatus);
  modelGroups.mockResolvedValue({ groups: [], selectedGroup: "default" });
  modelPricing.mockResolvedValue({
    userId: 1,
    rows: [
      {
        model: "image",
        group: "default",
        price: "¥ 1",
        billing: "每次请求",
        details: { unit: "request", tiers: [{ perRequest: "¥ 1" }] },
      },
    ],
  } as ModelPricing);
});
test("waits for identity, shows real price and quota, and exposes account/pricing links", async () => {
  let finish!: (value: NewApiSession) => void;
  session.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<ComposerBilling model="image" customProvider={false} />);
  expect(modelPricing).not.toHaveBeenCalled();
  await act(async () => finish(account));
  await screen.findByText("¥20");
  expect(screen.getByText("¥ 1 / 次调用")).toBeTruthy();
  fireEvent.click(screen.getByTitle("查看账户额度"));
  expect(navigate).toHaveBeenCalledWith("/account");
  fireEvent.click(screen.getByText("¥ 1 / 次调用"));
  expect(navigate).toHaveBeenCalledWith("/pricing");
});
test("refreshes quota after text/image and video requests finish", async () => {
  render(<ComposerBilling model="image" customProvider={false} />);
  await screen.findByText("¥20");
  session.mockResolvedValue({
    ...account,
    user: { ...account.user, quota: 9500 },
  });
  act(() => {
    pending = true;
    chatChanged();
    pending = false;
    chatChanged();
  });
  await screen.findByText("¥19");
  session.mockResolvedValue({
    ...account,
    user: { ...account.user, quota: 9000 },
  });
  act(() =>
    videoChanged(
      { isGenerating: false, results: [] },
      { isGenerating: true, results: [] },
    ),
  );
  await screen.findByText("¥18");
});
test("clears old identity data immediately and ignores late responses", async () => {
  let finish!: (value: ModelPricing) => void;
  modelPricing.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<ComposerBilling model="image" customProvider={false} />);
  await waitFor(() => expect(modelPricing).toHaveBeenCalledTimes(1));
  act(() => {
    owner = "two";
    window.dispatchEvent(new Event("new-api-session-changed"));
  });
  await act(async () =>
    finish({ rows: [], userId: 1 } as unknown as ModelPricing),
  );
  expect(screen.queryByText("¥20")).toBeNull();
  session.mockResolvedValue({
    ...account,
    user: { ...account.user, id: 2, quota: 0 },
  });
  await screen.findByText("¥0");
});
test("request errors offer retry without showing a false zero balance", async () => {
  session.mockRejectedValueOnce(new Error("offline"));
  render(<ComposerBilling model="image" customProvider={false} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "重试读取费用和额度" }),
  );
  await screen.findByText("¥20");
});
