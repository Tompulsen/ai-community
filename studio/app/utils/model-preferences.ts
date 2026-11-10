import { z } from "zod";
import { CHAT_API_FORMATS } from "./chat-api-format";

const modelPreferenceKeySchema = z
  .string()
  .max(4096)
  .refine((key) => {
    try {
      const parts: unknown = JSON.parse(key);
      if (!Array.isArray(parts) || parts.length !== 3) return false;
      const [source, identity, model] = parts;
      if (typeof model !== "string" || !model || model.length > 1024)
        return false;
      if (source === "account")
        return Number.isSafeInteger(identity) && identity > 0;
      if (source === "site") return typeof identity === "string";
      if (source !== "custom" || typeof identity !== "string") return false;
      const url = new URL(identity);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, "模型来源无效");

export const modelTypeOverridesSchema = z
  .record(modelPreferenceKeySchema, z.enum(["chat", "image", "video"]))
  .refine(
    (overrides) => Object.keys(overrides).length <= 2000,
    "最多保存 2000 个模型类型设置",
  );

export type ModelTypeOverrides = z.infer<typeof modelTypeOverridesSchema>;

export const modelApiFormatsSchema = z
  .record(modelPreferenceKeySchema, z.enum(CHAT_API_FORMATS))
  .refine(
    (formats) => Object.keys(formats).length <= 2000,
    "最多保存 2000 个模型接口设置",
  );

export type ModelApiFormats = z.infer<typeof modelApiFormatsSchema>;

export function validModelPreferenceKey(key: string) {
  return modelPreferenceKeySchema.safeParse(key).success;
}
