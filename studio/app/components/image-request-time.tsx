import styles from "./message-ui.module.scss";

export function ImageRequestTime({ durationMs }: { durationMs?: number }) {
  if (
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  )
    return null;
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return (
    <span className={styles["image-request-time"]}>
      请求耗时 {minutes}:{remainder}
    </span>
  );
}
