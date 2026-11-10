/** Only expose this recognized error; never relay arbitrary provider details. */
export function isContextLimitError(message: string) {
  return /context[_\s-]*(?:length[_\s-]*exceeded|window)|maximum context length|input.{0,40}too (?:long|large)|too many (?:input )?tokens|上下文.{0,8}(?:超|限)/i.test(
    message,
  );
}

export const CONTEXT_LIMIT_MESSAGE =
  "输入超过模型上下文限制，请调低自动压缩容量，或减少当前输入和附件后重试。";
