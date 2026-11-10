import { jest } from "@jest/globals";
import {
  cachedWalletOverview,
  cachedWalletQuote,
  readWalletOverview,
  readWalletQuote,
} from "../app/utils/wallet-cache";
import type { WalletOverview, WalletQuote } from "../app/utils/wallet";

function client() {
  return {
    walletOverview: jest
      .fn<() => Promise<WalletOverview>>()
      .mockResolvedValue({ userId: 7 } as WalletOverview),
    walletQuote: jest
      .fn<(amount: number) => Promise<WalletQuote>>()
      .mockImplementation(async (amount) => ({
        userId: 7,
        amount,
        money: String(amount),
      })),
  };
}

test("wallet reads share pending work and expire without discarding the visible snapshot", async () => {
  const api = client();
  let now = 1000;
  const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
  try {
    await Promise.all([readWalletOverview(api, 7), readWalletOverview(api, 7)]);
    await Promise.all([
      readWalletQuote(api, 7, 10),
      readWalletQuote(api, 7, 10),
    ]);
    expect(api.walletOverview).toHaveBeenCalledTimes(1);
    expect(api.walletQuote).toHaveBeenCalledTimes(1);
    now += 61_000;
    expect(cachedWalletOverview(api, 7)).toBeDefined();
    expect(cachedWalletQuote(api, 7, 10)).toBeUndefined();
    await readWalletOverview(api, 7);
    expect(api.walletOverview).toHaveBeenCalledTimes(2);
    await readWalletQuote(api, 7, 10);
    await readWalletOverview(api, 7, true);
    expect(cachedWalletQuote(api, 7, 10)).toBeUndefined();
  } finally {
    clock.mockRestore();
  }
});

test("accounts, clients and session changes never share wallet snapshots", async () => {
  const api = client();
  await readWalletOverview(api, 7);
  expect(cachedWalletOverview(client(), 7)).toBeUndefined();
  expect(cachedWalletOverview(api, 8)).toBeUndefined();
  await readWalletOverview(api, 7);
  window.dispatchEvent(new Event("new-api-session-changed"));
  expect(cachedWalletOverview(api, 7)).toBeUndefined();
});

test("requests from a previous session cannot repopulate the cache", async () => {
  const api = client();
  let resolve!: (value: WalletOverview) => void;
  api.walletOverview.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = readWalletOverview(api, 7);
  window.dispatchEvent(new Event("new-api-session-changed"));
  resolve({ userId: 7 } as WalletOverview);
  await pending;
  expect(cachedWalletOverview(api, 7)).toBeUndefined();
});
