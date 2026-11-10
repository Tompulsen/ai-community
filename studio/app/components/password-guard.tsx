import React, { useState, useEffect, useRef } from "react";
import styles from "./password-guard.module.scss";
import OctopusIcon from "../icons/octopus-icon";
import { safeLocalStorage } from "@/app/utils";
import { refetchModels } from "@/app/store/access";

const storage = safeLocalStorage();
const STORAGE_KEY = "site_access_token";

// 全局事件：当任何 API 返回 401 时触发，通知 password-guard 显示密码页
export const TOKEN_INVALID_EVENT = "token-invalid";

/** 通知全局 token 已失效 */
export function notifyTokenInvalid() {
  storage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(TOKEN_INVALID_EVENT));
}

export function PasswordGuard(props: { children: React.ReactNode }) {
  const [verified, setVerified] = useState<boolean | null>(null);
  const [showPage, setShowPage] = useState(false);

  useEffect(() => {
    let cancel = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const verify = async () => {
      const token = storage.getItem(STORAGE_KEY);
      if (!token) {
        // 无 token，检查是否需要密码
        try {
          const res = await fetch("/studio/api/verify-password");
          const data = await res.json();
          if (!data.enabled) {
            if (!cancel) setVerified(true);
            return;
          }
        } catch {
          // 验证接口不可用，放行（降级策略，不阻塞用户）
          if (!cancel) setVerified(true);
          return;
        }
        if (!cancel) {
          setShowPage(true);
          setVerified(false);
        }
        return;
      }

      // 有 token，用轻量级端点验证
      try {
        const res = await fetch("/studio/api/verify-token", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          if (!cancel) setVerified(true);
          return;
        }
        // 401 = token 已失效（密码被更改等）
      } catch {
        // 网络错误，保持当前状态（不踢出用户）
        return;
      }
      // token 无效，清除后走密码输入
      storage.removeItem(STORAGE_KEY);
      if (!cancel) {
        setShowPage(true);
        setVerified(false);
      }
    };

    verify();

    // 每 3 分钟重新验证一次（密码可能被更改）
    interval = setInterval(verify, 3 * 60 * 1000);

    // 监听全局 401 事件 —— 任何 API 返回 401 时立即弹出密码页
    const onTokenInvalid = () => {
      if (!cancel) {
        setShowPage(true);
        setVerified(false);
      }
    };
    window.addEventListener(TOKEN_INVALID_EVENT, onTokenInvalid);

    return () => {
      cancel = true;
      if (interval) clearInterval(interval);
      window.removeEventListener(TOKEN_INVALID_EVENT, onTokenInvalid);
    };
  }, []);

  // 等待访问验证，不显示启动动画，也不提前展示受保护的聊天记录。
  if (verified === null) {
    return null;
  }

  if (verified) return <>{props.children}</>;

  if (showPage) {
    return (
      <PasswordPage
        onVerified={() => {
          setVerified(true);
          // 密码验证成功后，重新获取模型列表
          refetchModels();
        }}
      />
    );
  }

  return <>{props.children}</>;
}

function PasswordPage(props: { onVerified: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleVerify = async () => {
    if (!password.trim()) {
      setError("请输入密码");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/studio/api/verify-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.ok && data.token) {
        storage.setItem(STORAGE_KEY, data.token);
        props.onVerified();
      } else {
        setError(data.msg || "密码错误");
      }
    } catch {
      setError("网络错误，请重试");
    }
    setLoading(false);
  };

  return (
    <div className={styles["guard-page"]}>
      <div className={styles["guard-body"]}>
        <div className={styles["guard-card"]}>
          <div className={styles["guard-icon"]}>
            <OctopusIcon width={64} height={64} />
          </div>
          <h2 className={styles["guard-title"]}>需要密码</h2>
          <p className={styles["guard-desc"]}>
            管理员开启了密码验证，请在下方填入密码
          </p>

          <div className={styles["guard-input-wrapper"]}>
            <input
              ref={inputRef}
              className={styles["guard-input"]}
              type={showPassword ? "text" : "password"}
              placeholder="请输入访问密码"
              value={password}
              autoComplete="current-password"
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleVerify()}
            />
            <button
              type="button"
              className={styles["guard-toggle"]}
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
            >
              {showPassword ? "🙈" : "👁"}
            </button>
          </div>

          {error && <p className={styles["guard-error"]}>{error}</p>}

          <div className={styles["guard-actions"]}>
            <button
              className={`${styles["guard-btn"]} ${styles["guard-btn-primary"]}`}
              onClick={handleVerify}
              disabled={loading}
            >
              {loading ? "验证中..." : "确认"}
            </button>
            <button
              className={`${styles["guard-btn"]} ${styles["guard-btn-danger"]}`}
              onClick={() => window.open("https://zhangyuapi.com", "_blank")}
            >
              获取密码
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
