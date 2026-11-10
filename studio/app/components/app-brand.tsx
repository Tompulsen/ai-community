import clsx from "clsx";

import OctopusIcon from "../icons/octopus-icon";
import styles from "./app-brand.module.scss";

export function AppBrand(props: { className?: string; compact?: boolean }) {
  const size = props.compact ? 24 : 28;

  return (
    <div
      className={clsx(
        styles.brand,
        { [styles.compact]: props.compact },
        props.className,
      )}
      data-tauri-drag-region
    >
      <span className={clsx(styles.logo, "no-dark")} aria-hidden="true">
        <OctopusIcon width={size} height={size} />
      </span>
      <span className={styles.name}>章鱼公益平台</span>
    </div>
  );
}
