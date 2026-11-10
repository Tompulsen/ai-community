import type { WalletOverview, WalletQuote } from "./wallet";

type WalletClient = {
  walletOverview: (
    signal?: AbortSignal,
    userId?: number,
  ) => Promise<WalletOverview>;
  walletQuote: (amount: number, userId?: number) => Promise<WalletQuote>;
};
type Cached<T> = { data?: T; at: number; pending?: Promise<T> };
type WalletCache = {
  userId: number;
  overview: Cached<WalletOverview>;
  quotes: Map<number, Cached<WalletQuote>>;
};
const TTL = 60_000;
let caches = new WeakMap<WalletClient, WalletCache>();

// Session changes invalidate even requests still completing under the old identity.
if (typeof window !== "undefined") {
  window.addEventListener("new-api-session-changed", () => {
    caches = new WeakMap();
  });
}

function cacheFor(client: WalletClient, userId: number) {
  let cache = caches.get(client);
  if (!cache || cache.userId !== userId) {
    cache = { userId, overview: { at: 0 }, quotes: new Map() };
    caches.set(client, cache);
  }
  return cache;
}

function read<T>(entry: Cached<T>, load: () => Promise<T>): Promise<T> {
  if (entry.data && Date.now() - entry.at < TTL)
    return Promise.resolve(entry.data);
  if (entry.pending) return entry.pending;
  entry.pending = load()
    .then((data) => {
      entry.data = data;
      entry.at = Date.now();
      return data;
    })
    .finally(() => {
      entry.pending = undefined;
    });
  return entry.pending;
}

export function cachedWalletOverview(client: WalletClient, userId: number) {
  const entry = cacheFor(client, userId).overview;
  return entry.data && Date.now() - entry.at < TTL * 5 ? entry.data : undefined;
}

export function cachedWalletQuote(
  client: WalletClient,
  userId: number,
  amount: number,
) {
  const entry = cacheFor(client, userId).quotes.get(amount);
  return entry?.data && Date.now() - entry.at < TTL ? entry.data : undefined;
}

export function readWalletOverview(
  client: WalletClient,
  userId: number,
  force = false,
) {
  const cache = cacheFor(client, userId);
  if (force) {
    if (!cache.overview.pending) cache.overview = { at: 0 };
    cache.quotes.clear();
  }
  return read(cache.overview, () => client.walletOverview(undefined, userId));
}

export function readWalletQuote(
  client: WalletClient,
  userId: number,
  amount: number,
) {
  const cache = cacheFor(client, userId);
  let entry = cache.quotes.get(amount);
  if (!entry) {
    entry = { at: 0 };
    cache.quotes.set(amount, entry);
    if (cache.quotes.size > 30)
      cache.quotes.delete(cache.quotes.keys().next().value!);
  }
  return read(entry, () => client.walletQuote(amount, userId));
}
