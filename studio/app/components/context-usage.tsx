"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Database, Gauge } from "lucide-react";
import { useAppConfig } from "../store/config";
import { fillTemplateWith, type ChatSession } from "../store/chat";
import {
  combineContextUsage,
  getContextDraftUsage,
  getContextUsageBase,
  type ContextDraft,
} from "../utils/chat-context-usage";
import { getResponseMetrics } from "../utils/chat-response-metrics";
import { ComposerParameterPopover } from "./composer-parameter-popover";
import styles from "./context-usage.module.scss";

const EMPTY_FILES: NonNullable<ContextDraft["files"]> = [];
const decimal = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});
const contextEstimateNote =
  "本地估算，含草稿；总量以当前对话的压缩容量为准，动态工具未计入。";

function formatTokenCount(value: number) {
  return value >= 1000
    ? `${decimal.format(value / 1000)}k`
    : decimal.format(value);
}

type Metric = "speed" | "cache" | "context";

export function ContextUsage({
  session,
  draftText = "",
  imageCount = 0,
  files = EMPTY_FILES,
  quote,
  pendingAttachments = 0,
  mobile = false,
}: ContextDraft & {
  session: ChatSession;
  pendingAttachments?: number;
  mobile?: boolean;
}) {
  const [active, setActive] = useState<Metric>();
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const estimateNoteId = useId();
  const models = useAppConfig((state) => state.models);
  const templates = useMemo(
    () => ({ models, format: fillTemplateWith }),
    [models],
  );
  const base = useMemo(
    () => getContextUsageBase(session, templates.format),
    [session, templates],
  );
  const draft = useMemo(
    () =>
      getContextDraftUsage(
        session.mask.modelConfig,
        { draftText, imageCount, files, quote },
        templates.format,
      ),
    [session.mask.modelConfig, draftText, imageCount, files, quote, templates],
  );
  const context = combineContextUsage(base, draft);
  const metrics = getResponseMetrics(session.messages);
  const hasResponse = session.messages.some(
    (message) => message.role === "assistant",
  );
  const speed =
    metrics.outputTokensPerSecond === undefined
      ? "\u2014 tok/s"
      : `${decimal.format(metrics.outputTokensPerSecond)} tok/s`;
  const cache =
    metrics.cacheHitPercent === undefined
      ? "\u2014"
      : `${decimal.format(metrics.cacheHitPercent)}%`;
  const percent = `${context.thresholdPercent}%`;
  const items = {
    speed: {
      title: "输出速度",
      value: speed,
      description: metrics.speedIsPrevious
        ? metrics.pending
          ? `等待本次输出，暂保留上一轮输出速度${
              metrics.speedIsEstimated ? "（估算）" : ""
            }。`
          : `本次暂无可用统计，显示上一轮输出速度${
              metrics.speedIsEstimated ? "（估算）" : ""
            }。`
        : metrics.speedIsEstimated
        ? metrics.pending
          ? "从首个输出起实时估算，不含首字前等待及工具执行时间；完成后有 token 统计时校准。"
          : "未提供输出 token 用量，按输出内容估算平均速度，不含首字前等待及工具执行时间。"
        : metrics.outputTokensPerSecond !== undefined
        ? "按首个至最后一个输出计算平均速度，不含首字前的等待；客户端估算。"
        : metrics.pending
        ? "等待首个输出，随后实时显示估算速度。"
        : hasResponse
        ? "本次回答暂无可用的生成耗时或 token 统计。"
        : "发送消息后显示平均输出速度。",
    },
    cache: {
      title: "缓存命中",
      value: cache,
      description: metrics.cacheIsPrevious
        ? metrics.pending
          ? "等待本次缓存统计，暂保留上一轮缓存命中率。"
          : "本次未提供缓存统计，显示上一轮缓存命中率。"
        : metrics.cacheHitPercent !== undefined
        ? "本次输入中复用缓存的比例。"
        : metrics.pending
        ? "等待本次请求的缓存统计。"
        : hasResponse
        ? "未提供本次请求的缓存用量。"
        : "发送消息后显示缓存命中率。",
    },
    context: {
      title: "上下文占用",
      value: percent,
    },
  };

  useEffect(() => setActive(undefined), [session.id]);

  return (
    <div className={styles.usage} data-testid="context-usage">
      <div
        ref={anchorRef}
        className={styles.metrics}
        role="group"
        aria-label="对话状态"
        data-mobile={mobile || undefined}
      >
        {(["speed", "cache", "context"] as const).map((metric) => {
          const item = items[metric];
          return (
            <button
              key={metric}
              type="button"
              className={styles.trigger}
              aria-label={`${item.title}：${item.value}`}
              aria-haspopup="dialog"
              aria-expanded={active === metric}
              aria-controls={active === metric ? panelId : undefined}
              data-select-trigger
              data-metric={metric}
              title={item.title}
              onClick={(event) => {
                triggerRef.current = event.currentTarget;
                setActive((current) =>
                  current === metric ? undefined : metric,
                );
              }}
            >
              {metric === "speed" ? (
                <Gauge size={14} strokeWidth={1.75} aria-hidden="true" />
              ) : metric === "cache" ? (
                <Database size={14} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <svg
                  className={styles.ring}
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className={styles.track}
                    cx="8"
                    cy="8"
                    r="6"
                    stroke="currentColor"
                    strokeWidth="1.75"
                  />
                  <circle
                    className={styles.fill}
                    cx="8"
                    cy="8"
                    r="6"
                    pathLength="100"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeDasharray={`${Math.min(
                      100,
                      context.thresholdPercent,
                    )} 100`}
                    transform="rotate(-90 8 8)"
                  />
                </svg>
              )}
              <span className={styles.value}>{item.value}</span>
            </button>
          );
        })}
      </div>
      <ComposerParameterPopover
        id={panelId}
        label="对话状态详情"
        compact
        smoothResize
        open={active !== undefined}
        width={272}
        align="center"
        anchorRef={anchorRef}
        triggerRef={triggerRef}
        onClose={(reason) => {
          setActive(undefined);
          if (reason === "escape")
            triggerRef.current?.focus({ preventScroll: true });
        }}
      >
        {active && (
          <div
            className={`${styles.panel} ${
              active === "context" ? styles.contextPanel : ""
            }`}
            key={active}
          >
            {active === "context" ? (
              <>
                <div
                  className={styles.contextSummary}
                  title={contextEstimateNote}
                  aria-describedby={estimateNoteId}
                >
                  <p className={styles.contextHeading}>背景信息窗口：</p>
                  <p className={styles.contextPercent}>
                    {percent} 已用（剩余{" "}
                    {Math.max(0, 100 - context.thresholdPercent)}%）
                  </p>
                  <p className={styles.contextTokens}>
                    已用 {formatTokenCount(context.totalTokens)} 标记，共{" "}
                    {formatTokenCount(context.compressionThreshold)}
                  </p>
                </div>
                <span id={estimateNoteId} className={styles.estimateNote}>
                  {contextEstimateNote}
                </span>
                {(pendingAttachments > 0 ||
                  context.reachesCompressionThreshold) && (
                  <p className={styles.note}>
                    {pendingAttachments > 0
                      ? `${pendingAttachments} 个素材处理中，完成后更新占用。`
                      : "已超过压缩容量的 90%，将自动压缩较早的文字。"}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className={styles.heading}>
                  <span>{items[active].title}</span>
                  <strong>{items[active].value}</strong>
                </div>
                <p className={styles.description}>
                  {items[active].description}
                </p>
              </>
            )}
          </div>
        )}
      </ComposerParameterPopover>
    </div>
  );
}
