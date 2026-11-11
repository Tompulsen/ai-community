import { useEffect, useState } from "react";
import {
  getAccountReadinessSession,
  getInitialAccountReadinessSession,
  type NewApiSession,
} from "../client/new-api";
import { useAccessStore } from "../store/access";
import { Path } from "../constant";
import { accountPricingPath } from "../utils/account-pricing";
import {
  preloadWorkspaceRoute,
  workspaceRoutePreloadHandlers,
} from "../utils/preload-workspace-routes";
import { ArrowRight, LogIn, KeyRound, Wallet } from "lucide-react";
import styles from "./account-readiness.module.scss";

type ReadinessStep = "login" | "key" | "balance" | null;

function readinessStep(session?: NewApiSession): ReadinessStep {
  return !session
    ? null
    : !session.authenticated
    ? "login"
    : !session.selectedTokenId
    ? "key"
    : session.user!.quota <= 0
    ? "balance"
    : null;
}

export function AccountReadiness({ model = "" }: { model?: string }) {
  const enabled = useAccessStore((state) => state.newApiEnabled);
  const [step, setStep] = useState<ReadinessStep | undefined>(() =>
    enabled ? readinessStep(getInitialAccountReadinessSession()) : undefined,
  );
  const currentStep =
    enabled && step === undefined
      ? readinessStep(getInitialAccountReadinessSession())
      : step;
  useEffect(() => {
    let active = true;
    let request = 0;
    const load = (initial = false, clear = false) => {
      const current = ++request;
      if (clear || !enabled) setStep(enabled ? null : undefined);
      if (!enabled) return;
      if (initial) {
        const initialStep = readinessStep(getInitialAccountReadinessSession());
        setStep((previous) =>
          previous === undefined ? initialStep : previous,
        );
      }
      void getAccountReadinessSession(initial)
        .then((session) => {
          if (!active || current !== request) return;
          setStep(readinessStep(session));
        })
        .catch(() => {
          if (active && current === request) setStep(null);
        });
    };
    load(true);
    const refresh = () => load(false, true);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("new-api-session-changed", refresh);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.removeEventListener("new-api-session-changed", refresh);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
  if (!enabled || !currentStep) return null;
  const states = {
    login: {
      text: "登录账号后开始聊天",
      hint: "登录账号，开始聊天",
      action: "去登录",
      icon: <LogIn size={16} />,
    },
    key: {
      text: "先选择可用密钥；没有密钥时可在账号页创建",
      hint: "选择密钥后开始聊天",
      action: "选择密钥",
      icon: <KeyRound size={16} />,
    },
    balance: {
      text: "账号余额不足，请充值后继续",
      hint: "余额不足，前往充值",
      action: "前往充值",
      icon: <Wallet size={16} />,
    },
  };
  const state = states[currentStep];
  return (
    <div role="status" className={styles.readiness}>
      <button
        type="button"
        className={styles.action}
        title={state.text}
        aria-label={state.action}
        {...workspaceRoutePreloadHandlers(Path.Account)}
        onClick={() => {
          void preloadWorkspaceRoute(Path.Account, "activation");
          location.hash =
            currentStep === "balance"
              ? accountPricingPath(model)
              : `${Path.Account}?view=keys`;
        }}
      >
        <span aria-hidden="true" className={styles.icon}>
          {state.icon}
        </span>
        <span>{state.hint}</span>
        <ArrowRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
