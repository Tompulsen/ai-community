// Both caches use the provider's remaining freshness, rather than renewing it.
export function dailyFreshness(headers: Headers, fallback = 60) {
  const control = headers.get("cache-control") ?? "";
  if (/\b(no-store|no-cache|private)\b/i.test(control)) return 0;
  const maxAge = control.match(/(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i);
  const age = Number(headers.get("age") ?? 0);
  const date = Date.parse(headers.get("date") ?? "");
  const elapsed = Number.isFinite(date)
    ? Math.max(0, (Date.now() - date) / 1000)
    : 0;
  return Math.max(
    0,
    Math.min(300, maxAge ? Number(maxAge[1]) : fallback) -
      Math.max(Number.isFinite(age) ? age : 0, elapsed),
  );
}
