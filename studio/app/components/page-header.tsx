"use client";

import React, { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { useMobileScreen } from "../utils";
import styles from "./page-header.module.scss";
import clsx from "clsx";
import { Bell, Maximize, Minimize } from "lucide-react";
import { ChatAction } from "./chat-action";
import { triggerAnnouncement } from "./announcement";
import { useAppConfig } from "../store/config";
import chatStyles from "./chat.module.scss";
import Locale from "../locales";

// ─── 返回箭头 SVG ──────────────────────────────────────────────────

function BackArrow({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

// ─── 关闭 X SVG ────────────────────────────────────────────────────

function CloseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ─── PageHeader Props ──────────────────────────────────────────────

interface PageHeaderProps {
  /** 标题文字 */
  title: string;
  /** 标题前缀图标 (emoji 或 SVG) */
  icon?: React.ReactNode;
  /** 右侧自定义操作区 */
  actions?: React.ReactNode;
  /** 返回行为: "back" 显示返回箭头, "close" 显示关闭X, undefined 不显示 */
  backType?: "back" | "close";
  /** 返回目标路径, 默认回首页 */
  backPath?: string;
  /** 额外 className */
  className?: string;
}

// ─── PageHeader 组件 ───────────────────────────────────────────────

export function PageHeader({
  title,
  icon,
  actions,
  backType = "back",
  backPath,
  className,
}: PageHeaderProps) {
  const navigate = useNavigate();
  const isMobile = useMobileScreen();
  const config = useAppConfig();
  const [actionsTarget, setActionsTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setActionsTarget(
      document.querySelector<HTMLElement>("[data-workspace-chat-actions]"),
    );
  }, []);
  const toolbarClass = clsx(
    "window-actions",
    chatStyles["chat-input-actions"],
    chatStyles["composer-toolbar"],
    chatStyles["chat-header-actions"],
  );

  const handleBack = () => {
    if (backPath) {
      navigate(backPath);
    } else {
      navigate(Path.Home);
    }
  };

  const headerActions = (
    <div className={clsx(toolbarClass, styles["header-actions"])}>
      {actions}
      <ChatAction
        text={Locale.Chat.Actions.Announcement}
        icon={<Bell aria-hidden="true" />}
        onClick={triggerAnnouncement}
      />
      {!isMobile && (
        <ChatAction
          text={
            config.tightBorder
              ? Locale.Chat.Actions.ExitFullScreen
              : Locale.Chat.Actions.FullScreen
          }
          icon={
            config.tightBorder ? (
              <Minimize aria-hidden="true" />
            ) : (
              <Maximize aria-hidden="true" />
            )
          }
          onClick={() =>
            config.update((state) => (state.tightBorder = !state.tightBorder))
          }
        />
      )}
    </div>
  );

  return (
    <div className={clsx("window-header", styles["page-header"], className)}>
      {/* 左侧: 返回/关闭按钮 */}
      {isMobile && backType && (
        <div className={toolbarClass}>
          <ChatAction
            text={backType === "back" ? Locale.NewChat.Return : Locale.UI.Close}
            icon={backType === "back" ? <BackArrow /> : <CloseIcon />}
            onClick={handleBack}
          />
        </div>
      )}

      {/* 中间: 图标 + 标题 */}
      <div className={styles["header-title"]}>
        {icon && <span className={styles["header-icon"]}>{icon}</span>}
        <span>{title}</span>
      </div>

      {/* 右侧: 自定义操作 */}
      {actionsTarget && !isMobile
        ? createPortal(headerActions, actionsTarget)
        : headerActions}
    </div>
  );
}

// ─── EmptyState 共享空状态组件 ─────────────────────────────────────

interface EmptyStateProps {
  icon?: React.ReactNode;
  text: string;
  action?: React.ReactNode;
  variant?: "plain";
  className?: string;
}

export function EmptyState({
  icon,
  text,
  action,
  variant,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={clsx(styles["empty-state"], className, {
        [styles["empty-state-plain"]]: variant === "plain",
      })}
    >
      {icon && (
        <div className={styles["empty-icon"]} aria-hidden="true">
          {icon}
        </div>
      )}
      <div className={styles["empty-text"]}>{text}</div>
      {action && <div className={styles["empty-action"]}>{action}</div>}
    </div>
  );
}

// ─── LoadingState 共享加载状态 ─────────────────────────────────────

interface LoadingStateProps {
  text?: string;
  className?: string;
}

export function LoadingState({
  text = Locale.UI.Loading,
  className,
}: LoadingStateProps) {
  return (
    <div className={clsx(styles["loading-state"], className)}>
      <div className={styles["loading-spinner"]} />
      <div className={styles["loading-text"]}>{text}</div>
    </div>
  );
}
