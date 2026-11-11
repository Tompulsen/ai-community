import type {
  ChatOptions,
  ChatResponseUsage,
  MultimodalContent,
  RequestMessage,
} from "./api";
import { createResponseUsageReporter } from "./response-usage";
import type { ChatApiFormat } from "../utils/chat-api-format";
import { reasoningEffort, stopSequences } from "../utils/chat-params";
import { audioDataUrl } from "../utils/file-upload";

type NativeFormat = Exclude<ChatApiFormat, "chat-completions">;
type ChatSettings = ChatOptions["config"] & { max_tokens?: number };
type Block = Record<string, any>;

function parts(message: RequestMessage): MultimodalContent[] {
  return typeof message.content === "string"
    ? [{ type: "text", text: message.content }]
    : message.content;
}

function dataSource(url: string) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]*)$/.exec(url);
  if (match) return { mimeType: match[1], data: match[2] };
  if (/^https?:\/\//.test(url)) return { url };
  throw new Error("素材数据格式无效，请重新上传");
}

function material(part: MultimodalContent) {
  if (part.type === "file" && part.file)
    return { url: part.file.file_data, name: part.file.filename };
  if (part.type === "image_url" && part.image_url)
    return { url: part.image_url.url, name: "image" };
  if (part.type === "video_url" && part.video_url)
    return { url: part.video_url.url, name: "video.mp4" };
  if (part.type === "input_audio" && part.input_audio)
    return {
      url: audioDataUrl(part.input_audio),
      name: `audio.${part.input_audio.format}`,
    };
  throw new Error("素材内容不完整，请重新上传");
}

function responsePart(part: MultimodalContent, assistant: boolean): Block {
  if (part.type === "text")
    return {
      type: assistant ? "output_text" : "input_text",
      text: part.text || "",
    };
  const file = material(part);
  if (part.type === "image_url")
    return { type: "input_image", image_url: file.url };
  // File bytes remain intact; the upstream decides which MIME types it accepts.
  return {
    type: "input_file",
    filename: file.name,
    ...(file.url.startsWith("data:")
      ? { file_data: file.url }
      : { file_url: file.url }),
  };
}

function geminiPart(part: MultimodalContent): Block {
  if (part.type === "text") return { text: part.text || "" };
  const source = dataSource(material(part).url);
  return "data" in source
    ? { inlineData: { mimeType: source.mimeType, data: source.data } }
    : { fileData: { fileUri: source.url } };
}

function claudePart(part: MultimodalContent): Block {
  if (part.type === "text") return { type: "text", text: part.text || "" };
  const source = dataSource(material(part).url);
  return {
    type: part.type === "image_url" ? "image" : "document",
    source:
      "data" in source
        ? { type: "base64", media_type: source.mimeType, data: source.data }
        : { type: "url", url: source.url },
    ...(part.type === "file" ? { title: part.file?.filename } : {}),
  };
}

function supportsAdaptiveThinking(model: string): boolean {
  const version =
    /^claude-(?:(?:opus|sonnet|haiku)-)?(\d+)(?:[.-](\d{1,2}))?(?=-|$)/i.exec(
      model.split("/").pop() ?? "",
    );
  // Unknown aliases are validated by the upstream rather than blocked locally.
  return (
    !version ||
    Number(version[1]) > 4 ||
    (Number(version[1]) === 4 && Number(version[2] ?? 0) >= 6)
  );
}

