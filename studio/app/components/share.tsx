"use client";

import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import styles from "./share.module.scss";
import {
  WebRTCReceiver,
  type SharePayload,
  type TransferState,
} from "../utils/webrtc-share";
import dynamic from "next/dynamic";
import LoadingIcon from "../icons/three-dots.svg";
import OctopusIcon from "../icons/octopus-icon";
import clsx from "clsx";

const Markdown = dynamic(async () => (await import("./markdown")).Markdown, {
  loading: () => <LoadingIcon />,
  ssr: false,
});

export function SharePage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const room = params.get("p") ?? "";
  const receiverRef = useRef<WebRTCReceiver | null>(null);

  const [state, setState] = useState<TransferState>("idle");
  const [progress, setProgress] = useState(0);
  const [detail, setDetail] = useState("");
  const [payload, setPayload] = useState<SharePayload | null>(null);

  useEffect(() => {
    if (!room) {
      setState("error");
      setDetail("缺少房间码，请检查分享链接是否完整");
      return;
    }

    const receiver = new WebRTCReceiver(room);
    receiverRef.current = receiver;

    receiver
      .connect(
        (s, p, d) => {
          setState(s);
          setProgress(p);
          setDetail(d ?? "");
        },
        (data) => {
          setPayload(data);
        },
      )
      .catch((e) => {
        setState("error");
        setDetail(e?.message ?? "连接失败");
      });

    // 页面关闭时清理
    const handleUnload = () => {
      receiver.cancel();
    };
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      receiver.cancel();
    };
  }, [room]);

  const stateLabel: Record<TransferState, string> = {
    idle: "等待中",
    creating: "创建连接",
    waiting: "等待分享方",
    connecting: "连接中",
    transferring: "传输中",
    completed: "已完成",
    error: "连接错误",
    disconnected: "已断开",
  };

  const dotClass = clsx(styles["status-dot"], {
    [styles.active]:
      state === "connecting" || state === "transferring" || state === "waiting",
    [styles.error]: state === "error",
    [styles.done]: state === "completed",
  });

  return (
    <div className={styles["share-page"]}>
      <div className={styles["share-header"]}>
        <div className={styles["share-brand"]}>
          <OctopusIcon width={28} height={28} />
          <span className={styles["share-title"]}>章鱼公益平台 · 分享对话</span>
        </div>
        <div className={styles["share-status"]}>
          <span className={dotClass} />
          <span>{stateLabel[state]}</span>
        </div>
      </div>

      <div className={styles["share-body"]}>
        {!payload && state !== "error" && (
          <div className={styles["share-loading"]}>
            <div className={styles["loading-icon"]} />
            <div className={styles["loading-text"]}>{stateLabel[state]}</div>
            {detail && <div className={styles["loading-detail"]}>{detail}</div>}
            {progress > 0 && (
              <div className={styles["progress-bar"]}>
                <div
                  className={styles["progress-fill"]}
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            )}
          </div>
        )}

        {state === "error" && (
          <div className={styles["share-error"]}>
            <div className={styles["error-icon"]}>⚠</div>
            <div className={styles["error-text"]}>无法接收分享</div>
            <div className={styles["error-detail"]}>{detail}</div>
          </div>
        )}

        {payload && (
          <div className={styles["share-content"]}>
            <div className={styles["share-topic"]}>{payload.topic}</div>
            {payload.messages.map((msg, i) => (
              <div
                key={i}
                className={clsx(
                  styles["share-message"],
                  msg.role === "user" && styles["message-user"],
                )}
              >
                <div
                  className={clsx(
                    styles["share-avatar"],
                    msg.role === "user" ? styles["user"] : styles["assistant"],
                  )}
                >
                  {msg.role === "user" ? "我" : "AI"}
                </div>
                <div className={styles["share-message-body"]}>
                  <div className={styles["share-message-role"]}>
                    {msg.role === "user" ? "用户" : "助手"}
                  </div>
                  <div className={styles["share-message-content"]}>
                    <Markdown content={msg.content} defaultShow />
                    {msg.images?.map((src, j) => (
                      // eslint-disable-next-line @next/next/no-img-element -- Shared data URLs have no dimension metadata; native sizing preserves the transferred layout.
                      <img key={j} src={src} alt={`图片 ${j + 1}`} />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles["share-footer"]}>
        分享链接仅在分享方页面打开时有效 · 关闭后链接自动失效
      </div>
    </div>
  );
}
