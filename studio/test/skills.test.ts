/** @jest-environment node */
import { jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";

jest.unstable_mockModule("@/app/client/api", () => ({
  getHeaders: () => ({ "X-Test-Auth": "private-browser-session" }),
}));

const {
  skillDefinitionSchema,
  installedSkillSchema,
  skillCollectionSchema,
  skillInstructions,
  loadSkillCatalog,
  resolveSkillUrl,
  readSkillResource,
  verifySkillDocument,
} = await import("../app/skills/catalog");
const {
  acceptsSkill,
  styleImageMessage,
  skillRequestContext,
  skillContextRole,
  webSearchRequestContext,
} = await import("../app/skills/request");
const { getWebSearchMode } = await import("../app/utils/web-search");

test("web search defaults off and preserves enabled legacy sessions with explicit overrides", () => {
  const legacy = { kind: "web" as const, enabled: true };
  expect(getWebSearchMode({})).toBe("off");
  expect(getWebSearchMode({}, legacy)).toBe("quick");
  expect(getWebSearchMode({}, { ...legacy, enabled: false })).toBe("off");
  expect(getWebSearchMode({ webSearchMode: "off" }, legacy)).toBe("off");
  expect(getWebSearchMode({ webSearchMode: "deep" }, legacy)).toBe("deep");
});

test("legacy reasoning formats preserve skill context using a supported role", () => {
  expect(skillContextRole("o1-preview")).toBe("user");
  expect(skillContextRole("o3", "chat-completions")).toBe("user");
  expect(skillContextRole("o4-mini", "chat-completions")).toBe("user");
  expect(skillContextRole("o3", "responses")).toBe("system");
  expect(skillContextRole("gpt-4o")).toBe("system");
});

const catalog = JSON.parse(readFileSync("skills/catalog.json", "utf8"));
const definition = catalog.skills.find(
  (entry: { id: string }) => entry.id === "translation",
);
const skill = {
  ...definition,
  body: "---\nname: test\n---\nTranslate faithfully.",
  installedAt: 1,
};
const originalFetch = global.fetch;
const fetchMock = jest.fn<typeof fetch>();

test("local skills retain explicit enablement and migrate existing downloads", () => {
  expect(installedSkillSchema.parse(skill).enabled).toBe(true);
  expect(installedSkillSchema.parse({ ...skill, enabled: false }).enabled).toBe(
    false,
  );
  expect(
    skillCollectionSchema.parse({
      [definition.id]: { ...skill, enabled: false },
    })[definition.id].enabled,
  ).toBe(false);
});

beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset();
});
afterAll(() => {
  global.fetch = originalFetch;
});

test("every public document matches its catalog checksum and schema", async () => {
  for (const entry of catalog.skills) {
    expect(skillDefinitionSchema.parse(entry)).toEqual(entry);
    const body = readFileSync(`skills/${entry.id}/SKILL.md`, "utf8");
    expect(createHash("sha256").update(body).digest("hex")).toBe(entry.sha256);
  }
  expect(skillInstructions(skill)).toBe("Translate faithfully.");
  expect(() => skillCollectionSchema.parse({ wrong: skill })).toThrow();
});

test("catalog rejects non GitHub documents and duplicate IDs", async () => {
  expect(() =>
    skillDefinitionSchema.parse({
      ...definition,
      documentUrl: "https://example.com/SKILL.md",
    }),
  ).toThrow();
  expect(() =>
    skillDefinitionSchema.parse({
      ...definition,
      sourceUrl: "javascript:alert(1)",
    }),
  ).toThrow();
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({ version: 1, skills: [definition, definition] }),
    ),
  );
  await expect(loadSkillCatalog()).rejects.toThrow("重复");
});

