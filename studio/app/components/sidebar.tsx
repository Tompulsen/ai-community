import React, {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { Bell, Search, Settings, SquarePen, UserRound } from "lucide-react";

import styles from "./home.module.scss";
import sidebarStyles from "./sidebar.module.scss";

import { IconButton } from "./button";
import { AppBrand } from "./app-brand";
import DragIcon from "../icons/drag.svg";
import Locale from "../locales";

import { useAppConfig, useChatStore } from "../store";

import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  NARROW_SIDEBAR_WIDTH,
  Path,
} from "../constant";

import { useNavigate, useLocation } from "react-router-dom";
import { isIOS, useMobileScreen } from "../utils";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { useSidebarResize } from "./use-sidebar-resize";
import { useScrollbarActivity } from "../utils/use-scrollbar-activity";
import { prefersReducedMotion } from "../utils/motion";
import {
  preloadWorkspaceRoute,
  workspaceRoutePreloadHandlers,
} from "../utils/preload-workspace-routes";
import { triggerAnnouncement } from "./announcement";
import { importInTransition } from "../utils/import-in-transition";

const ChatProjectArea = dynamic(
  async () =>
    (await importInTransition(() => import("./chat-project-list")))
      .ChatProjectArea,
  { loading: () => null, ssr: false },
);

export function getSideBarWidth(width: number, isMobile: boolean) {
  if (isMobile) return "100vw";
  const desktopWidth =
    width < MIN_SIDEBAR_WIDTH
      ? NARROW_SIDEBAR_WIDTH
      : Math.min(MAX_SIDEBAR_WIDTH, width ?? DEFAULT_SIDEBAR_WIDTH);
  return `${desktopWidth}px`;
}

export function useHotKey() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey) {
        if (e.key === "ArrowUp") {
          void useChatStore.getState().nextSession(-1);
        } else if (e.key === "ArrowDown") {
          void useChatStore.getState().nextSession(1);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

export function useDragSideBar() {
  const sidebarWidth = useAppConfig((config) => config.sidebarWidth);
  const isMobileScreen = useMobileScreen();
  const onWidthChange = useCallback((width: number) => {
    useAppConfig.getState().update((config) => {
      config.sidebarWidth = width;
    });
  }, []);
  const resize = useSidebarResize({
    width: sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH,
    isMobile: isMobileScreen,
    onWidthChange,
  });
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-width",
      getSideBarWidth(sidebarWidth, isMobileScreen),
    );
  }, [sidebarWidth, isMobileScreen]);

  return {
    onDragStart: resize.onPointerDown,
    onDragKeyDown: resize.onKeyDown,
    shouldNarrow: resize.shouldNarrow,
    width: sidebarWidth,
  };
}

export function SideBarContainer(props: {
  children: React.ReactNode;
  onDragStart: React.PointerEventHandler<HTMLDivElement>;
  onDragKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  width?: number;
  shouldNarrow: boolean;
  className?: string;
  collapsed?: boolean;
  onClose?: () => void;
}) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const previousNarrow = useRef(props.shouldNarrow);
  const isMobileScreen = useMobileScreen();
  const { pathname } = useLocation();
  const collapsed = !isMobileScreen && !!props.collapsed;
  const hidden = collapsed || (isMobileScreen && pathname !== Path.Home);
  const isIOSMobile = useMemo(
    () => isIOS() && isMobileScreen,
    [isMobileScreen],
  );
  const { children, className, onDragStart, onDragKeyDown, shouldNarrow } =
    props;

  useLayoutEffect(() => {
    if (sidebarRef.current) sidebarRef.current.inert = hidden;
  }, [hidden]);

  useLayoutEffect(() => {
    const changed = previousNarrow.current !== shouldNarrow;
    previousNarrow.current = shouldNarrow;
    const sidebar = sidebarRef.current;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (
      !changed ||
      !sidebar ||
      sidebar.parentElement?.hasAttribute("data-sidebar-resizing") ||
      isMobileScreen ||
      prefersReducedMotion()
    )
      return;

    const animations = Array.from(sidebar.children)
      .filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          !element.classList.contains(styles["sidebar-drag"]) &&
          typeof element.animate === "function",
      )
      .map((element) =>
        element.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 160,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        }),
      );
    const cancel = () => animations.forEach((animation) => animation.cancel());
    const onMotionChange = () => {
      if (prefersReducedMotion()) cancel();
    };
    const observer = new MutationObserver(onMotionChange);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-motion"],
    });
    media.addEventListener("change", onMotionChange);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", onMotionChange);
      cancel();
    };
  }, [shouldNarrow, isMobileScreen]);

  return (
    <div
      ref={sidebarRef}
      className={clsx(styles.sidebar, className, {
        [styles["narrow-sidebar"]]: shouldNarrow,
      })}
      role="complementary"
      aria-label="对话与项目"
      aria-hidden={hidden || undefined}
      data-sidebar-panel
      data-sidebar-collapsed={collapsed || undefined}
      style={{
        // #3016 disable transition on ios mobile screen
        transition: isMobileScreen && isIOSMobile ? "none" : undefined,
      }}
    >
      {children}
      <div
        className={styles["sidebar-drag"]}
        role="separator"
        aria-label="调整侧栏宽度"
        aria-orientation="vertical"
        aria-valuemin={NARROW_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuenow={
          props.width ??
          (shouldNarrow ? NARROW_SIDEBAR_WIDTH : DEFAULT_SIDEBAR_WIDTH)
        }
        tabIndex={isMobileScreen ? -1 : 0}
        onPointerDown={onDragStart}
        onKeyDown={onDragKeyDown}
      >
        <DragIcon />
      </div>
    </div>
  );
}

