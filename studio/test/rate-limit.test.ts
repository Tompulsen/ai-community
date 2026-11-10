import { jest } from "@jest/globals";
import { checkRateLimit } from "../app/utils/rate-limit";

test.each([
  { max: undefined, count: 100 },
  { max: "0", count: 1 },
  { max: "-1", count: 100 },
  { max: "invalid", count: 100 },
  { max: "", count: 100 },
  { max: " ", count: 100 },
])(
  "IP limit $max permits $count requests before resetting",
  ({ max, count }) => {
    const previousMax = process.env.RATE_LIMIT_MAX;
    const previousWindow = process.env.RATE_LIMIT_WINDOW;
    const previousEnabled = process.env.ENABLE_RATE_LIMIT;
    jest.useFakeTimers();
    if (max === undefined) delete process.env.RATE_LIMIT_MAX;
    else process.env.RATE_LIMIT_MAX = max;
    delete process.env.RATE_LIMIT_WINDOW;
    delete process.env.ENABLE_RATE_LIMIT;
    try {
      for (let request = 0; request < count; request++) {
        const result = checkRateLimit("rate-limit-boundary-test");
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBeGreaterThanOrEqual(0);
      }
      expect(checkRateLimit("rate-limit-boundary-test").allowed).toBe(false);
      expect(checkRateLimit("another-ip").allowed).toBe(true);
      jest.advanceTimersByTime(60_001);
      expect(checkRateLimit("rate-limit-boundary-test").allowed).toBe(true);
      // Let the module dispose its cleanup timer before restoring real timers.
      jest.advanceTimersByTime(5 * 60_000);
    } finally {
      for (const [key, value] of [
        ["RATE_LIMIT_MAX", previousMax],
        ["RATE_LIMIT_WINDOW", previousWindow],
        ["ENABLE_RATE_LIMIT", previousEnabled],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      jest.useRealTimers();
    }
  },
);
