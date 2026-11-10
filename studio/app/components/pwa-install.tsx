import { useState, useEffect, type ReactNode } from "react";
import { IconButton } from "./button";
import { useMobileScreen, isIOS } from "../utils";
import styles from "./home.module.scss";
import clsx from "clsx";
import Locale from "../locales";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * PWA 安装按钮
 * - Android/桌面 Chrome：通过 beforeinstallprompt 弹出原生安装提示
 * - iOS Safari：不支持 beforeinstallprompt，显示引导提示
 */
export function PwaInstallButton(props: {
  shouldNarrow?: boolean;
  className?: string;
}) {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const isMobile = useMobileScreen();

  useEffect(() => {
    // 检查是否已安装
    const checkInstalled = () => {
      if (window.matchMedia("(display-mode: standalone)").matches) {
        setIsInstalled(true);
      }
      // iOS Safari
      if ((window.navigator as any).standalone === true) {
        setIsInstalled(true);
      }
    };
    checkInstalled();

    // 监听安装事件
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    // 检查 serviceWorkerRegister.js 是否已经捕获了 prompt
    if ((window as any)._PWA_INSTALL_PROMPT) {
      setDeferredPrompt((window as any)._PWA_INSTALL_PROMPT);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  // iOS 提示自动消失
  useEffect(() => {
    if (!showIOSHint) return;
    const timer = setTimeout(() => setShowIOSHint(false), 5000);
    return () => clearTimeout(timer);
  }, [showIOSHint]);

  // 已安装 → 不显示
  if (isInstalled) return null;

  // Android/桌面 Chrome → 有 deferredPrompt 时显示安装按钮
  if (deferredPrompt) {
    return (
      <div className={clsx(styles["sidebar-action"], props.className)}>
        <IconButton
          icon={<InstallIcon />}
          text={props.shouldNarrow ? undefined : Locale.UI.InstallApp}
          onClick={async () => {
            await deferredPrompt.prompt();
            const choice = await deferredPrompt.userChoice;
            if (choice.outcome === "accepted") {
              setIsInstalled(true);
            }
            setDeferredPrompt(null);
          }}
          shadow
        />
      </div>
    );
  }

  // iOS → 显示引导按钮（点击后提示如何添加到主屏幕）
  if (isIOS() && isMobile) {
    return (
      <>
        <div className={clsx(styles["sidebar-action"], props.className)}>
          <IconButton
            icon={<InstallIcon />}
            text={props.shouldNarrow ? undefined : Locale.UI.InstallApp}
            onClick={() => setShowIOSHint(true)}
            shadow
          />
        </div>
        {showIOSHint && (
          <div
            style={{
              position: "fixed",
              bottom: "80px",
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.85)",
              color: "#fff",
              padding: "12px 20px",
              borderRadius: "8px",
              fontSize: "14px",
              zIndex: 99999,
              maxWidth: "90vw",
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            {Locale.UI.InstallHint}
          </div>
        )}
      </>
    );
  }

  // 其他情况（桌面浏览器未触发 beforeinstallprompt）→ 不显示
  return null;
}

export type PwaInstallAction = {
  icon: JSX.Element;
  text: string;
  onClick: () => void;
};

export function usePwaInstallAction(): {
  action: PwaInstallAction | null;
  hint: ReactNode;
} {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const isMobile = useMobileScreen();

  useEffect(() => {
    const checkInstalled = () => {
      if (window.matchMedia("(display-mode: standalone)").matches) {
        setIsInstalled(true);
      }
      if ((window.navigator as any).standalone === true) {
        setIsInstalled(true);
      }
    };
    checkInstalled();

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    if ((window as any)._PWA_INSTALL_PROMPT) {
      setDeferredPrompt((window as any)._PWA_INSTALL_PROMPT);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (!showIOSHint) return;
    const timer = setTimeout(() => setShowIOSHint(false), 5000);
    return () => clearTimeout(timer);
  }, [showIOSHint]);

  if (isInstalled) return { action: null, hint: null };

  // 有安装提示（Android/桌面 Chrome）
  if (deferredPrompt) {
    return {
      action: {
        icon: <InstallIcon />,
        text: Locale.UI.DownloadApp,
        onClick: async () => {
          await deferredPrompt.prompt();
          const choice = await deferredPrompt.userChoice;
          if (choice.outcome === "accepted") {
            setIsInstalled(true);
          }
          setDeferredPrompt(null);
        },
      },
      hint: null,
    };
  }

  // iOS 移动端
  if (isIOS() && isMobile) {
    return {
      action: {
        icon: <InstallIcon />,
        text: Locale.UI.DownloadApp,
        onClick: () => setShowIOSHint(true),
      },
      hint: showIOSHint ? (
        <div
          style={{
            position: "fixed",
            top: "60px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.85)",
            color: "#fff",
            padding: "12px 20px",
            borderRadius: "8px",
            fontSize: "14px",
            zIndex: 99999,
            maxWidth: "90vw",
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          {Locale.UI.InstallHint}
        </div>
      ) : null,
    };
  }

  return { action: null, hint: null };
}

export function PwaInstallActionButton(props: {
  renderAction: (action: PwaInstallAction) => ReactNode;
}) {
  const { action, hint } = usePwaInstallAction();
  return (
    <>
      {action && props.renderAction(action)}
      {hint}
    </>
  );
}

function InstallIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