export function SideBarHeader(props: {
  title?: string | React.ReactNode;
  subTitle?: string | React.ReactNode;
  logo?: React.ReactNode;
  children?: React.ReactNode;
  shouldNarrow?: boolean;
}) {
  const { title, subTitle, logo, children, shouldNarrow } = props;
  return (
    <Fragment>
      <div
        className={clsx(styles["sidebar-header"], {
          [styles["sidebar-header-narrow"]]: shouldNarrow,
        })}
        data-tauri-drag-region
      >
        <div className={clsx(styles["sidebar-logo"], "no-dark")}>{logo}</div>
        <div className={styles["sidebar-title-container"]}>
          <div className={styles["sidebar-title"]} data-tauri-drag-region>
            {title}
          </div>
          <div className={styles["sidebar-sub-title"]}>{subTitle}</div>
        </div>
      </div>
      {children}
    </Fragment>
  );
}

export function SideBarBody(props: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
  className?: string;
}) {
  const { onClick, children, className } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollbarActivity(scrollRef);
  return (
    <div
      ref={scrollRef}
      className={clsx(styles["sidebar-body"], className)}
      data-auto-hide-scrollbar
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function SideBarTail(props: { actions?: React.ReactNode }) {
  const { actions } = props;

  return (
    <div className={styles["sidebar-tail"]}>
      <div className={styles["sidebar-actions"]}>{actions}</div>
    </div>
  );
}

export const SideBar = React.memo(function SideBar(props: {
  compact?: boolean;
  className?: string;
  collapsed?: boolean;
  onClose?: () => void;
}) {
  useHotKey();
  const { onDragStart, onDragKeyDown, shouldNarrow, width } = useDragSideBar();
  const navigate = useNavigate();
  const location = useLocation();
  const dontShowMaskSplashScreen = useAppConfig(
    (config) => config.dontShowMaskSplashScreen,
  );
  const newChat = () => {
    if (dontShowMaskSplashScreen) {
      useChatStore.getState().newSession();
      navigate(Path.Chat);
    } else {
      navigate(Path.NewChat);
    }
  };

  return (
    <SideBarContainer
      onDragStart={onDragStart}
      onDragKeyDown={onDragKeyDown}
      width={width}
      shouldNarrow={shouldNarrow}
      collapsed={props.collapsed}
      onClose={props.onClose}
      className={clsx(sidebarStyles.panel, props.className, {
        [sidebarStyles.narrow]: shouldNarrow,
      })}
    >
      {!props.compact && (
        <header className={sidebarStyles.brand} data-tauri-drag-region>
          <AppBrand
            className={sidebarStyles["brand-title"]}
            compact={shouldNarrow}
          />
          <div className={sidebarStyles["brand-actions"]}>
            <IconButton
              icon={<Bell size={16} />}
              aria="公告"
              title="公告"
              className={sidebarStyles["icon-action"]}
              onClick={triggerAnnouncement}
            />
            <IconButton
              icon={<Search size={16} />}
              aria={Locale.SearchChat.Page.Title}
              title={Locale.SearchChat.Page.Title}
              className={clsx(
                sidebarStyles["icon-action"],
                sidebarStyles["desktop-search"],
              )}
              onClick={() =>
                navigate(Path.SearchChat, { state: { fromHome: true } })
              }
            />
            <span
              className={sidebarStyles["mobile-more"]}
              data-workspace-mobile-more
            />
          </div>
        </header>
      )}

      <IconButton
        icon={<SquarePen size={18} />}
        text={shouldNarrow ? undefined : Locale.Home.NewChat}
        aria={Locale.Home.NewChat}
        title={Locale.Home.NewChat}
        className={sidebarStyles["new-chat"]}
        onClick={newChat}
      />

      <SideBarBody className={sidebarStyles["scroll-body"]}>
        <ChatProjectArea narrow={shouldNarrow} />
      </SideBarBody>

      {!props.compact && (
        <nav className={sidebarStyles["mobile-tail"]} aria-label="账号与设置">
          <button
            type="button"
            className={sidebarStyles.link}
            aria-current={
              location.pathname === Path.Account ? "page" : undefined
            }
            {...workspaceRoutePreloadHandlers(Path.Account)}
            onClick={() => {
              void preloadWorkspaceRoute(Path.Account, "activation");
              navigate(Path.Account);
            }}
          >
            <UserRound size={18} aria-hidden="true" />
            <span>{Locale.Account.Title}</span>
          </button>
          <IconButton
            icon={<Settings size={18} />}
            aria={Locale.Settings.Title}
            title={Locale.Settings.Title}
            className={sidebarStyles["icon-action"]}
            {...workspaceRoutePreloadHandlers(Path.Settings)}
            onClick={() => {
              void preloadWorkspaceRoute(Path.Settings, "activation");
              navigate(Path.Settings);
            }}
          />
        </nav>
      )}
    </SideBarContainer>
  );
});