export function buildChatRequest(
  format: NativeFormat,
  messages: RequestMessage[],
  config: ChatSettings,
): { endpoint: string; body: Block } {
  const stream = !!config.stream;
  const maxTokens = config.max_tokens;
  const effort = reasoningEffort(config.reasoningEffort);
  const stop = stopSequences(config.stop);
  if (format === "responses") {
    if (stop)
      throw new Error(
        "Responses 接口不支持停止序列，请清空停止序列或切换接口。",
      );
    return {
      endpoint: "responses",
      body: {
        model: config.model,
        stream,
        store: false,
        max_output_tokens: maxTokens,
        temperature: config.temperature,
        top_p: config.top_p,
        ...(effort ? { reasoning: { effort } } : {}),
        input: messages.map((message) => ({
          role: message.role,
          content: parts(message).map((part) =>
            responsePart(part, message.role === "assistant"),
          ),
        })),
      },
    };
  }
  const system = messages.filter((message) => message.role === "system");
  if (
    system.some((message) =>
      parts(message).some((part) => part.type !== "text"),
    )
  )
    throw new Error("此接口的系统指令不能包含附件，请将素材放在用户消息中");
  const conversation = messages.filter((message) => message.role !== "system");
  if (format === "gemini") {
    const action = stream ? "streamGenerateContent" : "generateContent";
    // Encoded slashes must not turn a model alias into additional URL segments.
    if (!config.model || /[/\\?#%]/.test(config.model))
      throw new Error("Gemini 原生接口需要不含路径分隔符的模型名称");
    return {
      endpoint: `v1beta/models/${encodeURIComponent(config.model)}:${action}${
        stream ? "?alt=sse" : ""
      }`,
      body: {
        contents: conversation.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: parts(message).map(geminiPart),
        })),
        ...(system.length
          ? {
              systemInstruction: {
                parts: system.flatMap((message) =>
                  parts(message).map(geminiPart),
                ),
              },
            }
          : {}),
        generationConfig: {
          temperature: config.temperature,
          topP: config.top_p,
          maxOutputTokens: maxTokens,
          ...(stop ? { stopSequences: stop } : {}),
          ...(effort ? { thinkingConfig: { thinkingLevel: effort } } : {}),
        },
      },
    };
  }
  return {
    endpoint: "messages",
    body: {
      model: config.model,
      stream,
      max_tokens: maxTokens || 4096,
      ...(effort
        ? {
            output_config: { effort },
            ...(supportsAdaptiveThinking(config.model)
              ? { thinking: { type: "adaptive" } }
              : {}),
          }
        : { temperature: config.temperature }),
      ...(stop ? { stop_sequences: stop } : {}),
      ...(system.length
        ? {
            system: system.flatMap((message) => parts(message).map(claudePart)),
          }
        : {}),
      messages: conversation.map((message) => ({
        role: message.role,
        content: parts(message).map(claudePart),
      })),
    },
  };
}

export function nativeChatUrl(base: string, endpoint: string): string {
  if (!endpoint.startsWith("v1beta/"))
    return `${base.replace(/\/+$/, "")}/${endpoint}`;
  const url = new URL(base);
  url.pathname = `${url.pathname
    .replace(/\/(?:v1|v1beta)\/?$/, "")
    .replace(/\/+$/, "")}/${endpoint.split("?")[0]}`;
  url.search = endpoint.includes("?") ? "?alt=sse" : "";
  return url.href;
}

function errorText(value: any): string | undefined {
  if (!value) return;
  return typeof value === "string"
    ? value
    : value.message || JSON.stringify(value);
}

function geminiParts(value: any): Block[] {
  if (value.error) throw new Error(errorText(value.error));
  const candidate = value.candidates?.[0];
  if (value.promptFeedback?.blockReason)
    throw new Error(`Gemini 拒绝了请求：${value.promptFeedback.blockReason}`);
  if (
    candidate?.finishReason &&
    !["STOP", "MAX_TOKENS"].includes(candidate.finishReason)
  )
    throw new Error(`Gemini 返回终止原因：${candidate.finishReason}`);
  return candidate?.content?.parts || [];
}

function blockText(block: Block): string {
  if (block.text) return block.text;
  if (block.inlineData?.mimeType?.startsWith("image/"))
    return `\n\n![Generated Image](data:${block.inlineData.mimeType};base64,${block.inlineData.data})`;
  if (block.type === "refusal") return block.refusal || "";
  return "";
}

