"use client";

import { ArrowRight, Wallet } from "lucide-react";
import { accountPricingPath } from "../utils/account-pricing";
import styles from "./quota-pricing-card.module.scss";

export function QuotaPricingCard({ model }: { model: string }) {
  return (
    <div
      className={styles.notice}
      data-testid="quota-pricing-card"
      role="status"
    >
      <a
        href={`#${accountPricingPath(model)}`}
        data-testid="quota-pricing-link"
      >
        <Wallet size={16} aria-hidden="true" />
        <span>余额不足，前往充值</span>
        <ArrowRight size={16} aria-hidden="true" />
      </a>
      <span className={styles.hint}>
        查看{model ? ` ${model} 的` : "模型"}价格与账户余额
      </span>
    </div>
  );
}
