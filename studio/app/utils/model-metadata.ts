import { VIDEO_MODEL_REGEXES, VISION_MODEL_REGEXES } from "../constant";
import { getModelVendor, getModelVendorName } from "./model";

export type ModelCategory =
  | "chat"
  | "video"
  | "voice"
  | "code"
  | "image"
  | "embed"
  | "tts"
  | "asr";

export type ModelTypeOverride = "auto" | "chat" | "image" | "video";

/** Explicit entries are for deployment aliases; never infer prices or context limits. */
const ALIASES: Record<string, { category: ModelCategory; vision?: boolean }> = {
  "agnes-2.5-flash": { category: "chat" },
  "agnes-2.0-flash": { category: "chat" },
};

export function getModelMetadata(model: string) {
  const name = model.toLowerCase().split("/").pop() ?? "";
  const geminiImage = /^gemini-(?:.*-)?(?:image|nano-banana)(?:-|$)/.test(name);
  const alias = ALIASES[name];
  let category: ModelCategory | null = alias?.category ?? null;
  if (!category) {
    if (/^minimax-m\d(?:[.-]|$)/.test(name)) category = "chat";
    else if (VIDEO_MODEL_REGEXES.some((pattern) => pattern.test(name)))
      category = "video";
    else if (
      /whisper|(?:^|-)asr(?:-|$)|speech-recognition|paraformer/.test(name)
    )
      category = "asr";
    else if (/embed|(?:^|[/-])bge|^e[56]-|^gte|voyage/.test(name))
      category = "embed";
    else if (
      /avatar|voice|chirp|tts|cosyvoice|speech|bark|sound|music|melotts/.test(
        name,
      )
    )
      category = "voice";
    else if (
      /code-?llama|deepseek-coder|codestral|starcoder|codegeex|wizardcoder|phocoder/.test(
        name,
      )
    )
      category = "code";
    else if (
      geminiImage ||
      /^grok-imagine-image(?:-|$)/.test(name) ||
      /dall-?e|gpt-image|stable-diffusion|(?:^|-)sd-|sdxl|midjourney|flux|imagen|kandinsky|cogview|^agnes-image-|paint|draw/.test(
        name,
      ) ||
      (name.includes("wanx") && !/t2v|i2v/.test(name)) ||
      (name.includes("chat_") && name.includes("imagine"))
    )
      category = "image";
    else if (
      getModelVendor(name) !== "other" ||
      /chat|instruct|assistant|turbo|preview|flash/.test(name)
    )
      category = "chat";
  }
  return {
    vendor: getModelVendor(model),
    vendorName: getModelVendorName(model),
    category,
    // Image capability alone does not imply the OpenAI Images endpoint.
    usesImageApi: category === "image" && !geminiImage,
    vision:
      alias?.vision ??
      VISION_MODEL_REGEXES.some((pattern) => pattern.test(model)),
  };
}
