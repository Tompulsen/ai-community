"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Copy, RefreshCw, Search } from "lucide-react";
import { newApiClient } from "../client/new-api";
import { copyToClipboard } from "../utils";
import type { ModelPriceRow, ModelPricing } from "../utils/model-pricing";
import { SelectionDialog } from "./selection-dialog";
import { SettingsSelect } from "./settings-select";
import styles from "./account-model-pricing.module.scss";

type PriceTier = NonNullable<ModelPriceRow["details"]>["tiers"][number];

function PriceValues({ tier }: { tier: PriceTier }) {
  const prices =
    tier.perRequest !== undefined
      ? [["单次调用", tier.perRequest]]
      : [
          ["输入", tier.input],
          ["输出", tier.output],
        ];
  return (
    <dl className={styles.prices}>
      {prices.map(([label, amount]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{amount}</dd>
        </div>
      ))}
    </dl>
  );
}

function ModelPriceCard({
  rows,
  featured = false,
}: {
  rows: ModelPriceRow[];
  featured?: boolean;
}) {
  const [group, setGroup] = useState(rows[0].group);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const row = rows.find((entry) => entry.group === group) ?? rows[0];
  const tier = row.details?.tiers[0];
  const extraCount = new Set(
    row.details?.tiers.flatMap(
      (entry) => entry.extras?.map((charge) => charge.label) ?? [],
    ),
  ).size;
  const unit = row.details?.unit === "tokens" ? "每百万 tokens" : "每次请求";
  const billing = row.details
    ? row.billing === "每次请求"
      ? "按次计费"
      : row.billing.split(" · ")[0]
    : row.billing;
  return (
    <article
      className={styles.card}
      aria-label={`${row.model} 模型价格`}
      data-testid={featured ? "featured-model" : undefined}
    >
      <header className={styles.cardHeading}>
        <span className={styles.avatar} aria-hidden="true">
          {Array.from(row.model)[0]?.toUpperCase()}
        </span>
        <div className={styles.identity}>
          <h3>{row.model}</h3>
          <p>{billing}</p>
          {featured && (
            <span className={styles.featuredLabel}>本次调用模型</span>
          )}
        </div>
        <button
          type="button"
          className={styles.command}
          aria-label={`复制 ${row.model} 名称`}
          title="复制模型名称"
          onClick={() => void copyToClipboard(row.model)}
        >
          <Copy size={15} aria-hidden="true" />
        </button>
      </header>
      {tier ? (
        <>
          <PriceValues tier={tier} />
          <div className={styles.unit}>
            <span>{unit}</span>
            {extraCount > 0 && (
              <button
                type="button"
                className={styles.extraCharges}
                onClick={() => setDetailsOpen(true)}
              >
                {extraCount} 项缓存费用
              </button>
            )}
            {tier.context && (
              <span className={styles.context}>{tier.context}</span>
            )}
          </div>
        </>
      ) : (
        <p className={styles.fallbackPrice}>{row.price}</p>
      )}
      <footer className={styles.cardFooter}>
        {rows.length > 1 ? (
          <SettingsSelect
            className={styles.groupSelect}
            title={`${row.model} 计费分组`}
            presentation="select"
            value={row.group}
            options={rows.map((entry) => ({
              value: entry.group,
              label: entry.group,
            }))}
            onChange={setGroup}
          />
        ) : (
          <span className={styles.group}>{row.group}</span>
        )}
        <button
          type="button"
          className={styles.command}
          aria-label={`查看 ${row.model} 价格详情`}
          onClick={() => setDetailsOpen(true)}
        >
          {row.details && row.details.tiers.length > 1 ? "分档详情" : "详情"}
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </footer>
      <SelectionDialog
        title="模型计费详情"
        compact
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
      >
        <div className={styles.details}>
          <h3>{row.model}</h3>
          <p className={styles.detailNote}>
            {row.group} · {row.billing}
          </p>
          {row.details ? (
            row.details.tiers.map((entry, index) => (
              <section
                className={styles.tier}
                key={entry.context ?? index}
                aria-label={entry.context ?? "计费价格"}
              >
                {entry.context && <h4>{entry.context}</h4>}
                <PriceValues tier={entry} />
                {!!entry.extras?.length && (
                  <dl className={styles.extraPrices}>
                    {entry.extras.map((charge) => (
                      <div key={charge.label}>
                        <dt>{charge.label}</dt>
                        <dd>{charge.amount}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            ))
          ) : (
            <p className={styles.fallbackPrice}>{row.price}</p>
          )}
        </div>
      </SelectionDialog>
    </article>
  );
}

export function AccountModelPricing({
  model = "",
  userId,
  previewData,
  showTitle = true,
}: {
  model?: string;
  userId: number;
  previewData?: ModelPricing;
  showTitle?: boolean;
}) {
  const [data, setData] = useState<ModelPricing>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (previewData) {
      setData(previewData);
      setError("");
      return;
    }
    const controller = new AbortController();
    setData(undefined);
    setError("");
    const changed = () => {
      controller.abort();
      setData(undefined);
      setError("账号或密钥已变化，请刷新价格。");
    };
    window.addEventListener("new-api-session-changed", changed);
    void newApiClient
      .modelPricing(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        if (value.userId !== userId) throw new Error("Account changed");
        setData(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("暂时无法读取模型价格，请重试。");
      });
    return () => {
      controller.abort();
      window.removeEventListener("new-api-session-changed", changed);
    };
  }, [attempt, userId, previewData]);
  const models = useMemo(() => {
    const grouped = new Map<string, ModelPriceRow[]>();
    for (const row of [...(data?.rows ?? [])].sort(
      (a, b) =>
        a.model.localeCompare(b.model) || a.group.localeCompare(b.group),
    )) {
      const group = grouped.get(row.model);
      if (group) group.push(row);
      else grouped.set(row.model, [row]);
    }
    return [...grouped.entries()].sort(
      ([a], [b]) => Number(b === model) - Number(a === model),
    );
  }, [data, model]);
  const rows = useMemo(
    () =>
      models.filter(
        ([name]) =>
          name === model ||
          name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [models, model, query],
  );
  const missingModel = useMemo(
    () => model && data && !models.some(([name]) => name === model),
    [model, data, models],
  );
  return (
    <section
      className={styles.catalog}
      aria-label="模型价格"
      data-testid="account-model-pricing"
    >
      <div className={styles.heading}>
        {showTitle && <h2>模型价格</h2>}
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <Search size={15} aria-hidden="true" />
            <span className={styles.srOnly}>搜索模型</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索模型"
              disabled={!data}
            />
          </label>
          {data && (
            <span className={styles.count} aria-live="polite">
              {query.trim() ? `${rows.length} / ` : ""}
              {models.length} 个模型
            </span>
          )}
          <button
            type="button"
            className={styles.command}
            aria-label="刷新价格"
            onClick={() => setAttempt((value) => value + 1)}
            disabled={!data && !error}
          >
            <RefreshCw size={15} aria-hidden="true" />
            刷新
          </button>
        </div>
      </div>
      {missingModel && (
        <p className={styles.state} role="status" data-testid="featured-model">
          {model}：模型广场暂未提供此模型的可用价格，请查看模型详情。
        </p>
      )}
      {!data && !error && (
        <p role="status" className={styles.state}>
          正在读取模型价格…
        </p>
      )}
      {error && (
        <div role="alert" className={styles.state}>
          <p>{error}</p>
          <button
            type="button"
            className={styles.command}
            onClick={() => setAttempt((value) => value + 1)}
          >
            重新读取
          </button>
        </div>
      )}
      {data && (
        <>
          {rows.length ? (
            <div className={styles.grid} data-testid="model-price-grid">
              {rows.map(([name, prices]) => (
                <ModelPriceCard
                  key={name}
                  rows={prices}
                  featured={name === model}
                />
              ))}
            </div>
          ) : (
            <p className={styles.state} role="status">
              {models.length
                ? "没有匹配的模型，试试其他名称。"
                : "模型广场暂未提供可用价格。"}
            </p>
          )}
          <p className={styles.note}>
            每次请求为单次调用价格；按量模型分别列出输入、输出价格。动态计费及图片、音频等附加费用以模型广场详情为准。
          </p>
        </>
      )}
    </section>
  );
}
