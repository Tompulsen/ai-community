import {
  createLocalAccountPreviewClient,
  getLocalAccountPreviewClient,
  localAccountPreview,
} from "../app/utils/local-account-preview";

test("the same local preview client survives route remounts", () => {
  expect(getLocalAccountPreviewClient()).toBe(getLocalAccountPreviewClient());
});

test("local key actions update only their own preview session", async () => {
  const demo = createLocalAccountPreviewClient();
  const input = {
    name: "新建预览密钥",
    group: "default",
    expired_time: -1,
    remain_quota: 500000,
    unlimited_quota: false,
    model_limits_enabled: false,
    model_limits: "",
  };
  await demo.createToken(input);
  let keys = await demo.tokens();
  const id = keys.items[0].id;
  expect(keys.total).toBe(3);
  await demo.updateToken(id, { ...input, name: "修改后" });
  await demo.selectToken(id);
  expect((await demo.session()).selectedTokenId).toBe(id);
  await demo.setTokenStatus(id, 2);
  await expect(demo.selectToken(id)).rejects.toThrow("启用");
  await demo.setTokenStatus(id, 1);
  await demo.deleteToken(id);
  expect((await demo.tokens()).total).toBe(2);
  expect((await demo.session()).selectedTokenId).toBeNull();
  expect((await createLocalAccountPreviewClient().tokens()).total).toBe(2);
  expect(localAccountPreview.tokens.items).toHaveLength(2);
});

test("local topups settle once and subscriptions remain separate from balance", async () => {
  const demo = createLocalAccountPreviewClient();
  const balance = (await demo.session()).user!.quota;
  const order = await demo.walletPay(20, "wxpay");
  expect((await demo.session()).user!.quota).toBe(balance);
  expect((await demo.walletOverview()).history[0].status).toBe("pending");
  await demo.completePayment(order.tradeNo);
  await demo.completePayment(order.tradeNo);
  expect((await demo.session()).user!.quota).toBe(balance + 20 * 500000);
  expect((await demo.walletOverview()).history[0].status).toBe("success");
  const plan = await demo.walletSubscriptionPay(1, "alipay");
  await demo.completePayment(plan.tradeNo);
  const wallet = await demo.walletOverview();
  expect(wallet.subscriptions).toHaveLength(1);
  expect(wallet.subscriptions[0].planId).toBe(1);
  expect((await demo.session()).user!.quota).toBe(balance + 20 * 500000);
});

test("redemption reports errors and prevents repeated credits", async () => {
  const demo = createLocalAccountPreviewClient();
  await expect(demo.walletRedeem("bad-code")).rejects.toThrow("无效");
  const before = (await demo.session()).user!.quota;
  await demo.walletRedeem("PREVIEW-50");
  await expect(demo.walletRedeem("preview-50")).rejects.toThrow("已使用");
  expect((await demo.session()).user!.quota).toBe(before + 50 * 500000);
});

test("logout, login and profile editing do not mutate the initial fixtures", async () => {
  const demo = createLocalAccountPreviewClient();
  await demo.logout();
  expect((await demo.session()).authenticated).toBe(false);
  await demo.login("demo", "password");
  expect((await demo.session()).authenticated).toBe(true);
  await demo.updateProfile({
    username: "demo",
    displayName: "界面验收",
    email: "demo@example.com",
  });
  expect((await demo.session()).user!.display_name).toBe("界面验收");
  expect(localAccountPreview.session.user.display_name).toBe("本地预览账号");
});
