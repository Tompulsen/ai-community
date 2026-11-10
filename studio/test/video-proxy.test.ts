/** @jest-environment node */
import { jest } from "@jest/globals";
import { NextRequest } from "next/server";

const relay = jest.fn<(...args: any[]) => Promise<Response>>(async () =>
  Response.json({ ok: true }),
);
jest.unstable_mockModule("@/app/api/v1/_proxy", () => ({
  handleEdgeProxy: relay,
}));
const tasks = await import("../app/api/v1/tasks/[...path]/route");
const videos = await import("../app/api/v1/videos/route");
const content = await import("../app/api/v1/videos/[taskId]/content/route");
const { proxyGeminiVideo } = await import("../app/api/gemini-video-proxy");
const ark = await import("../app/api/ark/[...path]/route");

beforeEach(() => relay.mockClear());

test.each([
  ["POST", ["contents", "generations", "tasks"]],
  ["GET", ["contents", "generations", "tasks", "cgt_1"]],
])(
  "Seedance %s forwards only the native task endpoint",
  async (method, path) => {
    const req = new NextRequest("https://chat.test/api/ark/fixture", {
      method,
    });
    await (method === "POST" ? ark.POST : ark.GET)(req, {
      params: Promise.resolve({ path }),
    });
    const native = `api/v3/${path.join("/")}`;
    expect(relay).toHaveBeenCalledWith(req, native, { upstreamPath: native });
  },
);

test.each([
  ["POST", ["contents", "generations", "tasks", "cgt_1"]],
  ["GET", ["contents", "generations", "tasks"]],
  ["GET", ["contents", "generations", "tasks", ".."]],
  ["GET", ["models"]],
])(
  "Seedance blocks an invalid %s path %j before resolving credentials",
  async (method, path) => {
    const req = new NextRequest("https://chat.test/api/ark/fixture", {
      method,
    });
    const response = await (method === "POST" ? ark.POST : ark.GET)(req, {
      params: Promise.resolve({ path }),
    });
    expect(response.status).toBe(400);
    expect(relay).not.toHaveBeenCalled();
  },
);

test("OpenAI multipart and protected content use the existing authenticated proxy", async () => {
  const form = new FormData();
  form.set("model", "sora-2");
  const req = new NextRequest("https://chat.test/api/v1/videos", {
    method: "POST",
    body: form,
  });
  await videos.POST(req);
  expect(relay).toHaveBeenCalledWith(req, "videos");
  await content.GET(
    new NextRequest("https://chat.test/api/v1/videos/job/content"),
    {
      params: Promise.resolve({ taskId: "job" }),
    },
  );
  expect(relay.mock.calls[1][1]).toBe("videos/job/content");
});

test.each([
  { image_url: "https://cdn.test/reference.png" },
  { file_id: "file-reference" },
])(
  "OpenAI JSON references retain their body through the authenticated proxy: %j",
  async (input_reference) => {
    const body = {
      model: "sora-channel",
      prompt: "Ocean waves",
      input_reference,
    };
    const req = new NextRequest("https://chat.test/api/v1/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await videos.POST(req);
    expect(relay).toHaveBeenCalledWith(req, "videos");
    expect(await relay.mock.calls[0][0].json()).toEqual(body);
  },
);
test.each([
  ["POST", ["veo"]],
  ["GET", ["job"]],
  ["GET", ["job", "artifacts"]],
  ["GET", ["job", "artifacts", "output.mp4", "content"]],
])("allows plugin %s %j", async (method, path) => {
  const req = new NextRequest("https://chat.test/api/v1/tasks/fixture", {
    method,
  });
  await (method === "POST" ? tasks.POST : tasks.GET)(req, {
    params: Promise.resolve({ path }),
  });
  expect(relay).toHaveBeenCalledWith(req, `tasks/${path.join("/")}`);
});

test.each([
  ["POST", ["job", "artifacts"]],
  ["GET", ["job", "artifacts", "..", "content"]],
  ["GET", ["job", "delete"]],
  ["GET", [".."]],
])(
  "blocks plugin %s %j before credentials are resolved",
  async (method, path) => {
    const req = new NextRequest("https://chat.test/api/v1/tasks/fixture", {
      method,
    });
    const response = await (method === "POST" ? tasks.POST : tasks.GET)(req, {
      params: Promise.resolve({ path }),
    });
    expect(response.status).toBe(400);
    expect(relay).not.toHaveBeenCalled();
  },
);

test.each([
  ["POST", "models/veo-3.1:predictLongRunning", ""],
  ["GET", "models/veo-3.1/operations/op_1", ""],
  ["GET", "files/file_1:download", "?alt=media"],
])("allows Gemini video %s %s", async (method, path, query) => {
  const req = new NextRequest(`https://chat.test/api/v1beta/${path}${query}`, {
    method,
  });
  await proxyGeminiVideo(req, path.split("/"));
  expect(relay).toHaveBeenCalledWith(req, `v1beta/${path}`, {
    upstreamPath: `v1beta/${path}`,
    gemini: true,
  });
});

test.each([
  ["GET", "files/file_1", ""],
  ["GET", "models/veo/operations/..", ""],
  ["POST", "models/veo:predictLongRunning", "?key=stolen"],
  ["GET", "files/file_1:download", "?alt=media&url=https://evil.test"],
])("rejects unexpected Gemini %s %s %s", async (method, path, query) => {
  const req = new NextRequest(`https://chat.test/api/v1beta/fixture${query}`, {
    method,
  });
  expect((await proxyGeminiVideo(req, path.split("/"))).status).toBe(400);
  expect(relay).not.toHaveBeenCalled();
});