test.each([
  ["development", "preview"],
  ["production", "resources"],
  ["test", "resources"],
] as const)(
  "%s reads the public skill repository through the same-origin %s route",
  (mode, route) => {
    jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: mode });
    try {
      expect(
        resolveSkillUrl(
          "https://raw.githubusercontent.com/qzq00767/octopus-skills/main/skills/catalog-v2.json",
        ),
      ).toBe(`/studio/api/skills/${route}/catalog-v2.json`);
      expect(resolveSkillUrl(definition.documentUrl)).toBe(
        `/studio/api/skills/${route}/translation/SKILL.md`,
      );
      const external =
        "https://raw.githubusercontent.com/another/repository/main/skills/example/SKILL.md";
      expect(resolveSkillUrl(external)).toBe(external);
      const customCatalog =
        "https://raw.githubusercontent.com/qzq00767/octopus-skills/main/skills/custom-catalog.json";
      expect(resolveSkillUrl(customCatalog)).toBe(customCatalog);
    } finally {
      jest.restoreAllMocks();
    }
  },
);

test("expanded skills use the versioned same-origin catalog so browser GitHub DNS is unnecessary", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ version: 1, skills: [definition] })),
  );
  await expect(loadSkillCatalog()).resolves.toEqual([definition]);
  expect(fetchMock.mock.calls[0][0]).toBe(
    "/studio/api/skills/resources/catalog-v2.json",
  );
});

test("the complete published directory fits the loader and validates as one response", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(catalog)));
  await expect(loadSkillCatalog()).resolves.toEqual(
    catalog.skills.filter((entry: { kind: string }) => entry.kind !== "web"),
  );
});

test("skill documents use the same-origin resource route and retain checksum verification", async () => {
  const body = readFileSync(`skills/${definition.id}/SKILL.md`, "utf8");
  fetchMock.mockResolvedValue(new Response(body));
  const downloaded = await readSkillResource(definition.documentUrl, 32000);
  expect(fetchMock.mock.calls[0][0]).toBe(
    "/studio/api/skills/resources/translation/SKILL.md",
  );
  expect(createHash("sha256").update(downloaded).digest("hex")).toBe(
    definition.sha256,
  );
});

test("remote catalogs cannot restore web search as an installable skill", async () => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        version: 1,
        skills: [definition, { ...definition, id: "web-search", kind: "web" }],
      }),
    ),
  );
  await expect(loadSkillCatalog()).resolves.toEqual([definition]);
  expect(acceptsSkill({ ...skill, kind: "web" }, false)).toBe(false);
});

test.each(["quick", "deep"] as const)(
  "independent %s web search forwards mode and cancellation without installing a skill",
  async (mode) => {
    fetchMock.mockResolvedValue(
      Response.json({
        sources: [
          { title: "Source", url: "https://example.test", snippet: "Evidence" },
        ],
      }),
    );
    const signal = new AbortController().signal;
    const context = await webSearchRequestContext(
      mode,
      "q".repeat(1500),
      signal,
    );
    expect(context).toContain("untrusted evidence");
    expect(context).toContain("https://example.test");
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(signal);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      kind: "web",
      mode,
      query: "q".repeat(1000),
    });
  },
);

