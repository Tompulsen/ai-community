"use client";

import styles from "./skeleton.module.scss";

export function SkeletonChat() {
  return (
    <div className={styles["skeleton-chat"]}>
      <div className={styles["skeleton-message"]}>
        <div className={styles["skeleton-avatar"]} />
        <div className={styles["skeleton-content"]}>
          <div className={styles["skeleton-line"]} style={{ width: "60%" }} />
          <div className={styles["skeleton-line"]} style={{ width: "80%" }} />
          <div className={styles["skeleton-line"]} style={{ width: "40%" }} />
        </div>
      </div>
      <div
        className={`${styles["skeleton-message"]} ${styles["skeleton-message-right"]}`}
      >
        <div className={styles["skeleton-content"]}>
          <div className={styles["skeleton-line"]} style={{ width: "50%" }} />
        </div>
        <div className={styles["skeleton-avatar"]} />
      </div>
      <div className={styles["skeleton-message"]}>
        <div className={styles["skeleton-avatar"]} />
        <div className={styles["skeleton-content"]}>
          <div className={styles["skeleton-line"]} style={{ width: "70%" }} />
          <div className={styles["skeleton-line"]} style={{ width: "90%" }} />
        </div>
      </div>
    </div>
  );
}

export function SkeletonSettings() {
  return (
    <div className={styles["skeleton-settings"]}>
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className={styles["skeleton-setting-item"]}>
          <div className={styles["skeleton-label"]} />
          <div className={styles["skeleton-input"]} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonSidebar() {
  return (
    <div className={styles["skeleton-sidebar"]}>
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className={styles["skeleton-sidebar-item"]}>
          <div className={styles["skeleton-sidebar-icon"]} />
          <div className={styles["skeleton-sidebar-text"]} />
        </div>
      ))}
    </div>
  );
}
