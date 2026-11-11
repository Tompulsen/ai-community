const requestCache = new Map<string, { data: any; timestamp: number }>();
const pendingRequests = new Map<string, Promise<any>>();

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function fetchWithCache(
  url: string,
  options?: RequestInit,
  ttl: number = CACHE_TTL,
): Promise<any> {
  const cacheKey = `${url}-${JSON.stringify(options)}`;

  // Check cache
  const cached = requestCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }

  // Check pending request (deduplication)
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey);
  }

  // Make request
  const promise = fetch(url, options)
    .then((res) => res.json())
    .then((data) => {
      requestCache.set(cacheKey, { data, timestamp: Date.now() });
      pendingRequests.delete(cacheKey);
      return data;
    })
    .catch((err) => {
      pendingRequests.delete(cacheKey);
      throw err;
    });

  pendingRequests.set(cacheKey, promise);
  return promise;
}

export function clearCache(pattern?: string) {
  if (!pattern) {
    requestCache.clear();
    return;
  }

  for (const key of requestCache.keys()) {
    if (key.includes(pattern)) {
      requestCache.delete(key);
    }
  }
}

export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxRetries = 3,
  delay = 1000,
): Promise<any> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      lastError = err as Error;
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, delay * Math.pow(2, i)));
      }
    }
  }

  throw lastError;
}
