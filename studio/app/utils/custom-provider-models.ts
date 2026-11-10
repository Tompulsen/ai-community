import { customApiPath } from "./custom-provider";

export function customModelNames(value: string) {
  return [
    ...new Set(
      value
        .split(/[,\r\n]+/)
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

export async function fetchCustomModels(
  base: string,
  key: string,
  signal: AbortSignal,
) {
  if (!key.trim()) throw new Error("请填写自定义接口的 API Key");
  const response = await fetch(customApiPath(base, "models"), {
    headers: { Authorization: `Bearer ${key.trim()}` },
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (!response.ok)
    throw new Error(
      `获取模型失败（HTTP ${response.status}），请检查接口地址和密钥`,
    );
  const json = await response.json();
  if (!Array.isArray(json?.data))
    throw new Error("服务商返回的模型列表格式无效");
  const models = [
    ...new Set<string>(
      json.data.flatMap((model: { id?: unknown }) =>
        typeof model?.id === "string" && model.id.trim()
          ? [model.id.trim()]
          : [],
      ),
    ),
  ];
  if (!models.length) throw new Error("服务商未返回可用模型");
  return models;
}
