"use client";

import { ListCollapse, LoaderCircle } from "lucide-react";
import styles from "./context-compression-notice.module.scss";

export function ContextCompressionNotice({
  compressed,
  compressing,
}: {
  compressed?: boolean;
  compressing?: boolean;
}) {
  if (!compressed && !compressing) return null;

  return (
    <div
      className={styles.notice}
      role="status"
      data-context-compressed={(!compressing && compressed) || undefined}
      data-context-compressing={compressing || undefined}
    >
      {compressing ? (
        <LoaderCircle
          className={styles.spinner}
          size={16}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      ) : (
        <ListCollapse size={16} strokeWidth={1.5} aria-hidden="true" />
      )}
      <span>
        {compressing ? "上下文正在压缩 · 可能需要几分钟" : "上下文已自动压缩"}
      </span>
    </div>
  );
}
