import type { AccountRequest } from "./http.ts";
import { getAuthenticatedSession, upstream } from "./client.ts";
import { NewApiError, requireNewApiConfig } from "./config.ts";
import { modelPriceRows, type ModelPricing } from "./pricing.ts";

export async function readModelPricing(
  req: AccountRequest,
): Promise<ModelPricing> {
  const { session } = await getAuthenticatedSession(req);
  if (!session.user) throw new NewApiError("请先登录章鱼账号", 401);
  const config = requireNewApiConfig();
  const [response, status] = await Promise.all([
    fetch(config.baseUrl + "/api/pricing", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    }),
    upstream("/api/status"),
  ]);
  if (!response.ok) throw new NewApiError("暂时无法读取模型价格，请重试", 502);
  const catalog = await response.json() as { success?: boolean };
  if (catalog?.success !== true)
    throw new NewApiError("暂时无法读取模型价格，请重试", 502);
  const prices = modelPriceRows(catalog, status.data ?? {});
  return {
    ...prices,
    account: session.user.username,
    userId: session.user.id,
    walletUrl: new URL("/wallet", config.publicUrl).href,
    pricingUrl: new URL("/pricing", config.publicUrl).href,
    fetchedAt: new Date().toISOString(),
  };
}
