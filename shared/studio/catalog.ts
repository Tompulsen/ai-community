import { z } from "zod";
import { documentSkill } from "./document-skill.ts";

const githubDocument = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "raw.githubusercontent.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^\/[\w.-]+\/[\w.-]+\/[\w./-]+\/SKILL\.md$/.test(url.pathname)
    );
  }, "技能正文必须来自 GitHub 原始文件");
const githubSource = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com";
  });
const skillPreviewSchema = z.object({
  images: z
    .array(
      z.object({
        url: z
          .string()
          .url()
          .refine((value) => {
            const url = new URL(value);
            return (
              url.protocol === "https:" &&
              url.hostname === "raw.githubusercontent.com" &&
              !url.username &&
              !url.password &&
              !url.port &&
              /^\/[\w.-]+\/[\w.-]+\/[a-f0-9]{40}\/[\w./-]+\.(png|jpe?g|webp|avif)$/i.test(
                url.pathname,
              )
            );
          }, "预览图必须来自 GitHub 固定版本的图片"),
        caption: z.string().min(1).max(120),
      }),
    )
    .min(1)
    .max(4),
  credit: z.string().min(1).max(160),
  license: z.enum(["MIT", "CC BY 4.0"]),
  licenseUrl: githubSource,
});
export const skillDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().min(1).max(80),
  description: z.string().max(500),
  category: z.enum([
    "search",
    "translation",
    "image",
    "writing",
    "coding",
    "productivity",
  ]),
  kind: z.enum([
    "prompt",
    "image-style",
    "web",
    "papers",
    "client",
    "document",
  ]),
  version: z.string().min(1).max(40),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  documentUrl: githubDocument,
  sourceUrl: githubSource,
  license: z.string().min(1).max(100),
  preview: skillPreviewSchema.optional(),
});
export type SkillDefinition = z.infer<typeof skillDefinitionSchema>;
export const installedSkillSchema = skillDefinitionSchema.extend({
  body: z.string().min(1).max(32000),
  installedAt: z.number().finite().nonnegative(),
  enabled: z.boolean().default(true),
});
export type InstalledSkill = z.infer<typeof installedSkillSchema>;
export const skillCollectionSchema = z
  .record(z.string(), installedSkillSchema)
  .refine((value) => Object.keys(value).length <= 100, "最多安装 100 个技能")
  .refine(
    (value) => Object.entries(value).every(([id, skill]) => id === skill.id),
    "技能标识不匹配",
  );
const catalogSchema = z
  .object({
    version: z.literal(1),
    skills: z.array(skillDefinitionSchema).max(100),
  })
  .refine(
    ({ skills }) =>
      new Set(skills.map((skill) => skill.id)).size === skills.length,
    "技能目录包含重复标识",
  );
const catalogUrl =
  import.meta.env?.VITE_SKILL_CATALOG_URL ||
  "https://raw.githubusercontent.com/qzq00767/octopus-skills/main/skills/catalog-v2.json";

export const CLIENT_SKILL_SOURCES = [
  {
    name: "OpenAI Skills",
    repo: "openai/skills",
    description: "面向 Codex 等客户端的技能集合",
  },
  {
    name: "Anthropic Skills",
    repo: "anthropics/skills",
    description: "包含文档、设计等客户端技能",
  },
  {
    name: "MyClaude",
    repo: "stellarlinkco/myclaude",
    description: "客户端工作流与工具配置参考",
  },
  {
    name: "Awesome Claude Skills",
    repo: "ComposioHQ/awesome-claude-skills",
    description: "社区技能索引与客户端使用参考",
  },
].map(({ repo, ...item }) => ({
  ...item,
  url: `https://github.com/${repo}`,
  downloadUrl: `https://github.com/${repo}/archive/HEAD.zip`,
}));

export function resolveSkillUrl(url: string) {
  const parsed = new URL(url);
  const resource = parsed.pathname.split("/skills/")[1] ?? "";
  if (
    parsed.origin === "https://raw.githubusercontent.com" &&
    parsed.pathname.startsWith("/qzq00767/octopus-skills/main/skills/") &&
    /^(?:catalog(?:-v2)?\.json|[a-z0-9][a-z0-9-]{0,63}\/SKILL\.md)$/.test(
      resource,
    )
  ) {
    return `/api/creation/skills/resources/` + resource;
  }
  return url;
}

export async function readSkillResource(url: string, maxBytes: number) {
  const response = await fetch(resolveSkillUrl(url), {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("无法下载技能，请检查仓库地址或稍后重试");
  if (Number(response.headers.get("content-length")) > maxBytes)
    throw new Error("技能文件超出大小限制");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("技能文件为空");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("技能文件超出大小限制");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function loadSkillCatalog() {
  const url = new URL(catalogUrl);
  if (url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com")
    throw new Error("技能目录必须使用 GitHub 原始文件地址");
  const catalog = await readSkillResource(catalogUrl, 128000).catch(() => null);
  const skills = catalog ? catalogSchema.parse(JSON.parse(catalog)).skills : [];
  return [
    ...skills.filter(
      (skill) => skill.kind !== "document" && skill.id !== documentSkill.id,
    ),
  ];
}

export function skillInstructions(skill: InstalledSkill) {
  return skill.body.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
}

export async function verifySkillDocument(body: string, sha256: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== sha256)
    throw new Error("技能正文与目录版本不一致，请刷新目录后重试");
}
