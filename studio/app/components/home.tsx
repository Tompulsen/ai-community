"use client";

require("../polyfill");

import { useEffect, useState } from "react";
import styles from "./home.module.scss";
// Load settings styles before its lazy page resolves.
import "./settings.module.scss";
import "./local-data-panel.module.scss";
import "./speech-settings.module.scss";

import OctopusIcon from "../icons/octopus-icon";
import LoadingIcon from "../icons/three-dots.svg";

import { getCSSVar, useMobileScreen } from "../utils";

import dynamic from "next/dynamic";
import { Path } from "../constant";
import { ErrorBoundary } from "./error";

import { getISOLang } from "../locales";

import {
  HashRouter as Router,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { getSideBarWidth, SideBar } from "./sidebar";
import { Chat } from "./chat";
import { DEFAULT_CONFIG, useAppConfig } from "../store/config";
import { AuthPage } from "./auth";
import { getClientConfig } from "../config/client";
import { type ClientApi, getClientApi } from "../client/api";
import { useAccessStore, useChatStore } from "../store";
import {
  refetchModels,
  refreshNewApiModels,
  refreshSelectedNewApiModels,
} from "../store/access";
import {
  NEW_API_CHANNEL,
  NEW_API_TAB_ID,
  type NewApiSelection,
} from "../client/new-api";
import clsx from "clsx";
import { initializeMcpSystem } from "../mcp/actions";
import { isMcpAvailable } from "../mcp/availability";
import { Announcement } from "./announcement";
import { ToastContainer } from "./toast";
import { useNetworkStatus } from "../utils/use-network-status";
import { trackInputModality } from "../utils/input-modality";
import { initializeLocalWorkspace } from "../utils/local-workspace";
import { ChatControllerPool } from "../client/controller";
import { TaskRecovery } from "./task-recovery";
import { WindowContent } from "./window-content";
import { WorkspaceRail, WorkspaceTopbar } from "./workspace-navigation";
import { getMotionPreference } from "../utils/motion";
import { preloadChatRenderers } from "../utils/preload-chat-renderers";
import { scheduleIdleTask } from "../utils/schedule-idle-task";
import { loadBuiltinPrompts, usePromptStore } from "../store/prompt";
import { loadBuiltinMasks } from "../masks";
import {
  startCommunityChat,
  type CommunityEntry,
} from "../utils/community-entry";
import { PreloadedWorkspaceRoute } from "./preloaded-workspace-route";

export { WindowContent } from "./window-content";

export function Loading(props: { noLogo?: boolean }) {
  return (
    <div
      className={clsx("no-dark", styles["loading-content"])}
      role="status"
      aria-label="Loading"
    >
      {!props.noLogo && <OctopusIcon width={48} height={48} />}
      <LoadingIcon />
    </div>
  );
}

const Artifacts = dynamic(async () => (await import("./artifacts")).Artifacts, {
  loading: () => <Loading noLogo />,
  ssr: false,
});

const Settings = dynamic(async () => (await import("./settings")).Settings, {
  loading: () => <Loading noLogo />,
  ssr: false,
});

const AccountPage = dynamic(
  async () => (await import("./account")).AccountPage,
  { loading: () => <Loading noLogo />, ssr: false },
);

const NewChat = dynamic(async () => (await import("./new-chat")).NewChat, {
  loading: () => <Loading noLogo />,
  ssr: false,
});

const MaskPage = dynamic(async () => (await import("./mask")).MaskPage, {
  loading: () => <Loading noLogo />,
  ssr: false,
});

const SearchChat = dynamic(
  async () => (await import("./search-chat")).SearchChatPage,
  { loading: () => <Loading noLogo />, ssr: false },
);

const McpMarketPage = dynamic(
  async () => (await import("./mcp-market")).McpMarketPage,
  { loading: () => <Loading noLogo />, ssr: false },
);

const GalleryPage = dynamic(
  async () => (await import("./gallery/gallery")).GalleryPage,
  { loading: () => <Loading noLogo />, ssr: false },
);

const SkillsMarket = dynamic(
  async () => (await import("./skills-market")).SkillsMarket,
  { loading: () => <Loading noLogo />, ssr: false },
);

const SharePage = dynamic(async () => (await import("./share")).SharePage, {
  loading: () => <Loading noLogo />,
  ssr: false,
});

export function useSwitchTheme() {
  const config = useAppConfig();
  const [themeReady, setThemeReady] = useState(false);
  const motionPreference = getMotionPreference(config);

  useEffect(() => {
    if (!config._hasHydrated) return;

    document.body.dataset.motion = motionPreference;
    document.body.classList.toggle(
      "reduce-motion",
      motionPreference === "reduced",
    );
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

    // 应用颜色主题（移除旧的主题类，添加新的）
    const themePrefix = "theme-";
    const oldThemeClasses = Array.from(document.body.classList).filter((c) =>
      c.startsWith(themePrefix),
    );
    oldThemeClasses.forEach((c) => document.body.classList.remove(c));
    document.body.classList.add(
      `theme-${config.colorTheme || DEFAULT_CONFIG.colorTheme}`,
    );

    const metaDescriptionDark = document.querySelector(
      'meta[name="theme-color"][media*="dark"]',
    );
    const metaDescriptionLight = document.querySelector(
      'meta[name="theme-color"][media*="light"]',
    );

    const applyTheme = () => {
      const dark =
        config.theme === "dark" ||
        (config.theme === "auto" && systemTheme.matches);
      document.body.classList.toggle("dark", dark);
      document.body.classList.toggle("light", !dark);
      document.body.style.colorScheme = dark ? "dark" : "light";
      const themeColor = getCSSVar("--theme-color");
      metaDescriptionDark?.setAttribute("content", themeColor);
      metaDescriptionLight?.setAttribute("content", themeColor);
    };
    applyTheme();
    systemTheme.addEventListener("change", applyTheme);
    setThemeReady(true);
    return () => systemTheme.removeEventListener("change", applyTheme);
  }, [config.theme, config.colorTheme, motionPreference, config._hasHydrated]);

  return themeReady;
}

function useHtmlLang() {
  useEffect(() => {
    const lang = getISOLang();
    const htmlLang = document.documentElement.lang;

    if (lang !== htmlLang) {
      document.documentElement.lang = lang;
    }
  }, []);
}

const useHasHydrated = () => {
  const [hasHydrated, setHasHydrated] = useState<boolean>(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  return hasHydrated;
};

function Screen({ embedded = false }: { embedded?: boolean }) {
  const config = useAppConfig();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (
      location.pathname === Path.NewChat ||
      location.pathname === Path.Masks
    ) {
      void loadBuiltinMasks();
    }
  }, [location.pathname, location.search]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isArtifact = location.pathname.includes(Path.Artifacts);
  const isShare = location.pathname.includes(Path.Share);
  const isHome = location.pathname === Path.Home;
  const isAuth = location.pathname === Path.Auth;
  const isSettings = location.pathname === Path.Settings;

  const isMobileScreen = useMobileScreen();
  const shouldTightBorder =
    getClientConfig()?.isApp || (config.tightBorder && !isMobileScreen);
  const sidebarOpen = isMobileScreen
    ? isHome
    : !sidebarCollapsed && !isSettings;
  const toggleSidebar = () => {
    if (isSettings) {
      setSidebarCollapsed(false);
      navigate(Path.Chat);
    } else if (isMobileScreen) {
      navigate(isHome ? Path.Chat : Path.Home);
    } else {
      setSidebarCollapsed((collapsed) => !collapsed);
    }
  };

  if (isArtifact) {
    return (
      <Routes>
        <Route path="/artifacts/:id" element={<Artifacts />} />
      </Routes>
    );
  }

  if (isShare) {
    return (
      <Routes>
        <Route path="/share" element={<SharePage />} />
      </Routes>
    );
  }
  const renderContent = () => {
    if (isAuth) return <AuthPage />;
    return (
      <>
        <WorkspaceTopbar
          compact={embedded}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
        />
        {!embedded && <WorkspaceRail />}
        <div
          className={clsx(styles["workspace-frame"], {
            [styles["workspace-sidebar-collapsed"]]:
              sidebarCollapsed && !isMobileScreen,
          })}
        >
          {!isSettings && (
            <SideBar
              compact={embedded}
              collapsed={sidebarCollapsed && !isMobileScreen}
              onClose={() => navigate(Path.Chat)}
              className={clsx({
                [styles["sidebar-show"]]: isHome,
              })}
            />
          )}
          <WindowContent>
            <Routes>
              <Route path={Path.Home} element={<Chat embedded={embedded} />} />
              <Route path={Path.NewChat} element={<NewChat />} />
              <Route path={Path.Masks} element={<MaskPage />} />
              <Route path={Path.SearchChat} element={<SearchChat />} />
              <Route path={Path.Chat} element={<Chat embedded={embedded} />} />
              <Route
                path={Path.Settings}
                element={
                  <PreloadedWorkspaceRoute
                    key={Path.Settings}
                    path={Path.Settings}
                    fallback={Settings}
                  />
                }
              />
              <Route
                path={Path.Account}
                element={
                  <PreloadedWorkspaceRoute
                    key={Path.Account}
                    path={Path.Account}
                    fallback={AccountPage}
                  />
                }
              />
              <Route path={Path.McpMarket} element={<McpMarketPage />} />
              <Route path={Path.Pricing} element={<AccountPage />} />
              <Route
                path={Path.Gallery}
                element={
                  <PreloadedWorkspaceRoute
                    key={Path.Gallery}
                    path={Path.Gallery}
                    fallback={GalleryPage}
                  />
                }
              />
              <Route path={Path.Skills} element={<SkillsMarket />} />
              <Route
                path={Path.Video}
                element={
                  <Navigate
                    to={{
                      pathname: Path.Chat,
                      search: location.search,
                      hash: location.hash,
                    }}
                    state={location.state}
                    replace
                  />
                }
              />
            </Routes>
          </WindowContent>
        </div>
      </>
    );
  };

  return (
    <div
      className={clsx(styles.container, {
        [styles["workspace-container"]]: !isAuth,
        [styles["tight-container"]]: shouldTightBorder,
        [styles["embedded-container"]]: embedded,
        [styles["rtl-screen"]]: false,
        [styles["grid-background"]]: config.showGridBackground,
      })}
      style={
        {
          "--sidebar-width": getSideBarWidth(
            config.sidebarWidth,
            isMobileScreen,
          ),
        } as React.CSSProperties
      }
    >
      {renderContent()}
    </div>
  );
}

export function useLoadData() {
  const config = useAppConfig();

  const api: ClientApi = getClientApi(config.modelConfig.providerName);

  useEffect(() => {
    let active = true;
    (async () => {
      await useAccessStore.getState().fetch();
      if (
        !active ||
        useAccessStore.getState().newApiEnabled ||
        useAccessStore.getState().useCustomConfig
      )
        return;
      const models = await api.llm.models().catch((e) => {
        console.warn("[Models] provider models() failed:", e);
        return [] as any[];
      });
      if (
        active &&
        !useAccessStore.getState().newApiEnabled &&
        !useAccessStore.getState().useCustomConfig &&
        models.length > 0
      ) {
        config.mergeModels(models);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function Home({
  embedded = false,
  communityEntry,
}: { embedded?: boolean; communityEntry?: CommunityEntry } = {}) {
  useEffect(() => trackInputModality(document), []);

  useEffect(() => {
    let cancel: (() => void) | undefined;
    const preloadHistory = () => {
      const state = useChatStore.getState();
      cancel?.();
      if (!state._hasHydrated || state.currentSession().messages.length === 0)
        return;
      cancel = scheduleIdleTask(() => {
        const current = useChatStore.getState();
        if (!current._hasHydrated) return;
        void preloadChatRenderers(current.currentSession().messages).catch(
          () => {},
        );
      });
    };
    const unsubscribe = useChatStore.persist.onFinishHydration(preloadHistory);
    preloadHistory();
    return () => {
      unsubscribe();
      cancel?.();
    };
  }, []);

  const [maintenance, setMaintenance] = useState(false);
  const [workspace, setWorkspace] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  useEffect(() => {
    let active = true;
    initializeLocalWorkspace().then(
      () => active && setWorkspace("ready"),
      () => active && setWorkspace("error"),
    );
    const onSwitch = () => {
      setWorkspace("loading");
      ChatControllerPool.stopAll();
    };
    window.addEventListener("local-workspace-switch", onSwitch);
    const onMaintenance = () => {
      setMaintenance(true);
      ChatControllerPool.stopAll();
    };
    const onMaintenanceEnd = () => setMaintenance(false);
    window.addEventListener("local-data-maintenance", onMaintenance);
    window.addEventListener("local-data-maintenance-end", onMaintenanceEnd);
    return () => {
      active = false;
      window.removeEventListener("local-workspace-switch", onSwitch);
      window.removeEventListener("local-data-maintenance", onMaintenance);
      window.removeEventListener(
        "local-data-maintenance-end",
        onMaintenanceEnd,
      );
    };
  }, []);
  const themeReady = useSwitchTheme();
  const chatReady = useChatStore((state) => state._hasHydrated);
  const promptsReady = usePromptStore((state) => state._hasHydrated);
  useEffect(() => {
    if (workspace !== "ready" || !chatReady || !promptsReady) return;
    return scheduleIdleTask(() => void loadBuiltinPrompts());
  }, [workspace, chatReady, promptsReady]);
  useLoadData();
  useHtmlLang();
  useNetworkStatus();

  useEffect(() => {
    let active = true;
    useAccessStore.getState().fetch();
    const onAccountChanged = (event: Event) => {
      const selection = (event as CustomEvent<NewApiSelection | undefined>)
        .detail;
      return selection
        ? refreshSelectedNewApiModels(selection)
        : refetchModels();
    };
    window.addEventListener("new-api-session-changed", onAccountChanged);
    let modelRefreshTimer: ReturnType<typeof setTimeout> | undefined;
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(modelRefreshTimer);
      modelRefreshTimer = setTimeout(() => void refreshNewApiModels(), 100);
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    const channel =
      "BroadcastChannel" in window
        ? new BroadcastChannel(NEW_API_CHANNEL)
        : null;
    const onRemoteAccountChanged = (event: MessageEvent) => {
      if (
        event.data?.type === "session-changed" &&
        event.data?.source !== NEW_API_TAB_ID
      ) {
        window.dispatchEvent(new Event("new-api-session-changed"));
      }
    };
    const onAccountStorage = (event: StorageEvent) => {
      if (event.key === NEW_API_CHANNEL) {
        window.dispatchEvent(new Event("new-api-session-changed"));
      }
    };
    channel?.addEventListener("message", onRemoteAccountChanged);
    window.addEventListener("storage", onAccountStorage);

    const initMcp = async () => {
      try {
        const enabled = await isMcpAvailable();
        if (enabled && active) {
          await initializeMcpSystem();
        }
      } catch (err) {
        console.error("[MCP] failed to initialize:", err);
      }
    };
    initMcp();
    return () => {
      active = false;
      clearTimeout(modelRefreshTimer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("new-api-session-changed", onAccountChanged);
      channel?.removeEventListener("message", onRemoteAccountChanged);
      channel?.close();
      window.removeEventListener("storage", onAccountStorage);
    };
  }, []);

  const hydrated = useHasHydrated();
  const modelsReady = useAccessStore((state) =>
    ["ready", "error"].includes(state.modelListStatus),
  );
  const [entryReady, setEntryReady] = useState<string>();
  const [entryError, setEntryError] = useState("");
  useEffect(() => {
    if (
      !communityEntry ||
      !hydrated ||
      !chatReady ||
      workspace !== "ready" ||
      !modelsReady ||
      entryReady === communityEntry.id
    )
      return;
    let active = true;
    setEntryError("");
    void startCommunityChat(communityEntry, useAppConfig.getState().models)
      .then(() => {
        if (active) {
          setEntryReady(communityEntry.id);
          window.dispatchEvent(
            new CustomEvent("community-workspace-ready", {
              detail: communityEntry,
            }),
          );
        }
      })
      .catch((error) => {
        if (active)
          setEntryError(
            error instanceof Error
              ? error.message
              : "无法打开制作工作区，请重新连接。",
          );
      });
    return () => {
      active = false;
    };
  }, [communityEntry, hydrated, chatReady, workspace, modelsReady, entryReady]);
  if (entryError) return <div role="alert">{entryError}</div>;
  if (workspace === "error") {
    return (
      <div role="alert">
        本地数据未加载：无法确认账号身份。
        <button onClick={() => location.reload()}>重试</button>
      </div>
    );
  }
  if (
    !hydrated ||
    !themeReady ||
    !chatReady ||
    workspace !== "ready" ||
    (communityEntry && !entryReady)
  ) {
    return <Loading />;
  }

  return (
    <ErrorBoundary>
      <ToastContainer />
      <TaskRecovery />
      <Announcement />
      <Router>
        <Screen embedded={embedded} />
      </Router>
      {maintenance && (
        <div
          role="status"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "var(--white)",
            display: "grid",
            placeItems: "center",
          }}
        >
          正在处理本地数据，请稍候…
        </div>
      )}
    </ErrorBoundary>
  );
}
