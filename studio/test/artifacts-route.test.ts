/** @jest-environment node */
import { jest } from "@jest/globals";
import { NextRequest } from "next/server";

const authenticate = jest.fn<() => Promise<{ error: boolean; msg?: string }>>();
jest.unstable_mockModule("@/app/api/auth", () => ({ auth: authenticate }));
jest.unstable_mockModule("@/app/config/server", () => ({
  getServerSideConfig: () => ({
    cloudflareAccountId: "dummy-account",
    cloudflareKVNamespaceId: "dummy-namespace",
    cloudflareKVApiKey: "dummy-server-token",
    cloudflareKVTTL: "3600",
  }),
}));
const { GET, POST } = await import("../app/api/artifacts/route");
const originalFetch = global.fetch;
const id = "0123456789abcdef0123456789abcdef";

function request(value: string | null) {
  const url = new URL("https://community.example.test/studio/api/artifacts");
  if (value !== null) url.searchParams.set("id", value);
  return new NextRequest(url);
}

beforeEach(() => {
  authenticate.mockReset().mockResolvedValue({ error: false });
  global.fetch = jest.fn<typeof fetch>().mockResolvedValue(
    new Response("shared artifact", {
      headers: { "content-type": "text/plain" },
    }),
  );
});
afterEach(() => {
  global.fetch = originalFetch;
});

test.each([
  null,
  "",
  "../keys",
  "..\\keys",
  "%2e%2e%2fkeys",
  `${id}/../keys`,
  `${id}?list=1`,
  `${id}#fragment`,
  `${id}\n`,
  id.slice(1),
  `${id}0`,
  id.toUpperCase(),
])("rejects invalid ID %p before sending a credentialed request", async (value) => {
  const response = await GET(request(value));
  expect(response.status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});

test("keeps known-ID sharing within one KV value path", async () => {
  const response = await GET(request(id));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("shared artifact");
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = jest.mocked(fetch).mock.calls[0];
  const normalized = new Request(url, options);
  expect(new URL(normalized.url).pathname).toBe(
    `/client/v4/accounts/dummy-account/storage/kv/namespaces/dummy-namespace/values/${id}`,
  );
  expect(normalized.headers.get("authorization")).toBe(
    "Bearer dummy-server-token",
  );
});

test("requires site access before forwarding even a valid sharing ID", async () => {
  authenticate.mockResolvedValue({ error: true });
  expect((await GET(request(id))).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

test("accepts the sharing ID produced by POST", async () => {
  jest.mocked(fetch).mockResolvedValueOnce(Response.json({ success: true }));
  const created = await POST(
    new NextRequest("https://community.example.test/studio/api/artifacts", {
      method: "POST",
      body: "fixture artifact",
    }),
  );
  expect(created.status).toBe(200);
  const body = await created.json();
  expect(body.id).toMatch(/^[0-9a-f]{32}$/);
  expect((await GET(request(body.id))).status).toBe(200);
});
