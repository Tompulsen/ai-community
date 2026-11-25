import type { AccountRequest } from "./http.ts";
import { accountRequest } from "./client.ts";
import { NewApiError } from "./config.ts";

export async function readAccountModelCatalogue(req: AccountRequest, group?: string) {
  const options = { reuseRequestSession: true, requireSuccess: true, maxResponseBytes: 2 * 1024 * 1024 };
  const { data } = await accountRequest(req, "/api/user/self/groups", options);
  const unavailable = () => new NewApiError("账号模型目录返回无效，请重新拉取。", 502);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw unavailable();
  const ids = Object.keys(data).filter(Boolean).sort();
  if (ids.length > 128 || ids.some(id => id !== id.trim() || id.length > 128 || /[\u0000-\u001f\u007f]/u.test(id)))
    throw unavailable();
  const groups = ids.map(id => ({ id, name: id }));
  if (group !== undefined && !ids.includes(group)) throw new NewApiError("该分组不可用，请刷新分组列表", 403);
  const selected = group === undefined ? groups : groups.filter(item => item.id === group);
  const models = new Map<string, { id: string; groups: string[] }>();
  for (let offset = 0; offset < selected.length; offset += 4) {
    const batch = await Promise.all(selected.slice(offset, offset + 4).map(async group => {
      const { data: items } = await accountRequest(req, `/api/user/models?group=${encodeURIComponent(group.id)}`, options);
      if (!Array.isArray(items) || items.some(item => typeof item !== "string")) throw unavailable();
      return { group, items: items as string[] };
    }));
    for (const { group, items } of batch) for (const id of new Set(items)) {
      const model = models.get(id) || { id, groups: [] };
      model.groups.push(group.id);
      models.set(id, model);
    }
  }
  return { groups, items: [...models.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

export function classifyModel(id: string): 'text' | 'image' | 'video' | null {
  const name = id.toLowerCase().split('/').pop()!
  if (/seedance|^veo(?:[-_.]?\d|$)|t2v|i2v|s2v|video|sora|runway|pika|gen-[23]|luma|kling|hailuo/.test(name)) return 'video'
  if (/gemini-(?:.*-)?(?:image|nano-banana)|grok-imagine-image|dall-?e|gpt-image|stable-diffusion|(?:^|-)sd-|sdxl|midjourney|flux|imagen|kandinsky|cogview|^agnes-image-|paint|draw|wanx/.test(name)) return 'image'
  if (/embed|whisper|(?:^|-)asr|tts|voice|speech|rerank|^bge|^e[56]-|^gte|music/.test(name)) return null
  return 'text'
}
