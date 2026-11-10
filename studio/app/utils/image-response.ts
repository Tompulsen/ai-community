import { getLines, getMessages } from "@fortaine/fetch-event-source/parse";

export function imageResultUrl(result: any): string | null {
  const item = result.data?.[0] ?? result;
  if (typeof item.url === "string" && item.url) return item.url;
  const base64 = item.b64_json ?? item.result;
  if (typeof base64 !== "string" || !base64) return null;
  if (base64.startsWith("data:image/")) return base64;
  const format = item.output_format ?? result.output_format ?? "png";
  const mime =
    format === "jpeg"
      ? "image/jpeg"
      : format === "webp"
      ? "image/webp"
      : "image/png";
  return `data:${mime};base64,${base64}`;
}

export function imageResultUrls(result: any): string[] {
  const items = Array.isArray(result?.data) ? result.data : [result];
  return items.flatMap((item: any) => {
    if (!item || typeof item !== "object") return [];
    const url = imageResultUrl({
      ...item,
      output_format: item.output_format ?? result?.output_format,
    });
    return url ? [url] : [];
  });
}

export function generatedImageUrls(content: string): string[] {
  if (!content.startsWith("![Generated Image](")) return [];
  const lines = content.trim().split(/\r?\n\s*\r?\n/);
  if (lines.length > 10) return [];
  const images = lines.map((line) =>
    /^!\[Generated Image\]\(([^()\r\n]+)\)$/.exec(line),
  );
  return images.every(Boolean) ? images.map((image) => image![1]) : [];
}

// Use the existing SSE parser so fragmented chunks, CRLF and multiline data work.
export async function readImageStream(
  response: Response,
  onPreview?: (image: string) => void,
  onImages?: (images: string[]) => void,
): Promise<string> {
  if (!response.body) throw new Error("生图流式响应为空");
  let completedImage: string | null = null;
  const completedImages: string[] = [];
  const onChunk = getLines(
    getMessages((message) => {
      if (!message.data || message.data === "[DONE]") return;
      const event = JSON.parse(message.data);
      const type = event.type || message.event;
      if (event.error || type === "error" || type === "response.failed") {
        const error = event.response?.error ?? event.error ?? event;
        throw new Error(
          (typeof error === "string" ? error : error.message) || "流式生图失败",
        );
      }
      if (type?.endsWith(".partial_image")) {
        const image = imageResultUrl({
          ...event,
          b64_json: event.b64_json ?? event.partial_image_b64,
        });
        if (image) onPreview?.(image);
      } else if (
        type === "image_generation.completed" ||
        type === "image_edit.completed"
      ) {
        const images = imageResultUrls(event);
        completedImages.push(...images);
        completedImage = images[0] ?? completedImage;
      } else if (
        type === "response.output_item.done" &&
        event.item?.type === "image_generation_call"
      ) {
        completedImage = imageResultUrl(event.item);
        if (completedImage) completedImages.push(completedImage);
      } else if (type === "response.completed") {
        const image = event.response?.output?.find(
          (item: any) => item.type === "image_generation_call" && item.result,
        );
        completedImage = imageResultUrl(image ?? {}) ?? completedImage;
        if (completedImage) completedImages.push(completedImage);
      }
    }),
  );
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(value);
    }
    // Flush an event even if a compatible server omits the final blank line.
    onChunk(new TextEncoder().encode("\n\n"));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!completedImage) throw new Error("生图流式响应已中断，未收到最终图片");
  onImages?.([...new Set(completedImages)]);
  return completedImage;
}
