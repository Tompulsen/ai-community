import { jest } from "@jest/globals";
import { formatMessageDate } from "../app/utils/format";

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 10, 8, 12));
});

afterEach(() => {
  jest.useRealTimers();
});

test.each<[Date, string]>([
  [new Date(2026, 10, 8, 9, 5), "09:05"],
  [new Date(2026, 10, 7, 9, 5), "昨天 09:05"],
  [new Date(2026, 10, 4, 9, 5), "周三 09:05"],
  [new Date(2026, 10, 1, 9, 5), "11-01 09:05"],
  [new Date(2026, 9, 30, 9, 5), "10-30 09:05"],
])(
  "formats chat and video message dates consistently: %s",
  (date, expected) => {
    expect(formatMessageDate(date)).toBe(expected);
  },
);