test("style previews are optional, pinned and retain separate asset attribution", () => {
  const entries = catalog.skills.filter(
    (entry: { preview?: unknown }) => entry.preview,
  );
  expect(entries.length).toBeGreaterThan(0);
  const example = entries[0];
  for (const entry of entries) {
    expect(entry.kind).toBe("image-style");
    const parsed = skillDefinitionSchema.parse(entry);
    expect(parsed.preview).toEqual(entry.preview);
    const installed = installedSkillSchema.parse({
      ...entry,
      body: readFileSync(`skills/${entry.id}/SKILL.md`, "utf8"),
      installedAt: 1,
    });
    expect(skillInstructions(installed)).not.toContain(
      entry.preview.images[0].url,
    );
  }
  for (const url of [
    "javascript:alert(1)",
    "data:image/png;base64,YQ==",
    "https://example.com/preview.png",
    example.preview.images[0].url.replace(/\/[a-f0-9]{40}\//, "/main/"),
  ]) {
    expect(() =>
      skillDefinitionSchema.parse({
        ...example,
        preview: {
          ...example.preview,
          images: [{ url, caption: "Invalid" }],
        },
      }),
    ).toThrow();
  }
  const doodle = entries.find(
    (entry: { id: string }) => entry.id === "heytea-doodle-poster",
  );
  expect(doodle.license).toBe("MIT");
  expect(doodle.preview.license).toBe("CC BY 4.0");
  expect(
    catalog.skills.find(
      (entry: { id: string }) => entry.id === "taxue-halftone",
    ).preview,
  ).toBeUndefined();
});

test("browser adaptations preserve source notices without sending metadata to the model", async () => {
  const entries = catalog.skills.filter(
    (entry: { category: string; kind: string }) =>
      entry.kind === "prompt" &&
      ["writing", "coding", "productivity"].includes(entry.category),
  );
  expect(entries).toHaveLength(13);
  for (const entry of entries) {
    const body = readFileSync(`skills/${entry.id}/SKILL.md`, "utf8");
    expect(body).toContain("license-notice: |");
    expect(body).toContain("Permission is hereby granted");
    expect(body).toMatch(/upstream-revision: [a-f0-9]{40}/);
    expect(body).toContain("source: " + entry.sourceUrl);
    expect(body).toContain("adaptation: Chinese browser edition");
    expect(body.length).toBeLessThanOrEqual(32000);
    const installed = installedSkillSchema.parse({
      ...entry,
      body,
      installedAt: 1,
    });
    expect(acceptsSkill(installed, false)).toBe(true);
    expect(acceptsSkill(installed, true)).toBe(false);
    const instructions = skillInstructions(installed);
    expect(instructions).not.toContain("license-notice:");
    expect(instructions).not.toContain("Permission is hereby granted");
    expect(instructions).not.toContain("upstream-revision:");
    const controller = new AbortController();
    const context = await skillRequestContext(
      installed,
      "请帮我处理这份材料",
      controller.signal,
    );
    expect(context).toContain(instructions);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

test("resource download refuses oversized content before buffering", async () => {
  fetchMock.mockResolvedValue(
    new Response("ignored", { headers: { "Content-Length": "99999" } }),
  );
  await expect(
    readSkillResource(definition.documentUrl, 32000),
  ).rejects.toThrow("大小");
  fetchMock.mockResolvedValue(new Response("x".repeat(32001)));
  await expect(
    readSkillResource(definition.documentUrl, 32000),
  ).rejects.toThrow("大小");
});

test("image adapters preserve references, parameter priority and source attribution", () => {
  const entries = catalog.skills.filter(
    (entry: { id: string; category: string; sourceUrl: string }) =>
      entry.category === "image" &&
      entry.id !== "photo-revival" &&
      !entry.sourceUrl.includes("/qzq00767/"),
  );
  expect(entries.length).toBeGreaterThanOrEqual(9);
  const reference = {
    type: "image_url" as const,
    image_url: { url: "data:image/png;base64,YQ==" },
  };
  for (const entry of entries) {
    const body = readFileSync(`skills/${entry.id}/SKILL.md`, "utf8");
    expect(body).toContain("license-notice: |");
    expect(body).toContain("Permission is hereby granted");
    expect(body).toMatch(/upstream-revision: [a-f0-9]{40}/);
    expect(body).toContain("source: " + entry.sourceUrl);
    expect(body).toContain("adaptation: Chinese browser edition");
    const installed = installedSkillSchema.parse({
      ...entry,
      body,
      installedAt: 1,
    });
    const instructions = skillInstructions(installed);
    expect(instructions).toContain("take priority over these defaults");
    expect(instructions).not.toContain("license-notice:");
    expect(instructions).not.toContain("Permission is hereby granted");
    expect(acceptsSkill(installed, true)).toBe(true);
    expect(acceptsSkill(installed, false)).toBe(false);
    const message = {
      role: "user" as const,
      content: [
        { type: "text" as const, text: "Use my photo, 16:9, 2K, PNG." },
        reference,
      ],
    };
    const original = JSON.stringify(message);
    const result = styleImageMessage(message, installed);
    expect(result.content[1]).toEqual(reference);
    expect(JSON.stringify(result.content)).toContain("16:9, 2K, PNG");
    expect(JSON.stringify(message)).toBe(original);
  }
  expect(
    new Set(catalog.skills.map((entry: { id: string }) => entry.id)).size,
  ).toBe(catalog.skills.length);
  expect(
    catalog.skills.filter(
      (entry: { id: string }) => entry.id === "photo-revival",
    ),
  ).toHaveLength(1);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("checksum rejects changed content", async () => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
  await expect(
    verifySkillDocument("changed", definition.sha256),
  ).rejects.toThrow("版本不一致");
});

test("image style changes only outbound copy and keeps attachments", () => {
  const style = { ...skill, kind: "image-style" as const };
  const message = {
    role: "user" as const,
    content: [
      { type: "text" as const, text: "A cup" },
      {
        type: "image_url" as const,
        image_url: { url: "data:image/png;base64,abc" },
      },
    ],
  };
  const result = styleImageMessage(message, style);
  expect(message.content).toHaveLength(2);
  expect(JSON.stringify(result)).toContain("Image style direction");
  expect(result.content[1]).toEqual(message.content[1]);
  expect(acceptsSkill(style, false)).toBe(false);
  expect(acceptsSkill(skill, true)).toBe(false);
  expect(() =>
    styleImageMessage({ role: "user", content: "x".repeat(32000) }, style),
  ).toThrow();
});

test("photo revival retains its reference and makes explicit image parameters authoritative", () => {
  const entry = catalog.skills.find(
    (item: { id: string }) => item.id === "photo-revival",
  );
  const photoSkill = installedSkillSchema.parse({
    ...entry,
    body: readFileSync("skills/photo-revival/SKILL.md", "utf8"),
    installedAt: 1,
  });
  const reference = {
    type: "image_url" as const,
    image_url: { url: "data:image/png;base64,YQ==" },
  };
  const result = styleImageMessage(
    {
      role: "user",
      content: [{ type: "text", text: "Draw my photo in 16:9" }, reference],
    },
    photoSkill,
  );
  expect(result.content[1]).toEqual(reference);
  expect(JSON.stringify(result.content)).toContain("take priority");
  expect(JSON.stringify(result.content)).toContain("16:9");
  expect(acceptsSkill(photoSkill, true)).toBe(true);
  expect(acceptsSkill(photoSkill, false)).toBe(false);
});

test("prompt skills do not fetch; retrieval includes real provenance and propagates abort signal", async () => {
  const controller = new AbortController();
  expect(
    await skillRequestContext(skill, "Translate", controller.signal),
  ).toContain("Translate faithfully");
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        sources: [
          {
            title: "Research",
            url: "https://doi.org/10.123/test",
            snippet: "Metadata",
          },
        ],
      }),
    ),
  );
  const result = await skillRequestContext(
    { ...skill, kind: "papers" },
    "research",
    controller.signal,
  );
  expect(result).toContain("https://doi.org/10.123/test");
  expect(result).toContain("untrusted evidence");
  expect(fetchMock.mock.calls[0][0]).toBe("/studio/api/skills/retrieve");
  expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
    kind: "papers",
    query: "research",
  });
});

test("retrieval errors never silently fall back to fabricated search", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: "未配置联网服务" }), { status: 503 }),
  );
  await expect(
    skillRequestContext(
      { ...skill, kind: "web" },
      "query",
      new AbortController().signal,
    ),
  ).rejects.toThrow("未配置");
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ sources: [] })));
  await expect(
    skillRequestContext(
      { ...skill, kind: "papers" },
      "query",
      new AbortController().signal,
    ),
  ).rejects.toThrow("未检索到");
});
