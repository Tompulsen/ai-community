"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Bell,
  Compass,
  Drama,
  Expand,
  FlaskConical,
  House,
  Images,
  Keyboard,
  Minimize,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Plug,
  RotateCw,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Tags,
  UserRound,
} from "lucide-react";
import clsx from "clsx";
import dynamic from "next/dynamic";
import { useLocation, useNavigate } from "react-router-dom";
import { Path } from "../constant";
import Locale from "../locales";
import { useAppConfig, useChatStore } from "../store";
import { getClientConfig } from "../config/client";
import { isMcpAvailable } from "../mcp/availability";
import { useMobileScreen } from "../utils";
import { createChatListStoreSelector } from "../utils/chat-list-summary";
import { isLocalWorkspaceActive } from "../utils/local-workspace";
import { isLocalPreviewEnabled } from "../utils/local-preview-models";
import {
  preloadWorkspaceRoute,
  workspaceRoutePreloadHandlers,
} from "../utils/preload-workspace-routes";
import {
  getChatShortcuts,
  type ChatShortcutAction,
} from "../utils/chat-shortcuts";
import {
  canRunTextEditCommand,
  captureTextEditTarget,
  isTextEditCommand,
  runTextEditCommand,
  type TextEditTarget,
} from "../utils/text-edit-command";
import {
  focusMenuEdge,
  WorkspaceMenu,
  type WorkspaceMenuItem as MenuItem,
} from "./workspace-menu";
import { usePwaInstallAction } from "./pwa-install";
import { renameChatSession } from "./chat-session-actions";
import { showToast } from "./ui-lib";
import { triggerAnnouncement } from "./announcement";
import {
  dispatchWorkspaceAction,
  useWorkspaceActions,
  type WorkspaceAction,
} from "./workspace-actions";
import styles from "./workspace-navigation.module.scss";

type MenuKey = "chat" | "tools" | "view" | "help" | "more";

const LocalChatPreview = dynamic(
  async () => (await import("./local-chat-preview")).LocalChatPreview,
  { loading: () => null, ssr: false },
);

function workspaceNavigation(mcpEnabled: boolean) {
  return [
    { path: Path.Chat, label: "聊天", icon: <House /> },
    { path: Path.Masks, label: Locale.Mask.Name, icon: <Drama /> },
    ...(mcpEnabled
      ? [{ path: Path.McpMarket, label: Locale.Mcp.Name, icon: <Plug /> }]
      : []),
    { path: Path.Gallery, label: Locale.Navigation.Gallery, icon: <Images /> },
    { path: Path.Skills, label: "技能广场", icon: <Sparkles /> },
    { path: Path.Pricing, label: "模型价格", icon: <Tags /> },
  ];
}

