import { reasoningEffort } from "./chat-params";

export type ChatFetch = (url: string, init?: RequestInit) => Promise<Response>;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requestBody(body: RequestInit["body"]): JsonObject | undefined {
  if (typeof body !== "string") return;
  try {
    const value: unknown = JSON.parse(body);
    return isObject(value) ? value : undefined;
  } catch {
    return;
  }
}

function explicitEffort(value: unknown) {
  return (
    typeof value === "string" &&
    reasoningEffort(value.toLowerCase()) !== undefined
  );
}

function explicitBudget(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function explicitThinking(value: unknown) {
  return (
    isObject(value) && ["adaptive", "enabled"].includes(String(value.type))
  );
}

function hasExplicitEffort(body: JsonObject) {
  const value = isObject(body.reasoning) ? body.reasoning.effort : undefined;
  const thinking = isObject(body.generationConfig)
    ? body.generationConfig.thinkingConfig
    : undefined;
  return (
    explicitEffort(body.reasoning_effort) ||
    explicitEffort(value) ||
    (isObject(thinking) &&
      (explicitEffort(thinking.thinkingLevel) ||
        explicitBudget(thinking.thinkingBudget))) ||
    explicitThinking(body.thinking) ||
    (isObject(body.output_config) && explicitEffort(body.output_config.effort))
  );
}

function automaticBody(body: JsonObject) {
  const automatic = { ...body };
  if (explicitEffort(automatic.reasoning_effort))
    delete automatic.reasoning_effort;
  if (
    isObject(automatic.reasoning) &&
    explicitEffort(automatic.reasoning.effort)
  ) {
    const reasoning = { ...automatic.reasoning };
    delete reasoning.effort;
    if (Object.keys(reasoning).length) automatic.reasoning = reasoning;
    else delete automatic.reasoning;
  }
  if (
    isObject(automatic.generationConfig) &&
    isObject(automatic.generationConfig.thinkingConfig)
  ) {
    const generationConfig = { ...automatic.generationConfig };
    const thinkingConfig = { ...automatic.generationConfig.thinkingConfig };
    if (explicitEffort(thinkingConfig.thinkingLevel))
      delete thinkingConfig.thinkingLevel;
    if (explicitBudget(thinkingConfig.thinkingBudget))
      delete thinkingConfig.thinkingBudget;
    if (Object.keys(thinkingConfig).length)
      generationConfig.thinkingConfig = thinkingConfig;
    else delete generationConfig.thinkingConfig;
    automatic.generationConfig = generationConfig;
  }
  if (explicitThinking(automatic.thinking)) delete automatic.thinking;
  if (
    isObject(automatic.output_config) &&
    explicitEffort(automatic.output_config.effort)
  ) {
    const outputConfig = { ...automatic.output_config };
    delete outputConfig.effort;
    if (Object.keys(outputConfig).length)
      automatic.output_config = outputConfig;
    else delete automatic.output_config;
  }
  return JSON.stringify(automatic);
}

const reasoningField =
  /^(?:(?:body|request)\.)?(?:reasoning_effort|reasoning(?:\.effort)?|(?:generation_?config\.)?(?:thinking_?config(?:\.(?:thinking_?level|thinking_?budget))?|thinking_?level|thinking_?budget)|thinking(?:\.(?:type|budget_tokens))?|output_config\.effort|思考强度|推理强度)$/i;
const namedReasoning =
  /\breasoning[_.\s-]+effort\b|["'`](?:reasoning|thinking)["'`]|\bthinking_?(?:config|level|budget)\b|\bthinking\.(?:type|budget_tokens)\b|\boutput_config[.\s:"'`]+effort\b|(?:parameter|argument|field)\s*(?:supplied)?\s*:?\s*(?:reasoning|thinking)\b|(?:support(?:ed)?|enable[sd]?|disable[sd]?)\s+thinking\b|\bthinking\s*(?::|(?:is|must|should)\b)|(?:参数|字段)\s*[：:]?\s*reasoning\b|思考强度|推理强度/i;
const rejection =
  /\b(?:unsupported|unknown|unrecognized|invalid)(?:\b|_)|not\s+(?:support(?:ed)?|allowed|permitted|recognized)|does(?:n't| not)\s+support|\b(?:must|should)\s+be\b|不支持|不接受|不允许|无法识别|不能识别|未知|无效|非法|不合法/i;
const unrelatedError =
  /quota|insufficient|balance|credit|context|temperature|top[_ -]?p|response[_ -]?format|output[_ -]?format|stop[_ -]?sequences?|max[_ -]?(?:output[_ -]?|completion[_ -]?)tokens|rate[_ -]?limit|api[_ -]?key|authentication|authorization|unauthori[sz]ed|access denied|unknown model|invalid model|unsupported model|unrecognized model|model not found|network|timed?[_ -]?out|connection[_ -]?(?:reset|closed)|额度|配额|余额|上下文|温度|限流|鉴权|认证|密钥|模型不存在/i;

export function isUnsupportedReasoningError(status: number, value: unknown) {
  if (status !== 400 && status !== 422) return false;
  if (!isObject(value)) return false;
  if (value.reasoningUnsupported === true) return true;
  const error = value.error;
  if (typeof error === "string")
    return (
      namedReasoning.test(error) &&
      rejection.test(error) &&
      !unrelatedError.test(error)
    );
  if (!isObject(error)) return false;
  const violations = Array.isArray(error.details)
    ? error.details.flatMap((detail) =>
        isObject(detail) && Array.isArray(detail.fieldViolations)
          ? detail.fieldViolations.filter(isObject)
          : [],
      )
    : [];
  const message = [
    typeof error.message === "string" ? error.message : "",
    ...violations.map((item) =>
      typeof item.description === "string" ? item.description : "",
    ),
  ].join(" ");
  const parameter = error.param ?? error.parameter ?? error.field;
  if (
    typeof parameter === "string" &&
    parameter &&
    !reasoningField.test(parameter)
  )
    return false;
  if (
    violations.some(
      (item) =>
        typeof item.field === "string" && !reasoningField.test(item.field),
    )
  )
    return false;
  const errorCode = typeof error.code === "string" ? error.code : "";
  if (unrelatedError.test(`${message} ${errorCode.replace(/[_-]+/g, " ")}`))
    return false;
  const code = [
    errorCode !== "invalid_request_error" ? errorCode : "",
    typeof error.status === "string" ? error.status : "",
  ].join(" ");
  return (
    ((typeof parameter === "string" && reasoningField.test(parameter)) ||
      violations.some(
        (item) =>
          typeof item.field === "string" && reasoningField.test(item.field),
      ) ||
      namedReasoning.test(message) ||
      namedReasoning.test(code)) &&
    (rejection.test(message) || rejection.test(code))
  );
}

export function createReasoningFallbackFetch(
  fetcher: ChatFetch,
  options: {
    onFallback?: () => void | boolean;
    isCurrent?: () => boolean;
  } = {},
): ChatFetch {
  let attempted = false;
  let automatic = false;
  const canRetry = (signal?: AbortSignal | null) => {
    try {
      return !signal?.aborted && options.isCurrent?.() !== false;
    } catch {
      return false;
    }
  };

  return async (url, init) => {
    let body = automatic ? requestBody(init?.body) : undefined;
    const response = await fetcher(
      url,
      automatic && body ? { ...init, body: automaticBody(body) } : init,
    );
    if (
      automatic ||
      attempted ||
      (response.status !== 400 && response.status !== 422) ||
      !canRetry(init?.signal)
    )
      return response;

    body = requestBody(init?.body);
    if (!body || !hasExplicitEffort(body)) return response;

    let failure: unknown;
    try {
      failure = await response.clone().json();
    } catch {
      return response;
    }
    if (
      !isUnsupportedReasoningError(response.status, failure) ||
      !canRetry(init?.signal)
    )
      return response;
    attempted = true;
    try {
      if (options.onFallback?.() === false) return response;
    } catch {
      return response;
    }
    if (!canRetry(init?.signal)) return response;

    automatic = true;
    try {
      // Cancel before resending without waiting on an upstream body teardown.
      void response.body?.cancel().catch(() => {});
    } catch {}
    return fetcher(url, { ...init, body: automaticBody(body) });
  };
}
