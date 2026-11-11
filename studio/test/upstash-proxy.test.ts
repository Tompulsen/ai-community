/** @jest-environment node */
import { jest } from "@jest/globals";
import { NextRequest } from "next/server";
import { GET } from "../app/api/upstash/[action]/[...key]/route";

test("Upstash proxy does not log bearer credentials", async () => {
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  global.fetch = jest
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ result: "value" }));
  try {
    const result = await GET(
      new NextRequest(
        "https://chat.test/api/upstash/get/example?endpoint=https://test.upstash.io",
        {
          headers: { authorization: "Bearer private-upstash-token" },
        },
      ),
      { params: Promise.resolve({ action: "get", key: ["example"] }) },
    );
    expect(result.status).toBe(200);
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "private-upstash-token",
    );
    expect(
      new Headers(jest.mocked(fetch).mock.calls[0][1]?.headers).get(
        "authorization",
      ),
    ).toBe("Bearer private-upstash-token");
  } finally {
    log.mockRestore();
  }
});
