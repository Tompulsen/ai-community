import { z } from "zod";

export type MessageInteractionOption = {
  id: string;
  label: string;
  description?: string;
};

export type MessageInteractionOptions = {
  id: string;
  question: string;
  selection: "single" | "multiple";
  options: readonly MessageInteractionOption[];
  minSelections?: number;
  maxSelections?: number;
};

export type MessageInteractionReceipt = {
  selectedIds: readonly string[];
  userMessageId?: string;
  submittedAt?: number;
};

export type MessageOptionResponse = {
  sourceMessageId: string;
  optionsId: string;
  selectedIds: string[];
};

export type MessageInteractions = {
  suggestions?: string[];
  options?: MessageInteractionOptions;
};

const identifier = z.string().trim().min(1).max(100);
const optionSchema = z.object({
  id: identifier,
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
});
export const messageInteractionOptionsSchema = z
  .object({
    id: identifier,
    question: z.string().trim().min(1).max(600),
    selection: z.enum(["single", "multiple"]),
    options: z.array(optionSchema).min(1).max(8),
    minSelections: z.number().int().min(0).max(8).optional(),
    maxSelections: z.number().int().min(1).max(8).optional(),
  })
  .superRefine((value, context) => {
    const minimum = value.minSelections ?? 1;
    const maximum =
      value.maxSelections ??
      (value.selection === "single" ? 1 : value.options.length);
    if (
      new Set(value.options.map((option) => option.id)).size !==
        value.options.length ||
      maximum > value.options.length ||
      minimum > maximum ||
      (value.selection === "single" && maximum !== 1)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "选项与选择数量不匹配",
      });
  });

export const messageInteractionsSchema = z.object({
  suggestions: z.array(z.string().trim().min(1).max(180)).max(3).optional(),
  options: messageInteractionOptionsSchema.optional(),
});

export const messageOptionResponseSchema = z.object({
  sourceMessageId: identifier,
  optionsId: identifier,
  selectedIds: z.array(identifier).max(8),
});

export function readMessageInteractions(
  value: unknown,
): MessageInteractions | undefined {
  const result = messageInteractionsSchema.safeParse(value);
  if (!result.success) return;
  const suggestions = result.data.suggestions?.filter(
    (text, index, values) => values.indexOf(text) === index,
  );
  if (!suggestions?.length && !result.data.options) return;
  return {
    ...(suggestions?.length ? { suggestions } : {}),
    ...(result.data.options ? { options: result.data.options } : {}),
  };
}

export function validateOptionSelection(
  definition: MessageInteractionOptions,
  selectedIds: readonly string[],
): string[] | undefined {
  const parsed = messageInteractionOptionsSchema.safeParse(definition);
  if (!parsed.success || !Array.isArray(selectedIds)) return;
  const unique = new Set(selectedIds);
  if (
    unique.size !== selectedIds.length ||
    selectedIds.some(
      (id) => !parsed.data.options.some((option) => option.id === id),
    )
  )
    return;
  const minimum = parsed.data.minSelections ?? 1;
  const maximum =
    parsed.data.maxSelections ??
    (parsed.data.selection === "single" ? 1 : parsed.data.options.length);
  if (unique.size < minimum || unique.size > maximum) return;
  return parsed.data.options
    .filter((option) => unique.has(option.id))
    .map((option) => option.id);
}

export function formatOptionResponse(
  definition: MessageInteractionOptions,
  selectedIds: readonly string[],
) {
  const selected = validateOptionSelection(definition, selectedIds);
  if (!selected) return;
  const labels = definition.options
    .filter((option) => selected.includes(option.id))
    .map((option) => `- ${option.label}`);
  return `针对“${definition.question}”，我的选择：\n${
    labels.length ? labels.join("\n") : "暂不选择以上选项。"
  }`;
}

/** A bound footer keeps protocol examples and user-provided code inert. */
export function messageInteractionPrompt(messageId: string) {
  return [
    "你可以为本次回答提供可选的交互信息，不要改变用户要求的精确输出格式。",
    "正常回答完成后，若有自然的后续问题，可附1到3个简短suggestions。确实需要用户先确认需求时，才提供options：single单选或multiple多选，最多8项，id唯一；不要编造用户已做的选择。",
    "交互信息只放在回答末尾的独立chat-ui代码块中，禁止在工具调用中间回合附加。没有合适的交互时不输出此块，不为凑数输出建议。",
    '格式：\n```chat-ui\n{"version":1,"messageId":' +
      JSON.stringify(messageId) +
      ',"suggestions":["一个具体的追问"],"options":{"id":"question-1","question":"需要确认的问题","selection":"single","options":[{"id":"a","label":"选项A"},{"id":"b","label":"选项B"}]}}\n```',
    "suggestions与options均可省略。multiple可指定minSelections和maxSelections；可不选择时minSelections为0。代码块中仅允许合法JSON。",
  ].join("\n");
}

type Footer = {
  start: number;
  bodyStart: number;
  bodyEnd?: number;
  trailing: boolean;
};

function interactionFooter(text: string): Footer | undefined {
  const lines = text.split("\n");
  let offset = 0;
  let fence: { char: string; length: number } | undefined;
  let footer: Footer | undefined;
  for (const line of lines) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)\r?$/.exec(line);
    if (!fence) {
      if (
        line.trim() &&
        "```chat-ui".startsWith(line.trim()) &&
        /^ {0,3}`/.test(line) &&
        offset + line.length === text.length
      ) {
        footer = { start: offset, bodyStart: text.length, trailing: true };
      } else if (match) {
        fence = { char: match[1][0], length: match[1].length };
        if (match[1] === "```" && match[2].trim() === "chat-ui")
          footer = {
            start: offset,
            bodyStart: offset + line.length + 1,
            trailing: true,
          };
      }
    } else if (
      match &&
      match[1][0] === fence.char &&
      match[1].length >= fence.length &&
      !match[2].trim()
    ) {
      if (footer && footer.bodyEnd === undefined) footer.bodyEnd = offset;
      fence = undefined;
    }
    if (footer?.bodyEnd !== undefined && offset > footer.bodyEnd && line.trim())
      footer.trailing = false;
    offset += line.length + 1;
  }
  return footer;
}

export function extractMessageInteractions(
  text: string,
  messageId: string,
  mode: "stream" | "finish" | "interrupted" = "finish",
): { content: string; interactions?: MessageInteractions } {
  const footer = interactionFooter(text);
  if (!footer?.trailing) return { content: text };
  const visible = text.slice(0, footer.start).trimEnd();
  if (mode !== "finish") return { content: visible };
  if (footer.bodyEnd === undefined) return { content: text };
  try {
    const value: unknown = JSON.parse(
      text.slice(footer.bodyStart, footer.bodyEnd).trim(),
    );
    const envelope = messageInteractionsSchema
      .extend({ version: z.literal(1), messageId: z.literal(messageId) })
      .safeParse(value);
    if (!envelope.success) return { content: text };
    return {
      content: visible,
      interactions: readMessageInteractions(envelope.data),
    };
  } catch {
    return { content: text };
  }
}
