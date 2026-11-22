import type { AccountRequest } from "./http.ts";
import { accountRequest } from "./client.ts";
import { NewApiError } from "./config.ts";

export async function readAccountModelCatalogue(req: AccountRequest) {
  const options = { reuseRequestSession: true, requireSuccess: true, maxResponseBytes: 2 * 1024 * 1024 };
  const { data } = await accountRequest(req, "/api/user/self/groups", options);
  const unavailable = () => new NewApiError("账号模型目录返回无效，请重新拉取。", 502);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw unavailable();
  const ids = Object.keys(data).filter(Boolean).sort();
  if (ids.length > 128 || ids.some(id => id !== id.trim() || id.length > 128 || /[\u0000-\u001f\u007f]/u.test(id)))
    throw unavailable();
  const groups = ids.map(id => ({ id, name: id }));
  const models = new Map<string, { id: string; groups: string[] }>();
  for (let offset = 0; offset < groups.length; offset += 4) {
    const batch = await Promise.all(groups.slice(offset, offset + 4).map(async group => {
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
