export function stopSequences(value?: string) {
  const items = value?.split(/\r?\n/).filter((item) => item.trim().length);
  if (!items?.length) return undefined;
  if (items.length > 4)
    throw new Error("停止序列最多设置 4 项，请删除多余的项目。");
  return items;
}

export type ReasoningEffort =
  | "auto"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";

export const REASONING_EFFORT_OPTIONS: {
  value: ReasoningEffort;
  label: string;
}[] = [
  { value: "auto", label: "自动" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
  { value: "max", label: "Max" },
  { value: "ultra", label: "Ultra" },
];

export function reasoningEffort(
  value?: string,
): Exclude<ReasoningEffort, "auto"> | undefined {
  const option = REASONING_EFFORT_OPTIONS.find(
    (option) => option.value === value,
  );
  return option?.value === "auto" ? undefined : option?.value;
}

export function migrateChatParams(config?: {
  max_tokens?: number;
  compressionThreshold?: number;
}) {
  if (!config) return;
  if (config.max_tokens === 102400) config.max_tokens = 128000;
  if (config.compressionThreshold === undefined)
    config.compressionThreshold = 272000;
}
