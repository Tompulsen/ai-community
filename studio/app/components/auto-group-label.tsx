import Locale from "../locales";
import styles from "./auto-group-label.module.scss";

export function AutoGroupLabel() {
  return (
    <span className={styles.label} title={Locale.Account.SystemDefaultHint}>
      <span>Auto</span>
      <span className={styles.badge}>{Locale.Account.SystemDefault}</span>
    </span>
  );
}
