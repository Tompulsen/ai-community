"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  newApiClient,
  type NewApiModelGroups,
  type NewApiStatus,
  type NewApiUser,
} from "../client/new-api";
import { ChatControllerPool } from "../client/controller";
import { useVideoStore } from "../store/video";
import {
  getLocalScope,
  isLocalWorkspaceActive,
} from "../utils/local-workspace";
import { composerPrice, composerQuota } from "../utils/composer-pricing";
import type { ModelPricing } from "../utils/model-pricing";
import { Path } from "../constant";
import styles from "./composer-billing.module.scss";

type Billing = {
  user: NewApiUser;
  status?: NewApiStatus;
  groups?: NewApiModelGroups;
  pricing?: ModelPricing;
};

export function ComposerBilling({
  model,
  customProvider,
}: {
  model: string;
  customProvider: boolean;
}) {
  const navigate = useNavigate();
  const [data, setData] = useState<Billing>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false,
      revision = 0,
      lastRead = 0;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (fresh = false) => {
      const current = ++revision,
        owner = getLocalScope();
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const valid = () =>
        !disposed &&
        current === revision &&
        owner === getLocalScope() &&
        isLocalWorkspaceActive();
      setLoading(true);
      setFailed(false);
      lastRead = Date.now();
      try {
        // Confirm identity before starting identity-bound pricing requests.
        const session = await newApiClient.session(!fresh);
        if (!valid()) return;
        if (!session.authenticated || !session.user)
          throw new Error("Account unavailable");
        const [status, groups, pricing] = await Promise.allSettled([
          newApiClient.status(),
          newApiClient.modelGroups(session.user.id, fresh),
          newApiClient.modelPricing(request.signal),
        ]);
        if (!valid()) return;
        setData({
          user: session.user,
          status: status.status === "fulfilled" ? status.value : undefined,
          groups: groups.status === "fulfilled" ? groups.value : undefined,
          pricing: pricing.status === "fulfilled" ? pricing.value : undefined,
        });
        setFailed(
          [status, groups, pricing].some((item) => item.status === "rejected"),
        );
      } catch {
        if (valid()) {
          setData(undefined);
          setFailed(true);
        }
      } finally {
        if (valid()) setLoading(false);
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(true), 300);
    };
    const changed = () => {
      revision++;
      controller?.abort();
      setData(undefined);
      setLoading(true);
      schedule();
    };
    const visible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRead > 30_000
      )
        schedule();
    };
    let pending = ChatControllerPool.hasPending();
    const unsubscribeChat = ChatControllerPool.subscribe(() => {
      const next = ChatControllerPool.hasPending();
      if (pending && !next) schedule();
      pending = next;
    });
    const unsubscribeVideo = useVideoStore.subscribe((next, previous) => {
      if (
        (previous.isGenerating && !next.isGenerating) ||
        next.results.some(
          (result) =>
            result.status !== "pending" &&
            previous.results.some(
              (old) => old.id === result.id && old.status === "pending",
            ),
        )
      )
        schedule();
    });
    window.addEventListener("new-api-session-changed", changed);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    void load(attempt > 0);
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(timer);
      unsubscribeChat();
      unsubscribeVideo();
      window.removeEventListener("new-api-session-changed", changed);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [attempt]);

  const price = customProvider
    ? { text: "自定义接口计费" }
    : data?.pricing && data.groups
    ? composerPrice(model, data.user, data.groups, data.pricing)
    : { text: loading ? "价格读取中…" : "价格暂不可用" };

  return (
    <div
      className={styles.billing}
      aria-label="模型费用与账户额度"
      data-composer-billing
      aria-busy={loading}
    >
      <button
        type="button"
        className={styles.price}
        title={price.detail || "查看模型定价"}
        onClick={() => navigate(Path.Pricing)}
      >
        <span className={styles.label}>费用</span>
        <span>{price.text}</span>
      </button>
      <div className={styles.balance}>
        <button
          type="button"
          title="查看账户额度"
          onClick={() => navigate(Path.Account)}
        >
          <span className={styles.label}>可用额度</span>
          <span aria-live="polite">
            {data ? composerQuota(data.user.quota, data.status) : "—"}
          </span>
        </button>
        <button
          type="button"
          className={styles.refresh}
          aria-label={failed ? "重试读取费用和额度" : "刷新费用和额度"}
          title={
            loading
              ? "正在更新费用和额度"
              : failed
              ? "读取失败，点击重试"
              : "刷新费用和额度"
          }
          disabled={loading}
          onClick={() => setAttempt((value) => value + 1)}
        >
          <RefreshCw size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