function useMcpNavigation() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    void isMcpAvailable()
      .then((value) => active && setEnabled(value))
      .catch(() => {
        if (active) setEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return enabled;
}

export function WorkspaceTopbar({
  sidebarOpen,
  onToggleSidebar,
  compact = false,
}: {
  compact?: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isMobile = useMobileScreen();
  const [mobileMoreTarget, setMobileMoreTarget] = useState<HTMLElement | null>(
    null,
  );
  const restoreMoreFocus = useRef(false);
  const { action: installAction, hint: installHint } = usePwaInstallAction();
  const [previewAvailable, setPreviewAvailable] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  useEffect(() => setPreviewAvailable(isLocalPreviewEnabled()), []);
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().includes("MAC"));
  }, []);
  useEffect(() => {
    const openSettings = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.repeat ||
        event.altKey ||
        event.shiftKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key !== "," ||
        document.querySelector("[data-modal-dialog], dialog[open]")
      )
        return;
      event.preventDefault();
      void preloadWorkspaceRoute(Path.Settings, "activation");
      if (pathname !== Path.Settings) navigate(Path.Settings);
    };
    document.addEventListener("keydown", openSettings);
    return () => document.removeEventListener("keydown", openSettings);
  }, [navigate, pathname]);
  const selector = useMemo(() => createChatListStoreSelector(null), []);
  const { sessions, selectedIndex } = useChatStore(selector);
  const session = sessions[selectedIndex];
  const lastEditTarget = useRef<TextEditTarget | null>(null);
  const [editTarget, setEditTarget] = useState<TextEditTarget | null>(null);
  const editScope = `${pathname}:${session?.id ?? ""}`;
  const editRevision = useRef({ scope: editScope, revision: 0 });
  if (editRevision.current.scope !== editScope) {
    editRevision.current = {
      scope: editScope,
      revision: editRevision.current.revision + 1,
    };
    lastEditTarget.current = null;
  }
  useEffect(() => {
    const remember = (event: Event) => {
      const element =
        event.type === "focusout" && event.target instanceof Element
          ? event.target
          : document.activeElement;
      if (
        element?.closest(
          '[data-workspace-topbar], [data-workspace-edit-action], [role="menu"]',
        )
      )
        return;
      const target = captureTextEditTarget(element);
      if (target) lastEditTarget.current = target;
    };
    document.addEventListener("focusin", remember);
    document.addEventListener("focusout", remember);
    document.addEventListener("select", remember);
    document.addEventListener("selectionchange", remember);
    return () => {
      document.removeEventListener("focusin", remember);
      document.removeEventListener("focusout", remember);
      document.removeEventListener("select", remember);
      document.removeEventListener("selectionchange", remember);
    };
  }, []);
  const prepareEdit = useCallback(() => {
    const previous = lastEditTarget.current;
    const toolbarFocused = document.activeElement?.closest(
      '[data-workspace-topbar], [role="menu"]',
    );
    const target =
      (!toolbarFocused ? captureTextEditTarget() : null) ??
      (previous?.kind === "input"
        ? captureTextEditTarget(previous.element)
        : previous);
    lastEditTarget.current = target;
    setEditTarget(target);
  }, []);
  const isChat = pathname === Path.Chat || pathname === Path.Home;
  const sidebarLabel =
    pathname === Path.Settings
      ? "返回对话"
      : sidebarOpen
      ? "收起侧栏"
      : "展开侧栏";
  const hasMessages = isChat && (session?.count ?? 0) > 0;
  const tightBorder = useAppConfig((state) => state.tightBorder);
  const dontShowMaskSplashScreen = useAppConfig(
    (state) => state.dontShowMaskSplashScreen,
  );
  const mcpEnabled = useMcpNavigation();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const lastMenu = useRef<MenuKey>("chat");
  if (openMenu) lastMenu.current = openMenu;
  const selectedMenu = openMenu ?? lastMenu.current;
  const menuId = useId();
  const triggers = useRef<Partial<Record<MenuKey, HTMLButtonElement | null>>>(
    {},
  );
  const keyboard = useRef<"first" | "last" | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const target =
      !compact && isMobile && sidebarOpen
        ? document.querySelector<HTMLElement>("[data-workspace-mobile-more]")
        : null;
    if (target === mobileMoreTarget) return;
    restoreMoreFocus.current = document.activeElement === triggers.current.more;
    setMobileMoreTarget(target);
  }, [compact, isMobile, sidebarOpen, mobileMoreTarget]);
  trigger.current =
    triggers.current[
      selectedMenu === "tools" && isMobile ? "more" : selectedMenu
    ] ?? null;
  const openShortcuts = useCallback(() => {
    prepareEdit();
    keyboard.current = "first";
    setOpenMenu("tools");
  }, [prepareEdit]);
  useWorkspaceActions({ shortcuts: openShortcuts });

  const newChat = () => {
    if (dontShowMaskSplashScreen) {
      useChatStore.getState().newSession();
      navigate(Path.Chat);
    } else navigate(Path.NewChat);
  };
  const editDisabled = (action: ChatShortcutAction) => {
    if (isTextEditCommand(action))
      return !canRunTextEditCommand(action, editTarget, isMac);
    if (action === "new-chat" || action === "settings") return false;
    if (action === "copy-last-code" || action === "copy-last-reply")
      return !hasMessages;
    return !isChat;
  };
  const edit = (action: ChatShortcutAction) => {
    if (isTextEditCommand(action)) {
      const revision = editRevision.current.revision;
      const sessionId = useChatStore.getState().currentSession().id;
      const routeHash = window.location.hash;
      void runTextEditCommand(
        action,
        editTarget,
        () =>
          editRevision.current.revision === revision &&
          window.location.hash === routeHash &&
          isLocalWorkspaceActive() &&
          useChatStore.getState().currentSession().id === sessionId,
        isMac,
      ).then((result) => {
        if (result === "paste-failed")
          showToast(`无法读取剪贴板，请使用 ${isMac ? "⌘" : "Ctrl"}+V 粘贴`);
      });
    } else if (action === "new-chat") newChat();
    else if (action === "settings") {
      void preloadWorkspaceRoute(Path.Settings, "activation");
      navigate(Path.Settings);
    } else dispatchWorkspaceAction(action);
  };
  const step = (direction: -1 | 1) => {
    const store = useChatStore.getState();
    void store.nextSession(direction);
    navigate(Path.Chat);
  };
  const command = (
    id: WorkspaceAction,
    label: string,
    icon: ReactNode,
    disabled = !isChat,
  ): MenuItem => ({
    id,
    label,
    icon,
    disabled,
    onSelect: () => dispatchWorkspaceAction(id),
  });
  const route = (path: Path) => () => {
    void preloadWorkspaceRoute(path, "activation");
    navigate(path, { state: { fromHome: true } });
  };
  const menus: Record<MenuKey, { label: string; items: MenuItem[] }> = {
    chat: {
      label: "对话",
      items: [
        {
          id: "new",
          label: Locale.Home.NewChat,
          icon: <SquarePen />,
          onSelect: newChat,
        },
        {
          id: "history-search",
          label: "搜索聊天记录",
          icon: <Search />,
          onSelect: route(Path.SearchChat),
        },
        command("search", "查找当前对话", <Search />, !hasMessages),
        {
          id: "rename",
          label: "重命名对话",
          icon: <Pencil />,
          disabled: !isChat,
          onSelect: () => {
            if (session) void renameChatSession(session.id);
          },
        },
        command(
          "regenerate-title",
          Locale.Chat.Actions.RefreshTitle,
          <RotateCw />,
          !hasMessages,
        ),
        command(
          "edit-messages",
          Locale.Chat.EditMessage.Title,
          <SquarePen />,
          !hasMessages,
        ),
        command("export", Locale.Chat.Actions.Export, <Share2 />, !hasMessages),
        command("model", "选择模型", <Box />),
        command("skills", "选择技能", <Sparkles />),
        command(
          "chat-settings",
          Locale.Chat.InputActions.ChatSettings,
          <SlidersHorizontal />,
        ),
      ],
    },
    tools: {
      label: "编辑",
      items: [],
    },
    view: {
      label: "视图",
      items: [
        {
          id: "sidebar",
          label: sidebarLabel,
          icon: pathname === Path.Settings ? <ArrowLeft /> : <PanelLeft />,
          onSelect: onToggleSidebar,
        },
        ...(!getClientConfig()?.isApp
          ? [
              {
                id: "fill-window",
                label: tightBorder ? "还原窗口" : "填满窗口",
                icon: tightBorder ? <Minimize /> : <Expand />,
                onSelect: () =>
                  useAppConfig.getState().update((config) => {
                    config.tightBorder = !config.tightBorder;
                  }),
              },
            ]
          : []),
      ],
    },
    help: {
      label: "帮助",
      items: [
        ...(installAction
          ? [
              {
                id: "install-app",
                label: installAction.text,
                icon: installAction.icon,
                onSelect: installAction.onClick,
              },
            ]
          : []),
        ...(previewAvailable
          ? [
              {
                id: "local-preview",
                label: "本地测试",
                icon: <FlaskConical />,
                disabled: previewBusy,
                onSelect: () => setPreviewOpen(true),
              },
            ]
          : []),
      ],
    },
    more: { label: "更多操作", items: [] },
  };
  const historyItems: MenuItem[] = [
    {
      id: "previous",
      label: "上一个对话",
      icon: <ArrowLeft />,
      disabled: selectedIndex <= 0,
      onSelect: () => step(-1),
    },
    {
      id: "next",
      label: "下一个对话",
      icon: <ArrowRight />,
      disabled: selectedIndex >= sessions.length - 1,
      onSelect: () => step(1),
    },
  ];
  if (compact) {
    menus.chat.items.push(...historyItems);
    menus.help.items.unshift({
      id: "announcement",
      label: "公告",
      icon: <Bell />,
      onSelect: triggerAnnouncement,
    });
  }
  menus.more.items = [
    ...(isMobile && sidebarOpen
      ? [
          {
            id: "return-chat",
            label: "返回对话",
            icon: <ArrowLeft />,
            onSelect: onToggleSidebar,
          },
        ]
      : []),
    ...(!compact ? historyItems : []),
    ...menus.chat.items.filter((item) => item.id !== "new"),
    {
      id: "shortcuts",
      label: "编辑",
      icon: <Keyboard />,
      onSelect: openShortcuts,
    },
    ...workspaceNavigation(mcpEnabled)
      .filter((item) => item.path !== Path.Chat)
      .map((item) => ({
        id: `navigate-${item.path}`,
        label: item.label,
        icon: item.icon,
        onSelect: route(item.path),
        onIntent: (activation: boolean) => {
          void preloadWorkspaceRoute(
            item.path,
            activation ? "activation" : "intent",
          );
        },
      })),
    ...menus.help.items,
  ];
  const destinations: MenuItem[] = [
    ...workspaceNavigation(mcpEnabled).filter(
      (item) => ![Path.Gallery, Path.Pricing].includes(item.path),
    ),
    { path: Path.Account, label: Locale.Account.Title, icon: <UserRound /> },
    { path: Path.Settings, label: Locale.Settings.Title, icon: <Settings /> },
  ].map((item) => ({
    id: `navigate-${item.path}`,
    label: item.label,
    icon: item.icon,
    onSelect: route(item.path),
    onIntent: (activation) => {
      void preloadWorkspaceRoute(
        item.path,
        activation ? "activation" : "intent",
      );
    },
  }));
  if (compact) {
    menus.more.items = isMobile
      ? [
          ...menus.chat.items,
          ...menus.view.items,
          {
            id: "shortcuts",
            label: "编辑与快捷键",
            icon: <Keyboard />,
            onSelect: openShortcuts,
          },
          ...destinations,
          ...menus.help.items,
        ]
      : destinations;
  }
  const menuKeys = useMemo<MenuKey[]>(
    () =>
      compact
        ? ["chat", "tools", "view", "help", "more"]
        : ["chat", "tools", "view", "help"],
    [compact],
  );
  const close = useCallback(
    (restoreFocus = false) => {
      setOpenMenu(null);
      if (restoreFocus) {
        const key =
          lastMenu.current === "tools" && isMobile ? "more" : lastMenu.current;
        triggers.current[key]?.focus({ preventScroll: true });
      }
    },
    [isMobile],
  );
  useEffect(() => setOpenMenu(null), [pathname, isMobile]);
  const switchMenu = useCallback(
    (direction: -1 | 1) => {
      const keys = menuKeys.filter((key) => !triggers.current[key]?.disabled);
      const index = keys.indexOf(lastMenu.current as (typeof keys)[number]);
      const next = keys[(index + direction + keys.length) % keys.length];
      if (next === "tools") prepareEdit();
      keyboard.current = "first";
      setOpenMenu(next);
    },
    [prepareEdit, menuKeys],
  );
  const moreButton = (
    <button
      ref={(element) => {
        triggers.current.more = element;
        if (isMobile && (selectedMenu === "more" || selectedMenu === "tools"))
          trigger.current = element;
        if (element && restoreMoreFocus.current) {
          restoreMoreFocus.current = false;
          if (isMobile) element.focus({ preventScroll: true });
        }
      }}
      type="button"
      className={styles.icon}
      aria-label="更多操作"
      title="更多操作"
      aria-haspopup="menu"
      aria-expanded={openMenu === "more" || (isMobile && openMenu === "tools")}
      aria-controls={`${menuId}-${
        isMobile && openMenu === "tools" ? "tools" : "more"
      }`}
      onClick={() => {
        keyboard.current = null;
        setOpenMenu((current) => (current ? null : "more"));
      }}
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
        event.preventDefault();
        keyboard.current = event.key === "ArrowDown" ? "first" : "last";
        if (openMenu === "more" || (isMobile && openMenu === "tools"))
          focusMenuEdge(`${menuId}-${openMenu}`, keyboard.current);
        else setOpenMenu("more");
      }}
    >
      <MoreHorizontal />
    </button>
  );

  return (
    <header
      className={clsx(styles.topbar, { [styles.compact]: compact })}
      aria-label="顶部工具栏"
      data-workspace-topbar
      data-sidebar-open={sidebarOpen}
      onPointerDownCapture={(event) => {
        if (event.currentTarget.contains(event.target as Node)) {
          const target = captureTextEditTarget();
          if (target) lastEditTarget.current = target;
        }
      }}
    >
      <div className={styles.leading}>
        {!compact && (
          <button
            type="button"
            className={clsx(styles.icon, styles.history)}
            aria-label="上一个对话"
            title="上一个对话"
            disabled={selectedIndex <= 0}
            onClick={() => step(-1)}
          >
            <ArrowLeft />
          </button>
        )}
        {!compact && (
          <button
            type="button"
            className={clsx(styles.icon, styles.history)}
            aria-label="下一个对话"
            title="下一个对话"
            disabled={selectedIndex >= sessions.length - 1}
            onClick={() => step(1)}
          >
            <ArrowRight />
          </button>
        )}
        {(!compact || isMobile) && (
          <button
            type="button"
            className={styles.icon}
            data-workspace-sidebar-toggle
            aria-label={sidebarLabel}
            aria-expanded={pathname === Path.Settings ? undefined : sidebarOpen}
            aria-controls={
              pathname === Path.Settings ? undefined : "workspace-sidebar"
            }
            title={sidebarLabel}
            onClick={onToggleSidebar}
          >
            {pathname === Path.Settings ? <ArrowLeft /> : <PanelLeft />}
          </button>
        )}
        <nav className={styles.menubar} aria-label="应用菜单">
          {menuKeys.map((key) => (
            <button
              key={key}
              ref={(element) => {
                triggers.current[key] = element;
              }}
              type="button"
              className={styles.menuTrigger}
              disabled={key === "help" && menus.help.items.length === 0}
              aria-haspopup="menu"
              aria-expanded={openMenu === key}
              aria-controls={`${menuId}-${key}`}
              data-workspace-menu={key}
              onClick={() => {
                if (key === "tools") prepareEdit();
                keyboard.current = null;
                setOpenMenu((current) => (current === key ? null : key));
              }}
              onPointerEnter={() => {
                if (key === "help" && menus.help.items.length === 0) return;
                if (openMenu && openMenu !== key) {
                  if (key === "tools") prepareEdit();
                  keyboard.current = null;
                  setOpenMenu(key);
                }
              }}
              onKeyDown={(event) => {
                if (["ArrowDown", "ArrowUp"].includes(event.key)) {
                  event.preventDefault();
                  if (key === "tools") prepareEdit();
                  keyboard.current =
                    event.key === "ArrowDown" ? "first" : "last";
                  if (openMenu === key) {
                    focusMenuEdge(`${menuId}-${key}`, keyboard.current);
                  } else {
                    setOpenMenu(key);
                  }
                } else if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                  event.preventDefault();
                  const keys = menuKeys.filter(
                    (key) => !triggers.current[key]?.disabled,
                  );
                  const next =
                    keys[
                      (keys.indexOf(key) +
                        (event.key === "ArrowLeft" ? -1 : 1) +
                        keys.length) %
                        keys.length
                    ];
                  triggers.current[next]?.focus();
                  if (openMenu) {
                    if (next === "tools") prepareEdit();
                    keyboard.current = "first";
                    setOpenMenu(next);
                  }
                }
              }}
            >
              {key === "more" ? "更多" : menus[key].label}
            </button>
          ))}
        </nav>
      </div>
      {compact && (
        <nav className={styles.destinations} aria-label="作品与价格">
          {[
            { path: Path.Gallery, label: "作品库", icon: <Images /> },
            { path: Path.Pricing, label: "模型定价", icon: <Tags /> },
          ].map((item) => (
            <button
              key={item.path}
              type="button"
              className={styles.menuTrigger}
              aria-current={pathname === item.path ? "page" : undefined}
              {...workspaceRoutePreloadHandlers(item.path)}
              onClick={route(item.path)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      )}
      {(!compact || isMobile) && (
        <div className={styles.mobileActions}>
          <button
            type="button"
            className={styles.icon}
            aria-label={Locale.Home.NewChat}
            title={Locale.Home.NewChat}
            onClick={newChat}
          >
            <SquarePen />
          </button>
          {!mobileMoreTarget && moreButton}
        </div>
      )}
      {mobileMoreTarget && createPortal(moreButton, mobileMoreTarget)}
      <div className={styles.chatActions} data-workspace-chat-actions />
      <WorkspaceMenu
        key={selectedMenu}
        id={`${menuId}-${selectedMenu}`}
        label={menus[selectedMenu].label}
        open={openMenu !== null}
        items={menus[selectedMenu].items}
        trigger={trigger}
        keyboard={keyboard}
        onClose={close}
        onSwitch={
          isMobile || (!compact && selectedMenu === "more")
            ? undefined
            : switchMenu
        }
        shortcuts={
          selectedMenu === "tools" ? getChatShortcuts(isMac) : undefined
        }
        onEdit={edit}
        onEditIntent={(action, activation) => {
          if (action === "settings") {
            void preloadWorkspaceRoute(
              Path.Settings,
              activation ? "activation" : "intent",
            );
          }
        }}
        editDisabled={editDisabled}
      />
      {installHint}
      {process.env.NODE_ENV === "development" && (
        <LocalChatPreview
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          onBusyChange={setPreviewBusy}
        />
      )}
    </header>
  );
}

export function WorkspaceRail() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const mcpEnabled = useMcpNavigation();
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const discover = useRef<HTMLButtonElement>(null);
  const keyboard = useRef<"first" | "last" | null>(null);
  const discoverId = useId();
  const close = useCallback((restoreFocus = false) => {
    setDiscoverOpen(false);
    if (restoreFocus) discover.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => setDiscoverOpen(false), [pathname]);
  const navigation = workspaceNavigation(mcpEnabled).filter(
    (item) =>
      item.path !== Path.Masks &&
      item.path !== Path.Skills &&
      item.path !== Path.Pricing,
  );
  const link = (item: { path: Path; label: string; icon: ReactNode }) => (
    <button
      key={item.path}
      type="button"
      className={styles.icon}
      title={item.label}
      aria-label={item.label}
      aria-current={
        pathname === item.path ||
        (item.path === Path.Chat && pathname === Path.Home)
          ? "page"
          : undefined
      }
      {...workspaceRoutePreloadHandlers(item.path)}
      onClick={() => {
        void preloadWorkspaceRoute(item.path, "activation");
        const preview =
          isLocalPreviewEnabled() &&
          new URLSearchParams(search).get("local-preview") === "account" &&
          [Path.Account, Path.Pricing].includes(item.path);
        navigate(
          {
            pathname: item.path,
            search: preview ? "?local-preview=account" : "",
          },
          { state: { fromHome: true } },
        );
      }}
    >
      {item.icon}
    </button>
  );
  return (
    <nav className={styles.rail} aria-label="应用导航" data-workspace-rail>
      <div className={styles.railGroup}>
        {navigation.map(link)}
        <button
          ref={discover}
          type="button"
          className={styles.icon}
          title={Locale.Discovery.Name}
          aria-label={Locale.Discovery.Name}
          aria-haspopup="menu"
          aria-expanded={discoverOpen}
          aria-controls={discoverId}
          aria-current={
            pathname === Path.Masks || pathname === Path.Skills
              ? "page"
              : undefined
          }
          onClick={() => {
            keyboard.current = null;
            setDiscoverOpen((open) => !open);
          }}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
            event.preventDefault();
            keyboard.current = event.key === "ArrowDown" ? "first" : "last";
            if (discoverOpen) focusMenuEdge(discoverId, keyboard.current);
            else setDiscoverOpen(true);
          }}
        >
          <Compass />
        </button>
        {link({
          path: Path.Pricing,
          label: "模型价格",
          icon: <Tags />,
        })}
      </div>
      <div className={styles.railGroup}>
        {link({
          path: Path.Account,
          label: Locale.Account.Title,
          icon: <UserRound />,
        })}
        {link({
          path: Path.Settings,
          label: Locale.Settings.Title,
          icon: <Settings />,
        })}
      </div>
      <WorkspaceMenu
        id={discoverId}
        label={Locale.Discovery.Name}
        open={discoverOpen}
        trigger={discover}
        keyboard={keyboard}
        onClose={close}
        items={workspaceNavigation(mcpEnabled)
          .filter(
            (item) => item.path === Path.Masks || item.path === Path.Skills,
          )
          .map((item) => ({
            id: `navigate-${item.path}`,
            label: item.label,
            icon: item.icon,
            onSelect: () => navigate(item.path, { state: { fromHome: true } }),
          }))}
      />
    </nav>
  );
}