export function extractChatReasoning(format: NativeFormat, value: any): string {
  if (format === "responses") {
    return (value.output || [])
      .filter((item: Block) => item.type === "reasoning")
      .flatMap((item: Block) => item.summary || [])
      .map((item: Block) => item.text || "")
      .join("");
  }
  if (format === "gemini")
    return geminiParts(value)
      .filter((part) => part.thought)
      .map(blockText)
      .join("");
  return (value.content || [])
    .filter((block: Block) => block.type === "thinking")
    .map((block: Block) => block.thinking || "")
    .join("");
}

export function extractChatResponse(format: NativeFormat, value: any): string {
  if (value.error) throw new Error(errorText(value.error));
  let blocks: Block[];
  if (format === "responses") {
    if (value.status === "failed" || value.status === "cancelled")
      throw new Error(
        errorText(value.error) || `Responses 请求${value.status}`,
      );
    blocks = (value.output || []).flatMap((item: Block) =>
      item.type === "reasoning" ? [] : item.content || [],
    );
    if (!blocks.length && value.output_text) return value.output_text;
  } else if (format === "gemini") {
    blocks = geminiParts(value).filter((part) => !part.thought);
  } else {
    blocks = value.content || [];
  }
  const text = blocks.map(blockText).join("");
  if (!text && !extractChatReasoning(format, value))
    throw new Error("接口未返回可显示的内容，请确认所选接口格式和模型");
  return text;
}

export function createChatStreamParser(
  format: NativeFormat,
  onUsage?: (usage: ChatResponseUsage) => void,
) {
  let receivedText = false;
  let receivedReasoning = false;
  const usage = createResponseUsageReporter(format, onUsage);
  return (
    data: string,
  ): {
    content: string;
    isThinking: boolean;
    reasoning?: string;
    done?: boolean;
    error?: string;
  } => {
    try {
      const value = JSON.parse(data);
      if (
        value.error ||
        value.type === "error" ||
        value.type === "response.failed"
      )
        return {
          content: "",
          isThinking: false,
          error:
            errorText(value.error || value.response?.error) ||
            "上游返回流式错误",
        };
      usage.update(value);
      if (format === "responses") {
        if (
          [
            "response.output_text.delta",
            "response.refusal.delta",
            "response.reasoning_summary_text.delta",
          ].includes(value.type)
        ) {
          if (value.type !== "response.reasoning_summary_text.delta")
            receivedText = true;
          else receivedReasoning = true;
          return {
            content: value.delta || "",
            isThinking: value.type === "response.reasoning_summary_text.delta",
          };
        }
        if (
          ["response.completed", "response.incomplete"].includes(value.type)
        ) {
          const content = receivedText
            ? ""
            : extractChatResponse(format, value.response || {});
          const reasoning = receivedReasoning
            ? ""
            : extractChatReasoning(format, value.response || {});
          return { content, reasoning, isThinking: false, done: true };
        }
      } else if (format === "gemini") {
        const blocks = geminiParts(value);
        const thinkingOnly =
          blocks.length > 0 && blocks.every((part) => part.thought);
        return {
          content: blocks
            .filter((part) => thinkingOnly || !part.thought)
            .map(blockText)
            .join(""),
          ...(thinkingOnly
            ? {}
            : {
                reasoning: blocks
                  .filter((part) => part.thought)
                  .map(blockText)
                  .join(""),
              }),
          isThinking: thinkingOnly,
          done: !!value.candidates?.[0]?.finishReason,
        };
      } else {
        if (value.type === "content_block_delta")
          return {
            content: value.delta?.text || value.delta?.thinking || "",
            isThinking: value.delta?.type === "thinking_delta",
          };
        if (value.type === "message_stop")
          return { content: "", isThinking: false, done: true };
      }
      return { content: "", isThinking: false };
    } catch (error) {
      return {
        content: "",
        isThinking: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
