import { accountPricingPath } from "../app/utils/account-pricing";

test("pricing entry opens the dedicated page", () => {
  expect(accountPricingPath()).toBe("/pricing");
});

test("pricing entry preserves special characters in the selected model", () => {
  const url = new URL(
    accountPricingPath("vendor/model + v2"),
    "http://localhost",
  );
  expect(url.pathname).toBe("/pricing");
  expect(url.searchParams.get("model")).toBe("vendor/model + v2");
});
