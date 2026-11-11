/** @jest-environment node */
import { jest } from "@jest/globals";
import { NextRequest } from "next/server";
const authenticate = jest.fn<(...args: any[]) => Promise<any>>();
const sameOrigin = jest.fn();
jest.unstable_mockModule("@/app/lib/new-api/client", () => ({
  getAuthenticatedSession: authenticate,
  assertSameOrigin: sameOrigin,
}));
const route = await import("../app/api/documents/[[...path]]/route");
const realFetch = global.fetch;
const fetchMock = jest.fn<typeof fetch>();
beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset();
  authenticate.mockReset().mockResolvedValue({ session: { user: { id: 12 } } });
  sameOrigin.mockReset();
  process.env.DOCUMENT_SERVICE_URL = "http://documents:3010";
  process.env.DOCUMENT_SERVICE_SECRET = "s".repeat(40);
});
afterAll(() => {
  global.fetch = realFetch;
  delete process.env.DOCUMENT_SERVICE_URL;
  delete process.env.DOCUMENT_SERVICE_SECRET;
});
test("document proxy derives owner from the verified session and strips browser secrets", async () => {
  fetchMock.mockResolvedValue(new Response('{"assets":[]}'));
  const response = await route.GET(
    new NextRequest("https://community.test/studio/api/documents/assets", {
      headers: {
        authorization: "Bearer browser-secret",
        "x-document-owner": "user-999",
      },
    }),
    { params: Promise.resolve({ path: ["assets"] }) },
  );
  expect(response.status).toBe(200);
  expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
    Authorization: "Bearer " + "s".repeat(40),
    "X-Document-Owner": "user-12",
  });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
test("document proxy rejects cross-site reads and unknown paths before forwarding", async () => {
  const cross = await route.GET(
    new NextRequest("https://community.test/studio/api/documents/assets", {
      headers: { "sec-fetch-site": "cross-site" },
    }),
    { params: Promise.resolve({ path: ["assets"] }) },
  );
  expect(cross.status).toBe(403);
  const traversal = await route.GET(
    new NextRequest("https://community.test/studio/api/documents/invalid"),
    { params: Promise.resolve({ path: ["..", "private"] }) },
  );
  expect(traversal.status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});
test("document writes use existing same-origin guard and bounded bodies", async () => {
  const response = await route.POST(
    new NextRequest("https://community.test/studio/api/documents/upload", {
      method: "POST",
      headers: { "content-length": String(21 * 1024 * 1024) },
      body: "x",
    }),
    { params: Promise.resolve({ path: ["upload"] }) },
  );
  expect(sameOrigin).toHaveBeenCalled();
  expect(response.status).toBe(413);
  expect(fetchMock).not.toHaveBeenCalled();
});
