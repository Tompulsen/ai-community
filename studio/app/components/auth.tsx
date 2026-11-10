import styles from "./auth.module.scss";
import { IconButton } from "./button";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Path } from "../constant";
import Locale from "../locales";
import OctopusIcon from "../icons/octopus-icon";
import { getClientConfig } from "../config/client";
import LeftIcon from "@/app/icons/left.svg";
import clsx from "clsx";

/**
 * 旧版 AuthPage —— 密码验证已由 PasswordGuard 处理，
 * API Key 配置请在设置页面中填写。
 */
export function AuthPage() {
  const navigate = useNavigate();
  const goChat = () => navigate(Path.Chat);

  useEffect(() => {
    if (getClientConfig()?.isApp) {
      navigate(Path.Settings);
    }
  }, [navigate]);

  return (
    <div className={styles["auth-page"]}>
      <div className={styles["auth-header"]}>
        <IconButton
          icon={<LeftIcon />}
          text={Locale.Auth.Return}
          onClick={() => navigate(Path.Home)}
        ></IconButton>
      </div>
      <div className={clsx("no-dark", styles["auth-logo"])}>
        <OctopusIcon width={64} height={64} />
      </div>

      <div className={styles["auth-title"]}>{Locale.Auth.Title}</div>
      <div className={styles["auth-tips"]}>{Locale.Auth.Tips}</div>

      <div className={styles["auth-actions"]}>
        <IconButton
          text={Locale.Auth.Confirm}
          type="primary"
          onClick={goChat}
        />
      </div>
    </div>
  );
}
