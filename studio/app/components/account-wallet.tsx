"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  Clock3,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Ticket,
  Wallet,
} from "lucide-react";
import { newApiClient } from "../client/new-api";
import type { LocalAccountPreviewClient } from "../utils/local-account-preview";
import { prefersReducedMotion } from "../utils/motion";
import {
  safeWalletPaymentUrl,
  type WalletOverview,
  type WalletPayment,
  type WalletPlan,
  type WalletQuote,
} from "../utils/wallet";
import styles from "./account-wallet.module.scss";
import {
  cachedWalletOverview,
  cachedWalletQuote,
  readWalletOverview,
  readWalletQuote,
} from "../utils/wallet-cache";

function duration(plan: WalletPlan) {
  if (plan.durationUnit === "custom")
    return `${plan.customSeconds / 3600} 小时`;
  return `${plan.durationValue} ${
    { year: "年", month: "个月", day: "天", hour: "小时" }[plan.durationUnit] ||
    plan.durationUnit
  }`;
}

function OrderTime({ value }: { value: number }) {
  const unknown = <span>时间未知</span>;
  if (!Number.isFinite(value) || value <= 0) return unknown;
  const legacy = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(
    String(value),
  );
  const calendar = legacy
    ? `${legacy[1]}-${legacy[2]}-${legacy[3]}T${legacy[4]}:${legacy[5]}:${legacy[6]}`
    : undefined;
  // Legacy records contain wall-clock time without a timezone; preserve it.
  const date = new Date(calendar ? `${calendar}Z` : value * 1000);
  if (
    !Number.isFinite(date.getTime()) ||
    (calendar && date.toISOString().slice(0, 19) !== calendar)
  )
    return unknown;
  return (
    <time dateTime={calendar ?? date.toISOString()}>
      {date.toLocaleString("zh-CN", {
        timeZone: calendar ? "UTC" : undefined,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}
    </time>
  );
}

export function AccountWallet({
  userId,
  onRefreshBalance,
  previewClient,
  navigation,
}: {
  userId: number;
  onRefreshBalance: () => Promise<unknown>;
  previewClient?: LocalAccountPreviewClient;
  navigation?: ReactNode;
}) {
  const client = previewClient ?? newApiClient;
  const [data, setData] = useState<WalletOverview | undefined>(() =>
    cachedWalletOverview(client, userId),
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(
    () => !cachedWalletOverview(client, userId),
  );
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [quote, setQuote] = useState<WalletQuote>();
  const [quoteError, setQuoteError] = useState("");
  const [payment, setPayment] = useState<WalletPayment>();
  const [paymentClient, setPaymentClient] = useState<typeof client>();
  const [checkout, setCheckout] = useState(false);
  const [creatingPayment, setCreatingPayment] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [previewPaid, setPreviewPaid] = useState(false);
  const [notice, setNotice] = useState("");
  const [code, setCode] = useState("");
  const [redemptionOpen, setRedemptionOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<WalletPlan>();
  const [revision, setRevision] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const historyRef = useRef<HTMLElement>(null);
  const redemptionTriggerRef = useRef<HTMLButtonElement>(null);
  const planTriggerRef = useRef<HTMLButtonElement | null>(null);
  const automaticPayment = useRef(false);
  const submittedPayment = useRef(false);
  const live = useRef(true);
  const operation = useRef(false);
  const generation = useRef(0);
  const frameName = `wallet-payment-${useId().replace(/:/g, "")}`;
  const numericAmount = Number(amount);
  const validAmount =
    Number.isSafeInteger(numericAmount) &&
    numericAmount >= (data?.topup.minAmount ?? 1) &&
    (data?.quotaDisplayType !== "TOKENS" ||
      numericAmount % data.quotaPerUnit === 0);
  const currentOrder = data?.history.find(
    (order) => order.tradeNo === payment?.tradeNo,
  );
  const canResumePayment =
    !!payment &&
    paymentClient === client &&
    (!currentOrder || currentOrder.status === "pending");
  const pendingOrders =
    data?.history.filter((order) => order.status === "pending").length || 0;

  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    const current = ++generation.current;
    operation.current = false;
    setBusy(false);
    const cached = cachedWalletOverview(client, userId);
    setData(cached);
    setLoading(!cached);
    setError("");
    setPayment(undefined);
    setCheckout(false);
    setCreatingPayment(false);
    setRedirecting(false);
    submittedPayment.current = false;
    automaticPayment.current = false;
    setPreviewPaid(false);
    setRedemptionOpen(false);
    const changed = () => {
      generation.current++;
      operation.current = false;
      setBusy(false);
      automaticPayment.current = false;
      setCreatingPayment(false);
      setRedirecting(false);
      submittedPayment.current = false;
      controller.abort();
      setData(undefined);
      setPayment(undefined);
      setQuote(undefined);
      setCheckout(false);
      setError("账号或密钥已变更，请重新打开充值页面。");
      setLoading(false);
    };
    if (!previewClient)
      window.addEventListener("new-api-session-changed", changed);
    void readWalletOverview(client, userId, revision > 0)
      .then((value) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setData(value);
        setAmount(
          (previous) =>
            previous ||
            String(value.topup.amountOptions[0] || value.topup.minAmount),
        );
        setMethod((previous) =>
          value.topup.paymentMethods.some((item) => item.type === previous)
            ? previous
            : value.topup.paymentMethods[0]?.type || "",
        );
      })
      .catch((err) => {
        if (!controller.signal.aborted && current === generation.current)
          setError(
            err instanceof Error ? err.message : "暂时无法读取钱包，请重试。",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted && current === generation.current)
          setLoading(false);
      });
    return () => {
      live.current = false;
      automaticPayment.current = false;
      controller.abort();
      window.removeEventListener("new-api-session-changed", changed);
    };
  }, [userId, revision, client, previewClient]);

  useEffect(() => {
    const cached = cachedWalletQuote(client, userId, numericAmount);
    setQuote(cached);
    setQuoteError("");
    if (!data?.topup.enabled || !validAmount) return;
    if (cached) return;
    let active = true;
    const current = generation.current;
    const timer = setTimeout(
      () => {
        void readWalletQuote(client, userId, numericAmount)
          .then((value) => {
            if (active && current === generation.current) setQuote(value);
          })
          .catch((err) => {
            if (active && current === generation.current)
              setQuoteError(
                err instanceof Error
                  ? err.message
                  : "无法获取支付报价，请重试。",
              );
          });
      },
      data.topup.amountOptions.includes(numericAmount) ? 0 : 250,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [numericAmount, validAmount, data, userId, client]);

  const refresh = useCallback(async () => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setNotice("");
    setError("");
    const current = generation.current;
    try {
      const latest = await readWalletOverview(client, userId, true);
      if (!live.current || current !== generation.current) return;
      setData(latest);
      await onRefreshBalance();
      if (!live.current || current !== generation.current) return;
      const paid =
        payment?.kind === "topup" &&
        latest.history.some(
          (order) =>
            order.tradeNo === payment.tradeNo && order.status === "success",
        );
      setNotice(
        paid
          ? "充值已到账，账户余额已更新。"
          : "余额与订单状态已刷新。付款后到账可能需要片刻，请以实际余额为准。",
      );
    } catch (err) {
      if (live.current && current === generation.current)
        setError(err instanceof Error ? err.message : "刷新失败，请重试。");
    } finally {
      operation.current = false;
      if (live.current) setBusy(false);
    }
  }, [userId, payment, onRefreshBalance, client]);

  async function pay(plan?: WalletPlan) {
    if (
      operation.current ||
      !data ||
      !method ||
      (!plan && (!validAmount || quote?.amount !== numericAmount))
    )
      return;
    operation.current = true;
    setCreatingPayment(true);
    setRedirecting(false);
    submittedPayment.current = false;
    setPayment(undefined);
    automaticPayment.current = false;
    setBusy(true);
    setError("");
    setNotice("");
    const current = generation.current;
    try {
      const result = plan
        ? await client.walletSubscriptionPay(plan.id, method, userId, {
            amount: plan.priceAmount,
            currency: plan.currency,
          })
        : await client.walletPay(numericAmount, method, userId);
      if (!live.current || current !== generation.current) return;
      if (result.userId !== userId || !safeWalletPaymentUrl(result.action))
        throw new Error("支付信息无效，请刷新后重试。");
      if (
        !plan &&
        !previewClient &&
        Number(result.money) !== Number(quote?.money)
      ) {
        setNotice(
          `支付报价已变化，当前实付 ${result.money}，请确认后继续支付。`,
        );
      } else {
        automaticPayment.current = !previewClient;
      }
      setPayment(result);
      setPaymentClient(client);
      setPreviewPaid(false);
      setSelectedPlan(undefined);
      setCheckout(true);
    } catch (err) {
      if (live.current && current === generation.current) {
        automaticPayment.current = false;
        setError(
          err instanceof Error ? err.message : "创建支付订单失败，请重试。",
        );
      }
    } finally {
      if (live.current && current === generation.current) {
        operation.current = false;
        setBusy(false);
        setCreatingPayment(false);
      }
    }
  }

  const continuePayment = useCallback(() => {
    if (
      previewClient ||
      paymentClient !== client ||
      !payment ||
      !formRef.current ||
      submittedPayment.current
    )
      return;
    submittedPayment.current = true;
    setRedirecting(true);
    try {
      formRef.current.submit();
    } catch {
      submittedPayment.current = false;
      setRedirecting(false);
      setError("无法打开支付页，请点击继续支付重试。");
    }
  }, [previewClient, paymentClient, client, payment]);

  useEffect(() => {
    if (
      previewClient ||
      creatingPayment ||
      paymentClient !== client ||
      !checkout ||
      !payment ||
      !formRef.current
    )
      return;
    if (automaticPayment.current) {
      automaticPayment.current = false;
      continuePayment();
    }
  }, [
    previewClient,
    paymentClient,
    client,
    checkout,
    payment,
    creatingPayment,
    continuePayment,
  ]);

  async function redeem() {
    if (operation.current || !code.trim()) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const current = generation.current;
    try {
      await client.walletRedeem(code.trim(), userId);
      if (!live.current || current !== generation.current) return;
      setCode("");
      await onRefreshBalance();
      if (!live.current || current !== generation.current) return;
      setNotice("兑换成功，账户余额已更新。");
      setRevision((value) => value + 1);
      redemptionTriggerRef.current?.focus();
    } catch (err) {
      if (live.current && current === generation.current)
        setError(
          err instanceof Error ? err.message : "兑换失败，请检查兑换码。",
        );
    } finally {
      operation.current = false;
      if (live.current) setBusy(false);
    }
  }

  async function completePreviewPayment() {
    if (!previewClient || !payment || busy) return;
    setBusy(true);
    try {
      await previewClient.completePayment(payment.tradeNo);
      if (!live.current) return;
      setPreviewPaid(true);
      await refresh();
    } catch (caught) {
      if (live.current)
        setError(caught instanceof Error ? caught.message : "模拟支付失败");
    } finally {
      if (live.current) setBusy(false);
    }
  }

  const quota = (value: number) =>
    `${data?.currencySymbol || ""}${new Intl.NumberFormat("zh-CN", {
      maximumFractionDigits: 4,
    }).format(
      data?.quotaDisplayType === "TOKENS"
        ? value
        : (value / (data?.quotaPerUnit || 500000)) *
            (data?.creditExchangeRate || 1),
    )}`;
  const refreshPaymentAction = (
    <button
      type="button"
      className={styles.primary}
      disabled={busy}
      onClick={() => void refresh()}
    >
      我已支付，刷新余额
    </button>
  );
  return (
    <section
      className={`${styles.wallet} ${navigation ? styles.embedded : ""}`}
      data-testid="account-wallet"
      aria-label="充值与套餐"
    >
      <header className={styles.header}>
        {navigation ?? (
          <div>
            <h2>充值与套餐</h2>
            <p>为当前账户充值，继续创作。</p>
          </div>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy || loading}
          aria-label="刷新余额"
          title="刷新余额"
        >
          <RefreshCw size={16} aria-hidden="true" />
          {!navigation && "刷新余额"}
        </button>
      </header>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
          {!data && (
            <button
              type="button"
              onClick={() => setRevision((value) => value + 1)}
            >
              重新读取
            </button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {loading && (
        <p role="status" className={styles.state}>
          正在读取充值方式与套餐…
        </p>
      )}
      {data &&
      (creatingPayment || (checkout && payment && paymentClient === client)) ? (
        <div className={styles.checkout}>
          <div className={styles.header}>
            <button
              type="button"
              disabled={creatingPayment}
              onClick={() => setCheckout(false)}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              返回充值
            </button>
            <span>
              实付金额{" "}
              <strong>
                {creatingPayment
                  ? selectedPlan
                    ? `${selectedPlan.currency} ${selectedPlan.priceAmount}`
                    : quote?.money
                  : payment?.money}
              </strong>
            </span>
          </div>
          {creatingPayment ? (
            <div className={styles.previewPayment} role="status">
              <LoaderCircle
                size={32}
                className={styles.paymentSpinner}
                aria-hidden="true"
              />
              <h3>正在创建订单，请稍候…</h3>
            </div>
          ) : (
            payment &&
            (previewClient ? (
              <div className={styles.previewPayment}>
                <Wallet size={32} aria-hidden="true" />
                <h3>{previewPaid ? "模拟支付成功" : "模拟收银台"}</h3>
                <strong>{payment.money}</strong>
                <span>{payment.tradeNo}</span>
                <p className={styles.hint}>
                  此订单仅用于界面预览，不会发生真实扣款。
                </p>
                {refreshPaymentAction}
                <button
                  type="button"
                  disabled={busy || previewPaid}
                  onClick={() => void completePreviewPayment()}
                >
                  {previewPaid ? "已完成支付" : "模拟支付成功"}
                </button>
              </div>
            ) : (
              <>
                <form
                  ref={formRef}
                  action={payment.action}
                  method="POST"
                  target="_self"
                  hidden
                >
                  {Object.entries(payment.fields).map(([name, value]) => (
                    <input key={name} type="hidden" name={name} value={value} />
                  ))}
                </form>
                <div className={styles.previewPayment}>
                  <Wallet size={32} aria-hidden="true" />
                  <h3>订单已准备好</h3>
                  <strong>{payment.money}</strong>
                  <span>{payment.tradeNo}</span>
                  {refreshPaymentAction}
                  <button
                    type="button"
                    disabled={redirecting}
                    onClick={continuePayment}
                  >
                    {redirecting ? "正在跳转…" : "继续支付"}
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                  <p className={styles.hint}>订单已创建，正在前往支付页。</p>
                </div>
              </>
            ))
          )}
          {!previewClient && !creatingPayment && (
            <p className={styles.hint}>
              只有后台确认支付成功后，余额才会更新。
            </p>
          )}
        </div>
      ) : (
        data && (
          <>
            <div className={styles.columns}>
              <section
                className={styles.recharge}
                aria-labelledby="wallet-topup-title"
              >
                <header className={styles.sectionHeader}>
                  <h3 id="wallet-topup-title">余额充值</h3>
                  {data.topup.redemptionEnabled && (
                    <button
                      ref={redemptionTriggerRef}
                      type="button"
                      className={styles.quiet}
                      aria-label="使用兑换码"
                      aria-expanded={redemptionOpen}
                      aria-controls={`${frameName}-redeem`}
                      onClick={() => setRedemptionOpen((value) => !value)}
                    >
                      <Ticket size={15} aria-hidden="true" />
                      兑换码
                    </button>
                  )}
                </header>
                {data.topup.redemptionEnabled && (
                  <div
                    id={`${frameName}-redeem`}
                    className={`${styles.reveal} ${
                      redemptionOpen ? styles.expanded : ""
                    }`}
                    aria-hidden={!redemptionOpen}
                    ref={(element) => {
                      element?.toggleAttribute("inert", !redemptionOpen);
                    }}
                  >
                    <div className={styles.revealClip}>
                      <div className={styles.redeem}>
                        <label className={styles.field}>
                          <span className={styles.srOnly}>兑换码</span>
                          <input
                            value={code}
                            onChange={(event) => setCode(event.target.value)}
                            autoComplete="off"
                            placeholder={
                              previewClient
                                ? "模拟兑换码：PREVIEW-50"
                                : "输入兑换码"
                            }
                            disabled={busy}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={busy || !code.trim()}
                          onClick={() => void redeem()}
                        >
                          兑换额度
                        </button>
                        {safeWalletPaymentUrl(data.topup.redemptionUrl) && (
                          <p className={styles.hint}>
                            需要兑换码？{" "}
                            <a
                              data-local-preview-link={
                                previewClient ? "" : undefined
                              }
                              href={data.topup.redemptionUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={
                                previewClient
                                  ? (event) => {
                                      event.preventDefault();
                                      setNotice(
                                        "本地预览兑换码：PREVIEW-50；正式环境将打开后台配置的获取地址。",
                                      );
                                    }
                                  : undefined
                              }
                            >
                              获取兑换码{" "}
                              <ExternalLink size={13} aria-hidden="true" />
                            </a>
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {data.topup.enabled && data.topup.paymentMethods.length ? (
                  <>
                    <div className={styles.amountHeader}>
                      <span>充值金额</span>
                      <label className={styles.customAmount}>
                        <span>自定义</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          aria-label="自定义金额"
                          aria-invalid={!validAmount}
                          min={data.topup.minAmount}
                          step={
                            data.quotaDisplayType === "TOKENS"
                              ? data.quotaPerUnit
                              : 1
                          }
                          value={amount}
                          disabled={busy}
                          onChange={(event) => setAmount(event.target.value)}
                        />
                      </label>
                    </div>
                    <div className={styles.amounts}>
                      {data.topup.amountOptions.map((value) => (
                        <button
                          type="button"
                          key={value}
                          aria-pressed={numericAmount === value}
                          onClick={() => setAmount(String(value))}
                          disabled={busy}
                        >
                          {new Intl.NumberFormat("zh-CN").format(value)}
                          {data.topup.discounts?.[value] && (
                            <small className={styles.discount}>
                              优惠{" "}
                              {Number(
                                (
                                  (1 - data.topup.discounts[value]) *
                                  100
                                ).toFixed(2),
                              )}
                              %
                            </small>
                          )}
                        </button>
                      ))}
                    </div>
                    {!validAmount && (
                      <p className={styles.error}>
                        请输入不小于 {data.topup.minAmount} 的整数金额。
                        {data.quotaDisplayType === "TOKENS" &&
                          `充值数量须为 ${data.quotaPerUnit} tokens 的整数倍。`}
                      </p>
                    )}
                    <fieldset className={styles.methods}>
                      <legend>支付方式</legend>
                      <div>
                        {data.topup.paymentMethods.map((item) => (
                          <label key={item.type}>
                            <input
                              type="radio"
                              name={`${frameName}-method`}
                              checked={method === item.type}
                              onChange={() => setMethod(item.type)}
                              disabled={busy}
                            />
                            {item.name}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className={styles.settlement}>
                      <div
                        className={styles.total}
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        <div className={styles.totalLabel}>
                          <span>实付金额</span>
                          {data.topup.discounts?.[numericAmount] && (
                            <small className={styles.discount}>
                              已享优惠{" "}
                              {Number(
                                (
                                  (1 - data.topup.discounts[numericAmount]) *
                                  100
                                ).toFixed(2),
                              )}
                              %
                            </small>
                          )}
                        </div>
                        <div className={styles.totalValues}>
                          <strong>
                            {quote?.amount === numericAmount
                              ? quote.money
                              : quoteError
                              ? "暂不可用"
                              : validAmount
                              ? "计算中…"
                              : "—"}
                          </strong>
                          {validAmount && (
                            <small aria-label="预计到账额度">
                              到账{" "}
                              {quota(
                                data.quotaDisplayType === "TOKENS"
                                  ? numericAmount
                                  : numericAmount * data.quotaPerUnit,
                              )}
                            </small>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={styles.primary}
                        aria-label="确认金额，去支付"
                        disabled={
                          busy ||
                          !validAmount ||
                          quote?.amount !== numericAmount ||
                          !method
                        }
                        onClick={() => void pay()}
                      >
                        {busy ? "正在处理…" : "去支付"}
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </button>
                    </div>
                    {quoteError && (
                      <p role="alert" className={styles.error}>
                        {quoteError}
                        <button
                          type="button"
                          onClick={() => setRevision((value) => value + 1)}
                        >
                          重新报价
                        </button>
                      </p>
                    )}
                  </>
                ) : (
                  <p className={styles.state}>当前暂无可用的在线充值方式。</p>
                )}
                {pendingOrders > 0 && (
                  <button
                    type="button"
                    className={styles.pendingLink}
                    onClick={() =>
                      historyRef.current?.scrollIntoView({
                        block: "nearest",
                        behavior: prefersReducedMotion() ? "auto" : "smooth",
                      })
                    }
                  >
                    <Clock3 size={13} aria-hidden="true" />
                    {pendingOrders} 笔待支付订单
                    <ArrowDown size={13} aria-hidden="true" />
                  </button>
                )}
                {canResumePayment && !currentOrder && (
                  <button type="button" onClick={() => setCheckout(true)}>
                    继续支付当前订单
                  </button>
                )}
              </section>
              <section
                className={styles.plans}
                aria-labelledby="wallet-plans-title"
              >
                <header className={styles.sectionHeader}>
                  <h3 id="wallet-plans-title">订阅套餐</h3>
                  {data.plans.length > 0 && (
                    <small>{data.plans.length} 种可选</small>
                  )}
                </header>
                {data.subscriptions.length > 0 && (
                  <details className={styles.subscriptions}>
                    <summary>
                      我的订阅 ·{" "}
                      {
                        data.subscriptions.filter(
                          (item) =>
                            item.status === "active" &&
                            item.endTime * 1000 > Date.now(),
                        ).length
                      }{" "}
                      个生效中
                    </summary>
                    {data.subscriptions.map((item) => (
                      <div key={item.id}>
                        <strong>
                          {data.plans.find((plan) => plan.id === item.planId)
                            ?.title || `订阅 #${item.id}`}
                        </strong>
                        <span>
                          {item.status === "active" &&
                          item.endTime * 1000 > Date.now()
                            ? "生效中"
                            : "已失效"}{" "}
                          ·{" "}
                          {item.endTime > 0
                            ? new Date(item.endTime * 1000).toLocaleDateString()
                            : "—"}
                        </span>
                        <span>
                          已用 {quota(item.amountUsed)} / 总额度{" "}
                          {quota(item.amountTotal)}
                        </span>
                      </div>
                    ))}
                  </details>
                )}
                {data.plans.length ? (
                  data.plans.map((plan) => {
                    const limitReached =
                      plan.maxPurchases > 0 &&
                      data.subscriptions.filter(
                        (item) => item.planId === plan.id,
                      ).length >= plan.maxPurchases;
                    return (
                      <article key={plan.id} className={styles.plan}>
                        <div className={styles.planDetails}>
                          <h4>{plan.title}</h4>
                          {plan.subtitle && (
                            <p className={styles.hint}>{plan.subtitle}</p>
                          )}
                          <dl className={styles.planFacts}>
                            <div>
                              <dt>额度</dt>
                              <dd>{quota(plan.totalAmount)}</dd>
                            </div>
                            <div>
                              <dt>有效期</dt>
                              <dd>{duration(plan)}</dd>
                            </div>
                          </dl>
                          <p className={styles.planTerms}>
                            <span>
                              {(
                                {
                                  never: "额度不重置",
                                  daily: "每日重置",
                                  weekly: "每周重置",
                                  monthly: "每月重置",
                                  custom: `每 ${plan.resetSeconds / 3600} 小时`,
                                } as Record<string, string>
                              )[plan.resetPeriod] ||
                                `额度重置 ${plan.resetPeriod}`}
                              {plan.resetPeriod === "custom" && "重置"}
                            </span>
                            {plan.maxPurchases > 0 && (
                              <span>限购 {plan.maxPurchases} 次</span>
                            )}
                          </p>
                        </div>
                        <div className={styles.planAction}>
                          <p className={styles.planPrice}>
                            {plan.currency}{" "}
                            {new Intl.NumberFormat("zh-CN", {
                              maximumFractionDigits: 2,
                            }).format(plan.priceAmount)}
                          </p>
                          <button
                            type="button"
                            className={styles.secondary}
                            aria-label={`${
                              limitReached ? "已达购买上限" : "选择此套餐"
                            }：${plan.title}`}
                            disabled={
                              busy ||
                              limitReached ||
                              !data.topup.enabled ||
                              !method
                            }
                            onClick={(event) => {
                              planTriggerRef.current = event.currentTarget;
                              setSelectedPlan(plan);
                            }}
                          >
                            {limitReached ? "已达购买上限" : "选择"}
                            {!limitReached && (
                              <ChevronRight size={14} aria-hidden="true" />
                            )}
                          </button>
                        </div>
                        <div
                          className={`${styles.planConfirm} ${styles.reveal} ${
                            selectedPlan?.id === plan.id ? styles.expanded : ""
                          }`}
                          aria-hidden={selectedPlan?.id !== plan.id}
                          ref={(element) => {
                            element?.toggleAttribute(
                              "inert",
                              selectedPlan?.id !== plan.id,
                            );
                          }}
                        >
                          <div className={styles.revealClip}>
                            <p>
                              确认购买 {plan.title}，按 {plan.currency}{" "}
                              {plan.priceAmount} 创建支付订单。
                            </p>
                            <button
                              type="button"
                              className={styles.primary}
                              disabled={busy}
                              onClick={() => void pay(plan)}
                            >
                              确认套餐，去支付
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setSelectedPlan(undefined);
                                planTriggerRef.current?.focus();
                              }}
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <p className={styles.state}>
                    暂无可购买的套餐，可先使用余额充值。
                  </p>
                )}
              </section>
            </div>
            <section
              ref={historyRef}
              className={styles.history}
              aria-labelledby="wallet-history-title"
            >
              <header className={styles.sectionHeader}>
                <div className={styles.historyHeading}>
                  <h3 id="wallet-history-title">充值记录</h3>
                  {data.historyTotal > 0 && (
                    <small>
                      {data.historyTotal} 笔
                      {pendingOrders > 0 && ` · ${pendingOrders} 笔待支付`}
                    </small>
                  )}
                </div>
                <button
                  type="button"
                  className={styles.iconButton}
                  disabled={busy}
                  aria-label="刷新充值记录"
                  title="刷新充值记录"
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                </button>
              </header>
              {data.history.length ? (
                <table className={styles.orderTable}>
                  <thead>
                    <tr>
                      <th scope="col">时间 / 订单号</th>
                      <th scope="col">充值金额</th>
                      <th scope="col">状态</th>
                      <th scope="col">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((order) => (
                      <tr key={order.id}>
                        <td>
                          <OrderTime value={order.createdAt} />
                          <small className={styles.orderNumber}>
                            {order.tradeNo}
                          </small>
                        </td>
                        <td>
                          {new Intl.NumberFormat("zh-CN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 4,
                          }).format(order.money)}
                        </td>
                        <td>
                          <span className={styles.orderStatus}>
                            {order.status === "pending" && (
                              <Clock3 size={13} aria-hidden="true" />
                            )}
                            {(
                              {
                                success: "已到账",
                                pending: "待支付",
                                expired: "已过期",
                                failed: "未完成",
                              } as Record<string, string>
                            )[order.status] || order.status}
                          </span>
                        </td>
                        <td>
                          {canResumePayment &&
                          order.tradeNo === payment?.tradeNo ? (
                            <button
                              type="button"
                              onClick={() => setCheckout(true)}
                            >
                              继续支付
                              <ArrowUpRight size={13} aria-hidden="true" />
                            </button>
                          ) : (
                            <span className={styles.hint}>
                              {order.status === "success" ? "已完成" : "—"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className={styles.hint}>暂无充值记录。</p>
              )}
            </section>
          </>
        )
      )}
    </section>
  );
}
