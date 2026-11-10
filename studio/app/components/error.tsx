"use client";

import React from "react";
import { IconButton } from "./button";
import GithubIcon from "../icons/github.svg";
import ResetIcon from "../icons/reload.svg";
import { ISSUE_URL } from "../constant";
import Locale from "../locales";
import { showConfirm } from "./ui-lib";
import { useChatStore } from "../store/chat";

interface IErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  info: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<any, IErrorBoundaryState> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ hasError: true, error, info });
  }

  clearAndSaveData() {
    try {
      useChatStore.getState().clearAllData();
    } catch (e) {
      console.error("[ErrorBoundary] Failed to clear data:", e);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="error"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 12,
          }}
        >
          {/* 友好的错误图标 */}
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(255, 59, 48, 0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              marginBottom: 4,
            }}
          >
            ⚠️
          </div>

          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            {Locale.Error.Title}
          </h2>

          <p
            style={{
              color: "var(--second-in-gray)",
              marginBottom: 8,
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {Locale.Error.Description}
          </p>

          {/* 简洁的错误信息 */}
          <pre
            style={{
              background: "rgba(0, 0, 0, 0.03)",
              padding: "12px 16px",
              borderRadius: "var(--radius-md, 16px)",
              fontSize: 12,
              overflow: "auto",
              maxHeight: "160px",
              width: "100%",
              textAlign: "left",
              color: "var(--second-in-gray)",
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              border: "1px solid transparent",
            }}
          >
            <code>{this.state.error?.toString()}</code>
          </pre>

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 12,
              marginTop: 8,
              width: "100%",
            }}
          >
            <a href={ISSUE_URL} className="report">
              <IconButton
                text={Locale.Error.Report}
                icon={<GithubIcon />}
                bordered
              />
            </a>
            <IconButton
              icon={<ResetIcon />}
              text={Locale.Error.ClearData}
              onClick={async () => {
                if (await showConfirm(Locale.Error.ClearConfirm)) {
                  this.clearAndSaveData();
                }
              }}
              bordered
            />
          </div>

          {/* 刷新提示 */}
          <p style={{ color: "#86868b", fontSize: 12, marginTop: 8 }}>
            尝试刷新页面，大多数问题可以通过刷新解决
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
