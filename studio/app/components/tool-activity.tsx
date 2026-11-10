"use client";

import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  PencilLine,
} from "lucide-react";
import type { ChatMessageTool } from "../store/chat";
import { getWebToolInfo } from "../utils/web-tool";
import {
  formatToolValue,
  getToolArguments,
  getToolResult,
  getToolTable,
  isToolRecord,
  MAX_TOOL_TEXT_LENGTH,
  parseToolArgumentInput,
  safeToolUrl,
} from "../utils/tool-result";
import { copyToClipboard } from "../utils";
import Locale from "../locales";
import { AiStatus } from "./ai-status";
import { SmoothDetails } from "./collapsible-content";
import styles from "./tool-result.module.scss";

export type ToolRerun = (
  tool: ChatMessageTool,
  args: Record<string, unknown>,
) => void | Promise<void>;

export type ToolResultRenderer = (props: {
  tool: ChatMessageTool;
  result: unknown;
  onRerun?: ToolRerun;
}) => ReactNode;

export type ToolResultRenderers = Record<string, ToolResultRenderer>;

function ToolValue({ value }: { value: unknown }) {
  const table = getToolTable(value);
  if (table) {
    return (
      <>
        <div
          className={styles["table-wrap"]}
          tabIndex={0}
          role="region"
          aria-label="工具结果数据"
        >
          <table className={styles.table}>
            <thead>
              <tr>
                {table.columns.map((key) => (
                  <th key={key} scope="col">
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index}>
                  {table.columns.map((key) => (
                    <td key={key}>
                      {formatToolValue(row[key]).slice(0, 2000)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {table.totalRows > table.rows.length && (
          <p className={styles.notice}>
            显示 {table.rows.length} / {table.totalRows} 条结果
          </p>
        )}
      </>
    );
  }
  if (isToolRecord(value) && Object.keys(value).length <= 20) {
    return (
      <dl className={styles.fields}>
        {Object.entries(value).map(([key, entry]) => (
          <Fragment key={key}>
            <dt>{key}</dt>
            <dd>{formatToolValue(entry).slice(0, MAX_TOOL_TEXT_LENGTH)}</dd>
          </Fragment>
        ))}
      </dl>
    );
  }
  const text = formatToolValue(value);
  return (
    <>
      <pre className={typeof value === "string" ? styles.text : styles.raw}>
        {text.slice(0, MAX_TOOL_TEXT_LENGTH)}
      </pre>
      {text.length > MAX_TOOL_TEXT_LENGTH && (
        <p className={styles.notice}>结果较长，可复制完整内容查看。</p>
      )}
    </>
  );
}

function ToolArgumentForm({
  tool,
  args,
  onRerun,
  onClose,
  disabled,
}: {
  tool: ChatMessageTool;
  args: Record<string, unknown>;
  onRerun: ToolRerun;
  onClose: () => void;
  disabled: boolean;
}) {
  const formId = useId();
  const [inputs, setInputs] = useState(() =>
    Object.fromEntries(
      Object.entries(args).map(([key, value]) => [key, formatToolValue(value)]),
    ),
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form
      className={styles.form}
      aria-label="调整工具参数"
      aria-busy={pending}
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending || disabled) return;
        setError("");
        try {
          const next = Object.fromEntries(
            Object.entries(args).map(([key, value]) => [
              key,
              parseToolArgumentInput(value, inputs[key]),
            ]),
          );
          setPending(true);
          await onRerun(tool, next);
          onClose();
        } catch (failure) {
          setError(
            failure instanceof Error ? failure.message : "操作失败，请重试",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      {Object.entries(args).map(([key, value], index) => {
        const id = `${formId}-${index}`;
        const fieldDisabled = disabled || pending;
        const setValue = (next: string) => {
          setInputs((previous) => ({ ...previous, [key]: next }));
          setError("");
        };
        if (typeof value === "boolean") {
          return (
            <label key={key} className={styles.checkbox} htmlFor={id}>
              <input
                id={id}
                type="checkbox"
                checked={inputs[key] === "true"}
                disabled={fieldDisabled}
                onChange={(event) =>
                  setValue(String(event.currentTarget.checked))
                }
              />
              {key}
            </label>
          );
        }
        return (
          <label key={key} htmlFor={id}>
            <span>{key}</span>
            {typeof value === "string" || typeof value === "number" ? (
              <input
                id={id}
                type={typeof value === "number" ? "number" : "text"}
                step={typeof value === "number" ? "any" : undefined}
                value={inputs[key]}
                disabled={fieldDisabled}
                onChange={(event) => setValue(event.currentTarget.value)}
              />
            ) : (
              <textarea
                id={id}
                rows={3}
                value={inputs[key]}
                disabled={fieldDisabled}
                onChange={(event) => setValue(event.currentTarget.value)}
              />
            )}
          </label>
        );
      })}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles["form-actions"]}>
        <button type="button" onClick={onClose} disabled={pending}>
          取消
        </button>
        <button type="submit" disabled={pending || disabled}>
          {pending ? "正在执行" : "重新执行"}
        </button>
      </div>
    </form>
  );
}

export function ToolActivity({
  tool,
  onRerun,
  renderers,
  disabled = false,
}: {
  tool: ChatMessageTool;
  onRerun?: ToolRerun;
  renderers?: ToolResultRenderers;
  disabled?: boolean;
}) {
  const web = useMemo(() => getWebToolInfo(tool), [tool]);
  const args = useMemo(
    () => getToolArguments(tool.function?.arguments),
    [tool.function?.arguments],
  );
  const result = useMemo(() => getToolResult(tool.content), [tool.content]);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const state =
    tool.isError === true
      ? "error"
      : tool.isError === false
      ? "done"
      : web
      ? "researching"
      : "thinking";
  const name = web ? "联网搜索" : tool.function?.name || "工具调用";
  const renderer =
    tool.function?.name &&
    renderers &&
    Object.hasOwn(renderers, tool.function.name)
      ? renderers[tool.function.name]
      : undefined;
  const sources =
    web?.sources.filter((source) => safeToolUrl(source.url)) ?? [];
  const resultText = formatToolValue(result);
  const canEdit = !!onRerun && args !== null && tool.isError !== undefined;
  const copyButton = (
    <button
      type="button"
      className={styles["icon-button"]}
      aria-label={copied ? "结果已复制" : "复制工具结果"}
      title={copied ? "结果已复制" : "复制工具结果"}
      onClick={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          await copyToClipboard(tool.content ?? resultText);
          setCopied(true);
        } catch {}
      }}
    >
      {copied ? (
        <Check size={16} aria-hidden="true" />
      ) : (
        <Copy size={16} aria-hidden="true" />
      )}
    </button>
  );

  return (
    <SmoothDetails
      className={styles.card}
      data-state={state}
      data-testid="tool-result-card"
      data-chat-scroll-isolation
      openOn={tool.isError === true}
      summary={
        <>
          <div className={styles.heading}>
            <AiStatus
              state={state}
              label={`${Locale.Chat.Activity[state]} · ${name}`}
              timer={tool.isError === undefined}
            />
            {web?.query && <span className={styles.query}>{web.query}</span>}
          </div>
          {sources.length > 0 && (
            <span className={styles.count}>
              {Locale.Chat.Activity.Sources(sources.length)}
            </span>
          )}
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={styles.chevron}
          />
        </>
      }
    >
      <div className={styles.content}>
        {tool.isError && (
          <p className={styles.error} role="alert">
            {tool.errorMsg || "工具执行失败，请调整参数后重试。"}
          </p>
        )}
        {sources.length > 0 && (
          <section className={styles.section} aria-label="搜索来源">
            <ul className={styles.sources}>
              {sources.map((source) => (
                <li key={source.url}>
                  <a
                    className={styles.source}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <small>
                      <ExternalLink size={12} aria-hidden="true" />
                      {new URL(source.url).hostname}
                    </small>
                    <span className={styles["source-title"]}>
                      {source.title}
                    </span>
                    {source.snippet && <small>{source.snippet}</small>}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        {result !== undefined && (
          <section className={styles.section} aria-label="工具结果">
            {sources.length > 0 && !renderer ? (
              <SmoothDetails
                className={styles["raw-result"]}
                summary={
                  <>
                    <span>原始结果</span>
                    <ChevronDown size={14} aria-hidden="true" />
                    {copyButton}
                  </>
                }
              >
                <ToolValue value={result} />
              </SmoothDetails>
            ) : (
              <>
                <div className={styles["section-heading"]}>
                  <span>结果</span>
                  {copyButton}
                </div>
                {renderer ? (
                  renderer({
                    tool,
                    result,
                    onRerun: disabled ? undefined : onRerun,
                  })
                ) : (
                  <ToolValue value={result} />
                )}
              </>
            )}
          </section>
        )}
        {(tool.function?.arguments || canEdit) && (
          <section className={styles.section} aria-label="工具参数">
            <div className={styles["section-heading"]}>
              <span>参数</span>
              {canEdit && (
                <button
                  type="button"
                  className={styles["form-toggle"]}
                  aria-expanded={editing}
                  disabled={disabled}
                  onClick={() => setEditing((previous) => !previous)}
                >
                  <PencilLine size={14} aria-hidden="true" />
                  调整参数
                </button>
              )}
            </div>
            {editing && onRerun && args ? (
              <ToolArgumentForm
                tool={tool}
                args={args}
                onRerun={onRerun}
                onClose={() => setEditing(false)}
                disabled={disabled}
              />
            ) : (
              <ToolValue value={args ?? tool.function?.arguments} />
            )}
          </section>
        )}
      </div>
    </SmoothDetails>
  );
}
