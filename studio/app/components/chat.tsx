import { useDebouncedCallback } from "use-debounce";
import React, {
  Fragment,
  RefObject,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import {
  ArrowDown,
  ArrowUp,
  Copy,
  CopyPlus,
  ChevronLeft,
  ChevronRight,
  Eraser,
  FolderOpen,
  Eye,
  Maximize,
  Maximize2,
  Mic,
  Minimize,
  Pin,
  Plus,
  RotateCw,
  Search,
  Share2,
  Settings2,
  Square,
  SquarePen,
  Trash2,
  Volume2,
} from "lucide-react";
import McpToolIcon from "../icons/tool.svg";
import OctopusIcon from "../icons/octopus-icon";
import LoadingIcon from "../icons/three-dots.svg";
import { AiStatus } from "./ai-status";
import { MessageToolActivity } from "./message-tool-activity";
import { MessageEditor } from "./message-editor";
import { MessageSources } from "./message-sources";
import { MessageQuoteView } from "./message-quote";
import { ConversationSearch } from "./conversation-search";
import { ContextUsage } from "./context-usage";
import { ComposerBilling } from "./composer-billing";
import { ContextCompressionNotice } from "./context-compression-notice";
import { FollowupSuggestions } from "./followup-suggestions";
import { MessageOptionList } from "./message-option-list";
import { useConversationSearchHighlight } from "./use-conversation-search-highlight";
import {
  readMessageInteractions,
  validateOptionSelection,
  type MessageInteractionReceipt,
} from "../utils/message-interactions";
import {
  getConversationSearchText,
  loadConversationSearch,
  navigateConversationMatch,
} from "../utils/conversation-search";
import { useConversationSearch } from "../utils/use-conversation-search";
import { scheduleIdleTask } from "../utils/schedule-idle-task";
import {
  preloadCommonWorkspaceRoutes,
  preloadWorkspaceRoute,
} from "../utils/preload-workspace-routes";
import { getMessageSources } from "../utils/message-sources";
import {
  createMessageQuote,
  formatQuoteInput,
  readMessageQuote,
  type MessageQuote,
} from "../utils/message-quote";
import { FluidOrb } from "./fluid-orb";
import { ChatAction, ChatMessageActions } from "./chat-action";
import { CommunityShareButton } from "./community-share-button";
import { QuotaPricingCard } from "./quota-pricing-card";
import {
  findCommunityWorkspace,
  resolveCommunityRemixModel,
  startCommunityChat,
} from "../utils/community-entry";
import {
  useCommunityRemix,
  useCommunityRemixDraft,
  remixImages,
} from "../utils/community-remix";
import {
  messageShareSource,
  messageGeneration,
} from "../utils/community-share";
import {
  readGalleryReuse,
  videoGenerationReuse,
  type GalleryReuseTarget,
  type GenerationReuse,
} from "../utils/gallery-reuse";
import LoadingButtonIcon from "../icons/loading.svg";
import CloseIcon from "../icons/close.svg";
import ImageIcon from "../icons/image.svg";
import {
  BOT_HELLO,
  ChatMessage,
  createMessage,
  fillTemplateWith,
  isContextCompressionActive,
  DEFAULT_TOPIC,
  ModelType,
  useAccessStore,
  useAppConfig,
  useChatStore,
} from "../store";

import {
  autoGrowTextArea,
  copyToClipboard,
  getMessageImages,
  getMessageTextContent,
  shouldUseImageGenerationApi,
  safeLocalStorage,
  useMobileScreen,
} from "../utils";

import { uploadImage as uploadImageRemote } from "@/app/utils/chat";
import { asyncTaskManager } from "@/app/utils/async-task";
import { AccountReadiness } from "./account-readiness";
import { SkillPicker } from "./skill-picker";
import { WebSearchAction } from "./web-search-action";
import { SelectionDialog } from "./selection-dialog";
import {
  getLocalScope,
  getLocalTokenId,
  isLocalWorkspaceActive,
  localKey,
} from "../utils/local-workspace";
import { pendingTasks } from "../utils/local-tasks";
import { useSubmitHandler } from "../utils/use-submit-handler";
import { useChatModelPicker } from "../utils/use-chat-model-picker";
import { useComposerFocus } from "../utils/use-composer-focus";
import { useScrollbarActivity } from "../utils/use-scrollbar-activity";
import { useModelCapabilities } from "../utils/model-capabilities";
import {
  isLocalPreviewEnabled,
  isLocalPreviewModel,
  LOCAL_PREVIEW_MESSAGE,
} from "../utils/local-preview-models";
import { FileName } from "./file-name";
import { MaterialStatus } from "./material-status";
import {
  createMaterialUpload,
  type MaterialPreparation,
} from "../utils/material-upload";
import { ChatSplitPane } from "./chat-split-pane";
import { HTMLPreview } from "./html-preview";

import dynamic from "next/dynamic";

import { ChatControllerPool } from "../client/controller";
import { loadBuiltinPrompts, Prompt, usePromptStore } from "../store/prompt";
import Locale, { getLang } from "../locales";

import { IconButton } from "./button";
import { useVoiceInput } from "../utils/use-voice-input";
import { useReadAloud } from "../utils/use-read-aloud";
import {
  parseFile,
  formatFileContent,
  getFileAccept,
  messageFiles,
  type ParsedFile,
} from "../utils/file-upload";
import { DeleteImageButton } from "./delete-image-button";
import {
  ChatContextMenu,
  getMessageSelectionText,
  type ContextMenuState,
} from "./chat-context-menu";
import { isMessageInteractiveTarget } from "./chat-hooks";
import { ModelSelect } from "./model-select";
import styles from "./chat.module.scss";

import { showConfirm, showPrompt, showToast } from "./ui-lib";
import { useLocation, useNavigate } from "react-router-dom";
import {
  DEFAULT_INPUT_TEMPLATE,
  CHAT_PAGE_SIZE,
  Path,
  REQUEST_TIMEOUT_MS,
  UNFINISHED_INPUT,
} from "../constant";
import { Avatar } from "./emoji";
import { MaskAvatar } from "./mask-avatar";
import { PromptPreview } from "./prompt-content";
import { ChatCommandPrefix, useChatCommand, useCommand } from "../command";
import { formatMessageDate, prettyObject } from "../utils/format";
import { Lightbox } from "./gallery/lightbox";
import {
  isAccountModelMode,
  usesCustomProvider,
  CUSTOM_MODEL_PROVIDER,
} from "../utils/custom-provider";
import {
  imageRatio,
  imageQuality,
  imageResolution,
  imageRequestSize,
  usesFixedImageSizes,
  IMAGE_PROMPT_LIMIT,
  imagePromptLength,
  validateImagePrompt,
  supportsImageOutputOptions,
} from "../utils/image-params";
import { generatedImageUrls } from "../utils/image-response";
import { copyImageToClipboard } from "../utils/image-clipboard";
import { loadImageAsset } from "../utils/image-asset";
import { ImageOutputControls } from "./image-output-controls";
import { ImageParameterControls } from "./image-parameter-controls";
import { ChatVideoParameters } from "./chat-video-parameters";
import { chatVideoDraft } from "../utils/chat-video";
import { useVideoStore } from "../store/video";
import { ModelEffortControl } from "./model-effort-control";
import { ComposerParameterPopover } from "./composer-parameter-popover";
import {
  dispatchWorkspaceAction,
  getLastChatCode,
  useWorkspaceActions,
} from "./workspace-actions";
import { renameChatSession } from "./chat-session-actions";
import { getClientConfig } from "../config/client";
import { useAllModels } from "../utils/hooks";
import { MultimodalContent } from "../client/api";

import {
  collectModelsWithDefaultModel,
  getModelProvider,
} from "../utils/model";
import clsx from "clsx";
import { shallow } from "zustand/shallow";
import { getAvailableClientsCount } from "../mcp/actions";
import { isMcpAvailable } from "../mcp/availability";
import { importInTransition } from "../utils/import-in-transition";

const localStorage = safeLocalStorage();

const Markdown = dynamic(
  async () => (await importInTransition(() => import("./markdown"))).Markdown,
  {
    loading: () => <span data-chat-history-loading hidden />,
    ssr: false,
  },
);
const ChatVideoResult = dynamic(
  async () =>
    (await import("./video-workspace/video-workspace")).ChatVideoResult,
  { ssr: false },
);

const ReasoningPanel = dynamic(
  async () =>
    (await importInTransition(() => import("./reasoning-panel")))
      .ReasoningPanel,
  {
    loading: () => <span data-chat-history-loading hidden />,
    ssr: false,
  },
);

const ExportMessageModal = dynamic(
  async () => (await import("./exporter")).ExportMessageModal,
  { ssr: false },
);

const SessionConfigModel = dynamic(
  async () => (await import("./session-config-modal")).SessionConfigModel,
  { ssr: false, loading: () => null },
);

const EditMessageModal = dynamic(
  async () => (await import("./chat-modals")).EditMessageModal,
  { ssr: false, loading: () => null },
);

const EditInputModal = dynamic(
  async () => (await import("./chat-modals")).EditInputModal,
  { ssr: false, loading: () => null },
);

const MCPAction = () => {
  const navigate = useNavigate();
  const [count, setCount] = useState<number>(0);
  const [mcpEnabled, setMcpEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    const checkMcpStatus = async () => {
      try {
        const enabled = await isMcpAvailable();
        if (!active) return;
        setMcpEnabled(enabled);
        if (enabled) {
          const count = await getAvailableClientsCount();
          if (active) setCount(count);
        }
      } catch {
        if (active) {
          setMcpEnabled(false);
          setCount(0);
        }
      }
    };
    void checkMcpStatus();
    return () => {
      active = false;
    };
  }, []);

  if (!mcpEnabled) return null;

  return (
    <ChatAction
      onClick={() => navigate(Path.McpMarket)}
      text={`MCP${count ? ` (${count})` : ""}`}
      icon={<McpToolIcon />}
      showLabel
    />
  );
};

export type RenderPrompt = Pick<Prompt, "title" | "content">;

export function PromptHints(props: {
  prompts: RenderPrompt[];
  onPromptSelect: (prompt: RenderPrompt) => void;
  onClose: () => void;
  emptyAction?: () => void;
  onEmptyActionIntent?: (activation: boolean) => void;
}) {
  const noPrompts = props.prompts.length === 0;
  const [selectIndex, setSelectIndex] = useState(0);
  const selectedRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<RenderPrompt | null>(null);
  const { prompts, onPromptSelect, onClose, emptyAction } = props;

  useEffect(() => {
    setSelectIndex(0);
  }, [props.prompts]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectIndex]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (noPrompts && !emptyAction) ||
        preview ||
        e.defaultPrevented ||
        e.isComposing ||
        e.metaKey ||
        e.altKey ||
        e.ctrlKey ||
        (e.target instanceof HTMLElement &&
          e.target.closest('.modal-mask, [role="dialog"], dialog'))
      ) {
        return;
      }
      // arrow up / down to select prompt
      const changeIndex = (delta: number) => {
        e.stopPropagation();
        e.preventDefault();
        const nextIndex = Math.max(
          0,
          Math.min(prompts.length - 1, selectIndex + delta),
        );
        setSelectIndex(nextIndex);
      };

      if (e.key === "ArrowUp") {
        changeIndex(-1);
      } else if (e.key === "ArrowDown") {
        changeIndex(1);
      } else if (e.key === "Enter") {
        if (e.target instanceof HTMLElement && e.target.closest("button"))
          return;
        e.preventDefault();
        e.stopPropagation();
        if (noPrompts) {
          emptyAction?.();
          return;
        }
        const selectedPrompt = prompts.at(selectIndex);
        if (selectedPrompt) {
          onPromptSelect(selectedPrompt);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    prompts,
    onPromptSelect,
    onClose,
    noPrompts,
    selectIndex,
    preview,
    emptyAction,
  ]);

  if (noPrompts && !emptyAction) return null;
  return (
    <>
      <div
        className={styles["prompt-hints"]}
        role="region"
        aria-label={Locale.Chat.InputActions.Prompt}
      >
        {noPrompts && emptyAction && (
          <div className={styles["prompt-hint"]}>
            <button
              type="button"
              className={styles["hint-main"]}
              onClick={emptyAction}
              onPointerEnter={() => props.onEmptyActionIntent?.(false)}
              onFocus={() => props.onEmptyActionIntent?.(false)}
              onPointerDown={() => props.onEmptyActionIntent?.(true)}
            >
              <div className={styles["hint-title"]}>
                {Locale.Settings.Prompt.NoneEnabled}
              </div>
              <div className={styles["hint-content"]}>
                {Locale.Settings.Prompt.OpenSettings}
              </div>
            </button>
          </div>
        )}
        {props.prompts.map((prompt, i) => (
          <div
            ref={i === selectIndex ? selectedRef : null}
            className={clsx(styles["prompt-hint"], {
              [styles["prompt-hint-selected"]]: i === selectIndex,
            })}
            key={prompt.title + i.toString()}
            onMouseEnter={() => setSelectIndex(i)}
          >
            <button
              type="button"
              className={styles["hint-main"]}
              aria-current={i === selectIndex ? "true" : undefined}
              onClick={() => props.onPromptSelect(prompt)}
            >
              <div className={styles["hint-title"]}>{prompt.title}</div>
              <div className={styles["hint-content"]}>{prompt.content}</div>
            </button>
            <button
              type="button"
              className={styles["hint-preview"]}
              title={Locale.Context.Preview}
              aria-label={`${Locale.Context.Preview}: ${prompt.title}`}
              onClick={() => setPreview(prompt)}
            >
              <Eye size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      {preview && (
        <PromptPreview
          title={preview.title}
          content={preview.content}
          onClose={() => setPreview(null)}
          onInsert={() => {
            props.onPromptSelect(preview);
            setPreview(null);
          }}
        />
      )}
    </>
  );
}

function ClearContextDivider() {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();

  return (
    <div
      className={styles["clear-context"]}
      onClick={() =>
        chatStore.updateTargetSession(
          session,
          (session) => (session.clearContextIndex = undefined),
        )
      }
    >
      <div className={styles["clear-context-tips"]}>{Locale.Context.Clear}</div>
      <div className={styles["clear-context-revert-btn"]}>
        {Locale.Context.Revert}
      </div>
    </div>
  );
}

/**
 * 获取消息日期分隔符文本（用于不同天之间的分隔）
 */
function getDateSeparatorLabel(date: Date): string | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - msgDay.getTime()) / 86400000);

  if (diffDays === 0) return null;
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) {
    const weekdays = [
      "星期日",
      "星期一",
      "星期二",
      "星期三",
      "星期四",
      "星期五",
      "星期六",
    ];
    return weekdays[date.getDay()];
  }
  const year = date.getFullYear();
  const nowYear = now.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year === nowYear
    ? `${month}月${day}日`
    : `${year}年${month}月${day}日`;
}

/* ContextMenuState moved to chat-context-menu.tsx */

// TypingTimer moved to chat-modals.tsx

function useScrollToBottom(
  scrollRef: RefObject<HTMLDivElement>,
  isLatestWindow: boolean,
  hasPendingResponse: boolean,
  hasHistory: boolean,
) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [positionReady, setPositionReady] = useState(!hasHistory);
  const following = useRef(true);
  const frame = useRef<number | null>(null);
  const immediateScroll = useRef(true);
  const initialPositioning = useRef(hasHistory);
  const liveOutput = useRef(hasPendingResponse);
  const pendingResponse = useRef(hasPendingResponse);
  pendingResponse.current = hasPendingResponse;
  if (hasPendingResponse) liveOutput.current = true;
  const resumeOnBottom = useRef(false);
  const pendingLatestFollow = useRef(false);
  const wheelRequestsBottom = useRef(false);
  const touchY = useRef<number | null>(null);
  const pointerScrolling = useRef(false);
  const userScrollUntil = useRef(0);
  const lastPosition = useRef({ top: 0, height: 0, viewport: 0, width: 0 });

  useLayoutEffect(() => {
    const dom = scrollRef.current;
    if (dom && initialPositioning.current && following.current)
      dom.scrollTop = dom.scrollHeight;
    if (initialPositioning.current && positionReady) {
      initialPositioning.current = false;
      immediateScroll.current = false;
    }
  });

  useEffect(() => {
    if (!initialPositioning.current) return;
    let previousHeight = -1;
    let stableFrames = 0;
    let pending: number;
    const restore = () => {
      const dom = scrollRef.current;
      if (!dom) return;
      if (following.current) dom.scrollTop = dom.scrollHeight;
      const height = dom.scrollHeight;
      const loading = dom.querySelector("[data-chat-history-loading]");
      stableFrames =
        !loading && height === previousHeight ? stableFrames + 1 : 0;
      previousHeight = height;
      if (
        !following.current ||
        stableFrames >= 2 ||
        (!loading && pendingResponse.current)
      ) {
        setPositionReady(true);
        return;
      }
      pending = requestAnimationFrame(restore);
    };
    pending = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(pending);
  }, [scrollRef]);

  const cancelScroll = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  const pauseFollowing = useCallback(() => {
    following.current = false;
    resumeOnBottom.current = false;
    pendingLatestFollow.current = false;
    wheelRequestsBottom.current = false;
    setAutoScroll(false);
    setShowScrollButton(true);
    cancelScroll();
  }, [cancelScroll]);

  const pauseForInteraction = useCallback(() => {
    userScrollUntil.current = 0;
    pauseFollowing();
  }, [pauseFollowing]);

  const updatePosition = useCallback(() => {
    const dom = scrollRef.current;
    const atBottom = Boolean(
      dom &&
        isLatestWindow &&
        dom.scrollHeight - dom.scrollTop - dom.clientHeight <= 10,
    );
    setShowScrollButton(
      Boolean(
        dom &&
          (!following.current ||
            !isLatestWindow ||
            dom.scrollHeight - dom.scrollTop - dom.clientHeight > 80),
      ),
    );
    return atBottom;
  }, [isLatestWindow, scrollRef]);

  const queueScroll = useCallback(() => {
    if (!following.current) return;
    const dom = scrollRef.current;
    if (!dom) return;
    const outputActive = !!dom.querySelector('[data-output-active="true"]');
    if (!pendingResponse.current && !outputActive) liveOutput.current = false;
    if (
      initialPositioning.current ||
      (!immediateScroll.current && (!liveOutput.current || !outputActive))
    ) {
      cancelScroll();
      dom.scrollTop = dom.scrollHeight;
      immediateScroll.current = false;
      updatePosition();
      return;
    }
    if (frame.current !== null) return;
    let previousTime = performance.now();
    const advance = (time: number) => {
      frame.current = null;
      if (!following.current) return;
      const dom = scrollRef.current;
      if (!dom) return;
      const target = Math.max(0, dom.scrollHeight - dom.clientHeight);
      const distance = target - dom.scrollTop;
      const elapsed = Math.min(32, Math.max(1, time - previousTime));
      previousTime = time;
      if (initialPositioning.current || immediateScroll.current) {
        dom.scrollTop = target;
        immediateScroll.current = false;
      } else if (distance > 1) {
        // Follow a moving stream target without restarting native smooth scroll
        // or jumping an entire paragraph when Markdown changes height.
        const step = Math.min(
          distance,
          Math.max(1, distance * (1 - Math.exp(-elapsed / 120))),
          elapsed * 1.2,
        );
        dom.scrollTop += step;
        frame.current = requestAnimationFrame(advance);
      } else if (distance >= 0) {
        dom.scrollTop = target;
      }
      updatePosition();
    };
    frame.current = requestAnimationFrame(advance);
  }, [cancelScroll, scrollRef, updatePosition]);

  const scrollDomToBottom = useCallback(() => {
    following.current = true;
    pendingLatestFollow.current = false;
    wheelRequestsBottom.current = false;
    setAutoScroll(true);
    cancelScroll();
    immediateScroll.current = true;
    const dom = scrollRef.current;
    if (dom) {
      dom.scrollTop = dom.scrollHeight;
      updatePosition();
    }
    queueScroll();
  }, [cancelScroll, queueScroll, scrollRef, updatePosition]);

  useEffect(() => {
    const dom = scrollRef.current;
    if (!dom) return;
    let active = true;
    let viewportWidth = dom.clientWidth;
    let layoutScrollPending = false;
    const readPosition = () => ({
      top: dom.scrollTop,
      height: dom.scrollHeight,
      viewport: dom.clientHeight,
      width: dom.clientWidth,
    });
    const sidebarResizing = () =>
      !!dom.closest("[data-sidebar-resizing], [data-sidebar-settling]");
    lastPosition.current = readPosition();
    const armUserScroll = () => {
      userScrollUntil.current = performance.now() + 1000;
      wheelRequestsBottom.current = false;
      layoutScrollPending = false;
    };
    const isIsolatedTarget = (target: EventTarget | null) =>
      target instanceof Element &&
      !!target.closest("[data-chat-scroll-isolation]");

    const resumeFollowing = (reachedScrollTarget = false) => {
      if (resumeOnBottom.current && (reachedScrollTarget || updatePosition())) {
        pendingLatestFollow.current = false;
        wheelRequestsBottom.current = false;
        following.current = true;
        setAutoScroll(true);
        queueScroll();
      }
    };
    const handleScroll = () => {
      const position = readPosition();
      const previous = lastPosition.current;
      if (layoutScrollPending || sidebarResizing()) {
        layoutScrollPending = false;
        lastPosition.current = position;
        updatePosition();
        return;
      }
      let movedDown = false;
      // Native touch/scrollbar scrolling may outlast delivered move events.
      // Layout changes alone must never be mistaken for reading upward.
      if (
        position.width === previous.width &&
        (pointerScrolling.current ||
          performance.now() <= userScrollUntil.current)
      ) {
        const sameSize =
          position.height === previous.height &&
          position.viewport === previous.viewport;
        if (sameSize && position.top < previous.top - 1) {
          resumeOnBottom.current = false;
          pauseFollowing();
        } else if (
          position.top > previous.top + 1 &&
          (sameSize || resumeOnBottom.current)
        ) {
          resumeOnBottom.current = true;
          movedDown = true;
        }
      }
      const reachedScrollTarget =
        position.width === previous.width &&
        position.viewport === previous.viewport &&
        (wheelRequestsBottom.current ||
          position.top >=
            Math.max(0, previous.height - previous.viewport) - 10);
      if (
        movedDown &&
        !isLatestWindow &&
        (reachedScrollTarget ||
          position.height - position.viewport - position.top <= 10)
      )
        pendingLatestFollow.current = true;
      lastPosition.current = position;
      updatePosition();
      if (movedDown) resumeFollowing(isLatestWindow && reachedScrollTarget);
      else if (pendingLatestFollow.current) resumeFollowing();
    };
    const handleDisclosureClick = (event: MouseEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      const trigger = event.target.closest(
        "button, summary, a, input, textarea, select, [role='button']",
      );
      if (!trigger || !isIsolatedTarget(trigger)) return;
      const opensButton =
        trigger.matches(
          "button[aria-expanded='false'], button[data-chat-scroll-pause]",
        ) && !trigger.matches(":disabled");
      const opensDetails =
        trigger.tagName === "SUMMARY" &&
        trigger.parentElement instanceof HTMLDetailsElement &&
        !trigger.parentElement.open;
      if (!opensButton && !opensDetails) return;
      // Pause before React or the native disclosure changes its height.
      pauseForInteraction();
    };
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0) return;
      armUserScroll();
      resumeOnBottom.current = event.deltaY > 0;
      // The compositor may reach the requested end before a growing DOM settles.
      if (
        resumeOnBottom.current &&
        event.deltaMode === WheelEvent.DOM_DELTA_PIXEL &&
        event.deltaY >= dom.scrollHeight - dom.clientHeight - dom.scrollTop
      ) {
        wheelRequestsBottom.current = true;
        for (
          let target = event.target instanceof Element ? event.target : null;
          target && target !== dom;
          target = target.parentElement
        ) {
          if (
            target.scrollHeight - target.clientHeight - target.scrollTop > 1 &&
            /^(auto|scroll|overlay)$/.test(getComputedStyle(target).overflowY)
          ) {
            wheelRequestsBottom.current = false;
            break;
          }
        }
      }
      if (!resumeOnBottom.current) pauseFollowing();
      else if (!isIsolatedTarget(event.target)) resumeFollowing();
    };
    const handleTouchStart = (event: TouchEvent) => {
      armUserScroll();
      touchY.current = event.touches[0]?.clientY ?? null;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY;
      if (touchY.current === null || nextY === undefined) return;
      const delta = nextY - touchY.current;
      if (Math.abs(delta) <= 2) return;
      touchY.current = nextY;
      userScrollUntil.current = performance.now() + 1000;
      resumeOnBottom.current = delta < 0;
      if (!resumeOnBottom.current) pauseFollowing();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.defaultPrevented ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest("input, textarea, select") ||
            (event.key === " " &&
              target.closest("button, summary, a[href], [role='button']"))))
      )
        return;
      if (
        ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
        (event.key === " " && event.shiftKey)
      ) {
        armUserScroll();
        resumeOnBottom.current = false;
        pauseFollowing();
      } else if (
        ["ArrowDown", "PageDown", "End"].includes(event.key) ||
        event.key === " "
      ) {
        armUserScroll();
        resumeOnBottom.current = true;
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const rect = dom.getBoundingClientRect();
      const scrollbarWidth = Math.max(12, dom.offsetWidth - dom.clientWidth);
      const isRtl = getComputedStyle(dom).direction === "rtl";
      const onScrollbar = isRtl
        ? event.clientX <= rect.left + scrollbarWidth
        : event.clientX >= rect.right - scrollbarWidth;
      if (event.button === 1 || (event.button === 0 && onScrollbar)) {
        armUserScroll();
        pointerScrolling.current = true;
        resumeOnBottom.current = false;
        pauseFollowing();
      }
    };
    const handlePointerEnd = () => {
      if (!pointerScrolling.current) return;
      pointerScrolling.current = false;
      userScrollUntil.current = performance.now() + 1000;
    };
    const handleResize = () => {
      if (!active) return;
      const position = readPosition();
      const widthChanged = position.width !== viewportWidth;
      viewportWidth = position.width;
      dom.style.setProperty(
        "--chat-image-max-height",
        `${Math.max(64, dom.clientHeight - 160)}px`,
      );
      if (widthChanged || sidebarResizing()) {
        cancelScroll();
        layoutScrollPending = true;
        // Reflow keeps its anchor before paint instead of chasing a moving end.
        if (following.current && isLatestWindow)
          dom.scrollTop = dom.scrollHeight - dom.clientHeight;
        lastPosition.current = readPosition();
        updatePosition();
        return;
      }
      // Keep idle geometry fresh without swallowing a pending native scroll.
      if (position.top === lastPosition.current.top)
        lastPosition.current = position;
      updatePosition();
      // A new history window can grow temporarily before settling at its end.
      if (pendingLatestFollow.current) resumeFollowing();
      queueScroll();
    };

    // Observe message sizes as well as the viewport: streaming keeps the same
    // message count, and Markdown or images can resize after React commits.
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(dom);
    for (const child of Array.from(dom.children)) {
      resizeObserver.observe(child, { box: "border-box" });
    }
    const mutationObserver = new MutationObserver((records) => {
      if (!active) return;
      for (const record of records) {
        for (const child of Array.from(record.removedNodes)) {
          if (child instanceof Element) resizeObserver.unobserve(child);
        }
        for (const child of Array.from(record.addedNodes)) {
          if (child instanceof Element) {
            resizeObserver.observe(child, { box: "border-box" });
          }
        }
      }
      handleResize();
    });
    mutationObserver.observe(dom, { childList: true });
    // Network completion can precede the last visible typewriter frame.
    // Settle any remaining scroll distance when the visible output finishes.
    const outputObserver = new MutationObserver(handleResize);
    outputObserver.observe(dom, {
      attributes: true,
      attributeFilter: ["data-output-active"],
      subtree: true,
    });
    dom.addEventListener("click", handleDisclosureClick, true);
    dom.addEventListener("scroll", handleScroll, { passive: true });
    dom.addEventListener("wheel", handleWheel, { passive: true });
    dom.addEventListener("touchstart", handleTouchStart, { passive: true });
    dom.addEventListener("touchmove", handleTouchMove, { passive: true });
    dom.addEventListener("keydown", handleKeyDown);
    dom.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    window.addEventListener("blur", handlePointerEnd);
    handleResize();

    return () => {
      active = false;
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      outputObserver.disconnect();
      dom.removeEventListener("click", handleDisclosureClick, true);
      dom.removeEventListener("scroll", handleScroll);
      dom.removeEventListener("wheel", handleWheel);
      dom.removeEventListener("touchstart", handleTouchStart);
      dom.removeEventListener("touchmove", handleTouchMove);
      dom.removeEventListener("keydown", handleKeyDown);
      dom.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
      window.removeEventListener("blur", handlePointerEnd);
      cancelScroll();
    };
  }, [
    cancelScroll,
    isLatestWindow,
    pauseFollowing,
    pauseForInteraction,
    queueScroll,
    scrollRef,
    updatePosition,
  ]);

  return {
    autoScroll,
    positionReady,
    showScrollButton,
    scrollDomToBottom,
    pauseFollowing: pauseForInteraction,
  };
}

export function ChatActions(props: {
  uploading: boolean;
  handleFileUpload: () => void;
  onSkillOpen: () => void;
  onComposerActionComplete: () => void;
  isImageSkill: boolean;
  referenceCount: number;
  children?: React.ReactNode;
}) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();

  // switch model
  const currentModel = session.mask.modelConfig.model;
  const currentProviderName =
    session.mask.modelConfig?.providerName || "OpenAI";
  const capabilities = useModelCapabilities(currentModel, currentProviderName);
  const customApiMode = useAccessStore((state) => state.customApiMode);
  const videoActions = capabilities.category === "video";
  const imageActions = shouldUseImageGenerationApi(session.mask.modelConfig, {
    capabilities,
    customImageMode:
      currentProviderName === CUSTOM_MODEL_PROVIDER && customApiMode !== "auto",
  });
  const allModels = useAllModels();
  const accountMode = useAccessStore(isAccountModelMode);
  const customMode = currentProviderName === CUSTOM_MODEL_PROVIDER;
  const modelListStatus = useAccessStore((state) => state.modelListStatus);
  const switchingToken = useAccessStore((state) => state.switchingToken);
  const models = useMemo(() => {
    const filteredModels = allModels.filter((m) => m.available);
    const defaultModel = filteredModels.find((m) => m.isDefault);

    if (defaultModel) {
      const arr = [
        defaultModel,
        ...filteredModels.filter((m) => m !== defaultModel),
      ];
      return arr;
    } else {
      return filteredModels;
    }
  }, [allModels]);
  const currentModelName = useMemo(() => {
    const model = models.find(
      (m) =>
        m.name == currentModel &&
        m?.provider?.providerName == currentProviderName,
    );
    return model?.displayName ?? "";
  }, [models, currentModel, currentProviderName]);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const modelPickerId = useId();
  const focusModelPickerTrigger = useCallback(() => {
    modelTriggerRef.current?.focus({ preventScroll: true });
  }, []);
  const modelPicker = useChatModelPicker(models, focusModelPickerTrigger);

  const [activeParameter, setActiveParameter] = useState<
    "reasoning" | "image" | "video" | null
  >(null);
  const imageParameterId = useId();
  const [imageParamsVersion, setImageParamsVersion] = useState(0);
  const imageTriggerRef = useRef<HTMLDivElement>(null);
  const showImageParams = activeParameter === "image" && imageActions;
  const onComposerActionComplete = props.onComposerActionComplete;
  const previousParameter = useRef(activeParameter);
  useEffect(() => {
    if (previousParameter.current && !activeParameter)
      onComposerActionComplete();
    previousParameter.current = activeParameter;
  }, [activeParameter, onComposerActionComplete]);

  const [asyncTaskStatus, setAsyncTaskStatus] = useState<
    "idle" | "pending" | "success" | "failed" | "cancelled"
  >("idle");
  const [asyncTaskProgress, setAsyncTaskProgress] = useState(0);
  const [asyncTaskError, setAsyncTaskError] = useState<string | null>(null);

  const currentSize = imageRatio(session.mask.modelConfig?.size);
  const currentResolution = imageResolution(
    session.mask.modelConfig?.resolution,
  );
  const currentQuality = imageQuality(session.mask.modelConfig?.quality);
  const fixedImageSize = usesFixedImageSizes(currentModel);
  const requestImageSize = imageRequestSize(
    session.mask.modelConfig?.size,
    currentResolution,
    currentModel,
  );
  const requestSizeHelp = (
    <span aria-label="请求尺寸">
      请求尺寸：
      {requestImageSize === "auto"
        ? "由模型决定"
        : requestImageSize.replace("x", " × ")}
      {fixedImageSize
        ? " · 该模型使用固定尺寸，比例按横竖方向适配"
        : currentSize === "21:9"
        ? " · 比例按模型尺寸要求近似规整"
        : ""}
    </span>
  );

  const isMobileScreen = useMobileScreen();
  const ratioLabel =
    currentSize === "auto"
      ? currentResolution === "auto" || fixedImageSize
        ? "自动"
        : "自动（1:1）"
      : currentSize;
  const resolutionLabel = fixedImageSize
    ? "模型固定"
    : currentResolution === "auto"
    ? currentSize === "auto"
      ? "自动"
      : "自动（1K）"
    : currentResolution.toUpperCase();
  const qualityLabel = currentQuality === "auto" ? "自动" : currentQuality;
  const imageSummary =
    currentSize === "auto" &&
    currentResolution === "auto" &&
    currentQuality === "auto"
      ? "自动"
      : [ratioLabel, resolutionLabel, qualityLabel].join(" · ");
  const closeImageParams = (restoreFocus = true) => {
    setActiveParameter((active) => (active === "image" ? null : active));
    if (restoreFocus)
      imageTriggerRef.current?.querySelector("button")?.focus({
        preventScroll: true,
      });
  };

  useEffect(() => {
    setActiveParameter(null);
  }, [
    session.id,
    currentModel,
    currentProviderName,
    imageActions,
    videoActions,
  ]);

  const clearContext = () => {
    chatStore.updateTargetSession(session, (session) => {
      if (session.clearContextIndex === session.messages.length) {
        session.clearContextIndex = undefined;
      } else {
        session.clearContextIndex = session.messages.length;
        session.memoryPrompt = "";
      }
    });
  };
  const onModelGroupChange = () => {
    const access = useAccessStore.getState();
    const store = useChatStore.getState();
    const active = store.currentSession();
    const selected = active.mask.modelConfig;
    if (
      !isAccountModelMode(access) ||
      access.modelListStatus !== "ready" ||
      active.id !== session.id ||
      selected.model !== currentModel ||
      (selected.providerName || "OpenAI") !== currentProviderName ||
      selected.providerName === CUSTOM_MODEL_PROVIDER
    ) {
      return;
    }
    const available = collectModelsWithDefaultModel(
      useAppConfig.getState().models,
      "",
      access.defaultModel,
    ).filter(
      (model) =>
        model.available &&
        model.provider?.providerName !== CUSTOM_MODEL_PROVIDER,
    );
    if (
      available.some(
        (model) =>
          model.name === selected.model &&
          model.provider?.providerName === selected.providerName,
      )
    ) {
      return;
    }
    const nextModel =
      available.find((model) => model.isDefault) || available[0];
    if (!nextModel) return;
    store.updateTargetSession(active, (target) => {
      target.mask.modelConfig.model = nextModel.name;
      target.mask.modelConfig.providerName =
        nextModel.provider?.providerName || "";
      target.mask.syncGlobalConfig = false;
    });
  };
  useWorkspaceActions({
    model: modelPicker.openAll,
    skills: () =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="composer-skills"]',
        )
        ?.click(),
    "clear-context": clearContext,
  });

  useEffect(() => {
    // Initialize default sessions without rewriting a saved model choice.
    if (session.creationKind && !currentModel) return;
    if (session.mask.syncGlobalConfig !== true && currentModel) return;
    const isUnavailableModel = !models.some(
      (m) =>
        m.name === currentModel &&
        m.provider?.providerName === currentProviderName,
    );
    const sameSourceModels = models.filter(
      (m) =>
        (m.provider?.providerName === CUSTOM_MODEL_PROVIDER) === customMode,
    );
    if (accountMode && !customMode) {
      if (switchingToken || modelListStatus !== "ready") return;
      if (isUnavailableModel && (currentModel || models.length > 0)) {
        const nextModel = sameSourceModels[0];
        if (!nextModel) return;
        chatStore.updateTargetSession(session, (session) => {
          session.mask.modelConfig.model = nextModel?.name || "";
          session.mask.modelConfig.providerName =
            nextModel?.provider?.providerName || "";
          session.mask.syncGlobalConfig = false;
        });
      }
      return;
    }
    if (isUnavailableModel && sameSourceModels.length > 0) {
      // show next model to default model if exist
      let nextModel =
        sameSourceModels.find((model) => model.isDefault) ||
        sameSourceModels[0];
      chatStore.updateTargetSession(session, (session) => {
        session.mask.modelConfig.model = nextModel.name;
        session.mask.modelConfig.providerName = nextModel?.provider
          ?.providerName as string;
        session.mask.syncGlobalConfig = false;
      });
      showToast(
        nextModel?.provider?.providerName == "ByteDance"
          ? nextModel.displayName
          : nextModel.name,
      );
    }
  }, [
    chatStore,
    currentModel,
    currentProviderName,
    customMode,
    models,
    session,
    accountMode,
    modelListStatus,
    switchingToken,
  ]);

  const resetImageParams = () => {
    setImageParamsVersion((version) => version + 1);
    chatStore.updateTargetSession(session, (target) => {
      Object.assign(target.mask.modelConfig, {
        size: "auto",
        resolution: "auto",
        quality: "auto",
        imageOutputFormat: "png",
        imageBackground: "auto",
        imageOutputCompression: 100,
      });
      target.mask.syncGlobalConfig = false;
    });
  };

  const imageParameterContent = (
    <ImageParameterControls
      key={imageParamsVersion}
      active={showImageParams}
      showHeading={!isMobileScreen}
      ratio={currentSize}
      ratioLabel={ratioLabel}
      resolution={currentResolution}
      resolutionLabel={resolutionLabel}
      quality={currentQuality}
      fixedSize={fixedImageSize}
      onRatioChange={(value) =>
        chatStore.updateTargetSession(session, (target) => {
          target.mask.modelConfig.size = value;
          target.mask.syncGlobalConfig = false;
        })
      }
      onResolutionChange={(value) =>
        chatStore.updateTargetSession(session, (target) => {
          target.mask.modelConfig.resolution = value;
          target.mask.syncGlobalConfig = false;
        })
      }
      onQualityChange={(value) =>
        chatStore.updateTargetSession(session, (target) => {
          target.mask.modelConfig.quality = value;
          target.mask.syncGlobalConfig = false;
        })
      }
      onReset={resetImageParams}
    >
      {supportsImageOutputOptions(currentModel) ? (
        <ImageOutputControls requestSizeHelp={requestSizeHelp} />
      ) : (
        <div className={styles["image-param-help"]}>{requestSizeHelp}</div>
      )}
    </ImageParameterControls>
  );

  return (
    <div
      className={clsx(styles["chat-input-actions"], styles["composer-toolbar"])}
    >
      <div className={styles["chat-input-actions-start"]}>
        <ChatAction
          onClick={props.handleFileUpload}
          text={Locale.Chat.InputActions.UploadFile}
          icon={props.uploading ? <LoadingButtonIcon /> : <Plus />}
          busy={props.uploading}
        />
        {!props.isImageSkill && capabilities.category !== "video" && (
          <WebSearchAction sessionId={session.id} onOpen={props.onSkillOpen} />
        )}
        <SkillPicker
          sessionId={session.id}
          isImage={props.isImageSkill}
          onOpen={props.onSkillOpen}
        />
        <ChatAction
          text={Locale.Chat.InputActions.Clear}
          icon={<Eraser />}
          selected={session.clearContextIndex === session.messages.length}
          onClick={() => {
            clearContext();
            onComposerActionComplete();
          }}
        />
      </div>
      <div className={styles["chat-input-actions-end"]}>
        {!isMobileScreen && <MCPAction />}
        <div className={styles["chat-input-model-action"]}>
          <ModelEffortControl
            key={session.id}
            open={activeParameter === "reasoning"}
            onOpenChange={(open) =>
              setActiveParameter((active) =>
                open ? "reasoning" : active === "reasoning" ? null : active,
              )
            }
            mobile={isMobileScreen}
            triggerRef={modelTriggerRef}
            onSelectModel={modelPicker.openAll}
            modelPickerId={modelPickerId}
            modelConfig={session.mask.modelConfig}
            showReasoning={
              !imageActions &&
              capabilities.category !== "image" &&
              capabilities.category !== "video"
            }
            updateConfig={(updater) =>
              chatStore.updateTargetSession(session, (target) => {
                updater(target.mask.modelConfig);
                target.mask.syncGlobalConfig = false;
              })
            }
            modelLabel={
              (customMode ? "自定义 · " : "") +
              (currentModelName ||
                currentModel ||
                Locale.Settings.ModelPicker.Title)
            }
            modelTitle={`${Locale.Settings.ModelPicker.Title}: ${
              currentModelName ||
              currentModel ||
              Locale.Settings.ModelPicker.NotSelected
            }`}
          />
        </div>

        <SelectionDialog
          id={modelPickerId}
          open={modelPicker.open}
          title={
            modelPicker.imageOnly
              ? "选择生图模型"
              : Locale.Settings.ModelPicker.Title
          }
          onClose={modelPicker.close}
        >
          <ModelSelect
            models={modelPicker.models}
            value={`${currentModel}@${currentProviderName}`}
            embedded
            onGroupChange={onModelGroupChange}
            onChange={(val) => {
              const [model, providerName] = getModelProvider(val);
              chatStore.updateTargetSession(session, (session) => {
                session.mask.modelConfig.model = model as ModelType;
                session.mask.modelConfig.providerName = providerName as string;
                session.mask.syncGlobalConfig = false;
              });
              modelPicker.close();
              showToast(model);
            }}
          />
        </SelectionDialog>

        {imageActions && (
          <div
            ref={imageTriggerRef}
            className={styles["chat-input-auxiliary-action"]}
          >
            <ChatAction
              onClick={() =>
                setActiveParameter(showImageParams ? null : "image")
              }
              text={`生图参数 · ${imageSummary}`}
              title={`生图参数：比例 ${ratioLabel}，分辨率 ${resolutionLabel}，画质 ${qualityLabel}`}
              icon={<Settings2 />}
              selected={showImageParams}
              expanded={showImageParams}
              controls={imageParameterId}
            />
          </div>
        )}
        {videoActions && (
          <ChatVideoParameters
            key={`${session.id}:${currentModel}@${currentProviderName}`}
            open={activeParameter === "video"}
            onOpenChange={(open) =>
              setActiveParameter((active) =>
                open ? "video" : active === "video" ? null : active,
              )
            }
            referenceCount={props.referenceCount}
          />
        )}
      </div>
      {props.children}
      <ComposerParameterPopover
        id={imageParameterId}
        label="生图参数"
        smoothResize
        open={showImageParams && !isMobileScreen}
        triggerRef={imageTriggerRef}
        initialFocus="button[aria-label^='比例']"
        onClose={(reason) => closeImageParams(reason === "escape")}
      >
        {imageParameterContent}
      </ComposerParameterPopover>
      <SelectionDialog
        key={`${session.id}:${currentModel}@${currentProviderName}`}
        id={imageParameterId}
        title="生图参数"
        compact
        smoothResize
        headerActions={
          <button type="button" onClick={resetImageParams}>
            重置
          </button>
        }
        open={showImageParams && isMobileScreen}
        onClose={() =>
          setActiveParameter((active) => (active === "image" ? null : active))
        }
      >
        {imageParameterContent}
      </SelectionDialog>
      {asyncTaskStatus === "pending" && (
        <div className={styles["async-task-progress"]}>
          <div className={styles["async-task-info"]}>
            <LoadingIcon className={styles["async-task-spinner"]} />
            <span>正在生成图片... {asyncTaskProgress}%</span>
          </div>
          <div className={styles["async-task-bar"]}>
            <div
              className={styles["async-task-bar-fill"]}
              style={{ width: `${asyncTaskProgress}%` }}
            />
          </div>
          <button
            className={styles["async-task-cancel"]}
            onClick={() => {
              asyncTaskManager.cancel();
              setAsyncTaskStatus("idle");
              setAsyncTaskProgress(0);
              showToast("已取消生图任务");
            }}
          >
            取消
          </button>
        </div>
      )}
      {asyncTaskStatus === "failed" && asyncTaskError && (
        <div className={styles["async-task-error"]}>
          <span>{asyncTaskError}</span>
          <button
            className={styles["async-task-retry"]}
            onClick={() => {
              setAsyncTaskStatus("idle");
              setAsyncTaskError(null);
            }}
          >
            重试
          </button>
        </div>
      )}
    </div>
  );
}

// EditMessageModal moved to chat-modals.tsx
// DeleteImageButton moved to chat-modals.tsx

type ChatSessionState = ReturnType<
  typeof useChatStore.getState
>["sessions"][number];
type RenderMessage = ChatMessage & { preview?: boolean };
type ChatHistoryView = {
  nodes: React.ReactNode[];
  renderMessage: (message: RenderMessage, index: number) => React.ReactNode;
  previewIndex: number;
};

function ChatMessageHistory({
  view,
  preview,
}: {
  view: ChatHistoryView;
  preview?: RenderMessage;
}) {
  return (
    <>
      {view.nodes}
      {preview && view.previewIndex >= 0
        ? view.renderMessage(preview, view.previewIndex)
        : null}
    </>
  );
}

function activeChatSession(state: ReturnType<typeof useChatStore.getState>) {
  const index = Number.isInteger(state.currentSessionIndex)
    ? Math.max(
        0,
        Math.min(state.currentSessionIndex, state.sessions.length - 1),
      )
    : 0;
  return state.sessions[index] as ChatSessionState | undefined;
}

function ChatSession({ embedded = false }: { embedded?: boolean }) {
  const [selectedSession] = useChatStore((state) => {
    const current = activeChatSession(state);
    return [current, current?.messages] as const;
  }, shallow);
  const session = selectedSession ?? useChatStore.getState().currentSession();
  const chatStore = useChatStore(
    (state) => ({
      newSession: state.newSession,
      nextSession: state.nextSession,
      forkSession: state.forkSession,
      deleteSession: state.deleteSession,
      updateTargetSession: state.updateTargetSession,
      setLastInput: state.setLastInput,
      onUserInput: state.onUserInput,
      deleteMessage: state.deleteMessage,
      retryPreparedMaterials: state.retryPreparedMaterials,
      retryMessage: state.retryMessage,
      editMessage: state.editMessage,
      submitMessageOptions: state.submitMessageOptions,
      getMessageBranches: state.getMessageBranches,
      saveGeneratedImage: state.saveGeneratedImage,
      selectMessageBranch: state.selectMessageBranch,
      summarizeSession: state.summarizeSession,
    }),
    shallow,
  );
  const hasPendingResponse = useSyncExternalStore(
    ChatControllerPool.subscribe,
    () => ChatControllerPool.hasPending(session.id),
    () => false,
  );
  const config = useAppConfig(
    (state) => ({
      fontSize: state.fontSize,
      fontFamily: state.fontFamily,
      speechVoiceURI: state.speechVoiceURI,
      speechRate: state.speechRate,
      sendPreviewBubble: state.sendPreviewBubble,
      disablePromptHint: state.disablePromptHint,
      avatar: state.avatar,
      tightBorder: state.tightBorder,
      update: state.update,
    }),
    shallow,
  );
  const fontSize = config.fontSize;
  const fontFamily = config.fontFamily;
  const reader = useReadAloud({
    voiceURI: config.speechVoiceURI,
    rate: config.speechRate,
    lang: getLang() === "cn" ? "zh-CN" : "en-US",
  });
  useEffect(() => {
    if (reader.error) showToast(reader.error);
  }, [reader.error]);

  const [showExport, setShowExport] = useState(false);
  const [headerActionsTarget, setHeaderActionsTarget] =
    useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setHeaderActionsTarget(
      document.querySelector<HTMLElement>("[data-workspace-chat-actions]"),
    );
  }, []);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [userInput, setUserInput] = useState("");
  const [draftQuote, setDraftQuote] = useState<MessageQuote>();
  const draftQuoteRef = useRef(draftQuote);
  const [quoteDraftKey] = useState(() =>
    localKey(`${UNFINISHED_INPUT(session.id)}:quote`),
  );
  const [editingMessageId, setEditingMessageId] = useState<string>();
  const updateDraftQuote = useCallback(
    (quote?: MessageQuote) => {
      draftQuoteRef.current = quote;
      setDraftQuote(quote);
      if (quote) localStorage.setItem(quoteDraftKey, JSON.stringify(quote));
      else localStorage.removeItem(quoteDraftKey);
    },
    [quoteDraftKey],
  );
  const onQuoteSelected = useCallback(
    (quote: MessageQuote) => {
      const current = useChatStore.getState().currentSession();
      if (
        current.id !== session.id ||
        !current.messages.some((message) => message.id === quote.messageId)
      )
        return;
      updateDraftQuote(quote);
      window.getSelection()?.removeAllRanges();
      inputRef.current?.focus();
    },
    [session.id, updateDraftQuote],
  );
  useEffect(() => {
    if (
      editingMessageId &&
      !session.messages.some((message) => message.id === editingMessageId)
    )
      setEditingMessageId(undefined);
  }, [editingMessageId, session.messages]);
  // Markdown preview work must not delay committing the controlled draft.
  const deferredInput = useDeferredValue(
    config.sendPreviewBubble ? userInput : "",
  );
  const previewInput =
    config.sendPreviewBubble && userInput.length > 0 ? deferredInput : "";
  const hasPreviewInput = previewInput.length > 0;
  const previewMessages = useMemo(
    () => ({
      user: createMessage({ role: "user" }),
      assistant: createMessage({ role: "assistant" }),
    }),
    [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const submittedTurnRef = useRef<{
    sessionId: string;
    lastMessageId?: string;
  }>();
  const {
    submitKey,
    shouldSubmit,
    isImeKey,
    onCompositionStart,
    onCompositionEnd,
    onKeyUp,
  } = useSubmitHandler();
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollbarActivity(scrollRef);
  const scrollRafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(
    null,
  );

  // 组件卸载时清理 rAF
  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);
  const isMobileScreen = useMobileScreen();
  const navigate = useNavigate();
  const location = useLocation();
  const createMaterialDraft = (initial?: {
    images: string[];
    files: ParsedFile[];
  }) =>
    createMaterialUpload(
      {
        loadImage: uploadImageRemote,
        loadFile: parseFile,
        imageLimitError: Locale.Chat.InputActions.ImageLimit,
      },
      initial,
    );
  const [materialDraft, setMaterialDraft] = useState(createMaterialDraft);
  const materialDraftRef = useRef(materialDraft);
  materialDraftRef.current = materialDraft;
  const submittedDraftRef = useRef<MaterialPreparation | null>(null);
  const materials = useSyncExternalStore(
    materialDraft.subscribe,
    materialDraft.getSnapshot,
    materialDraft.getSnapshot,
  );
  const attachImages = useMemo(
    () => materials.images.map((image) => image.url),
    [materials],
  );
  const attachFiles = useMemo(
    () => materials.files.map((entry) => entry.file),
    [materials],
  );
  const uploading = materials.pending > 0;
  const hasDraft = userInput.trim().length > 0 || materials.items.length > 0;
  const showStop = hasPendingResponse && !hasDraft;
  const isLocalPreview =
    isLocalPreviewModel(session.mask.modelConfig.providerName) &&
    isLocalPreviewEnabled();
  const remixDraftRef = useRef({
    input: userInput,
    sessionId: session.id,
    material: materialDraft,
  });
  remixDraftRef.current = {
    input: userInput,
    sessionId: session.id,
    material: materialDraft,
  };
  const remixModels = useAllModels();
  const remixModelStatus = useAccessStore((state) => state.modelListStatus);
  useCommunityRemix("chat", remixModelStatus, async (work, check) => {
    const model = resolveCommunityRemixModel(work, remixModels);
    const workspace = findCommunityWorkspace(work.kind);
    const targetDraftKey =
      workspace && workspace.id !== session.id
        ? localKey(UNFINISHED_INPUT(workspace.id))
        : undefined;
    const savedTargetDraft = targetDraftKey
      ? localStorage.getItem(targetDraftKey)
      : null;
    if (
      (hasDraft || savedTargetDraft?.trim()) &&
      !(await showConfirm("填入同款会替换制作工作区输入框中的草稿，是否继续？"))
    )
      throw new Error("已保留当前草稿；准备好后可重试填入。");
    const before = remixDraftRef.current;
    const beforeMaterials = before.material.getSnapshot();
    const unchanged = () => {
      check();
      const current = remixDraftRef.current;
      if (
        current.input !== before.input ||
        current.sessionId !== before.sessionId ||
        current.material !== before.material ||
        current.material.getSnapshot() !== beforeMaterials
      )
        throw new Error("草稿或会话已变化，已保留当前内容，请重试填入。");
    };
    unchanged();
    const images = await remixImages(work, unchanged);
    unchanged();
    if (
      targetDraftKey &&
      localStorage.getItem(targetDraftKey) !== savedTargetDraft
    )
      throw new Error("工作区草稿已变化，请重试填入。");
    const target = await startCommunityChat(
      { id: work.requestId, kind: work.kind, model: model.model },
      remixModels,
    );
    const store = useChatStore.getState();
    store.updateTargetSession(target, (active) => {
      active.creationKind = work.kind;
      active.activeSkillId = undefined;
      active.mask.context = [];
      active.mask.modelConfig.model = model.model;
      active.mask.modelConfig.providerName = model.providerName;
      active.mask.modelConfig.template = DEFAULT_INPUT_TEMPLATE;
      active.mask.syncGlobalConfig = false;
      active.remixSourceWorkId = work.sourceWorkId;
    });
    return { sessionId: target.id, images };
  });
  useCommunityRemixDraft(
    session.id,
    userInput,
    attachImages,
    (work, images) => {
      updateDraftQuote(undefined);
      setUserInput(work.prompt);
      setMaterialDraft(createMaterialDraft({ images, files: [] }));
      inputRef.current?.focus();
    },
  );
  const attachmentsActiveRef = useRef(true);
  useEffect(() => {
    attachmentsActiveRef.current = true;
    return () => {
      attachmentsActiveRef.current = false;
    };
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { restoreAfterAction, ...composerFocus } = useComposerFocus(
    inputRef,
    fileInputRef,
    isMobileScreen,
    scrollRef,
  );
  const handleFileUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  const voiceInput = useVoiceInput({ lang: "zh-CN" });
  useEffect(() => {
    if (voiceInput.error) showToast(voiceInput.error);
  }, [voiceInput.error]);
  const { transcript: voiceTranscript, reset: resetVoiceInput } = voiceInput;
  useEffect(() => {
    if (voiceTranscript) {
      setUserInput((prev) => prev + voiceTranscript);
      resetVoiceInput();
    }
  }, [voiceTranscript, resetVoiceInput]);

  // prompt hints
  const SEARCH_TEXT_LIMIT = 30;
  const promptStore = usePromptStore(
    (state) => ({
      enabledPromptIds: state.enabledPromptIds,
      counter: state.counter,
    }),
    shallow,
  );
  const [promptHints, setPromptHints] = useState<RenderPrompt[]>([]);
  const [promptHintsDismissed, setPromptHintsDismissed] = useState(false);
  const onSearch = useDebouncedCallback(
    (text: string) => {
      void loadBuiltinPrompts();
      const matchedPrompts = usePromptStore.getState().search(text, true);
      setPromptHints(matchedPrompts);
    },
    100,
    { leading: true, trailing: true },
  );

  useEffect(() => {
    if (
      userInput.startsWith("/") &&
      userInput.trim().length < SEARCH_TEXT_LIMIT &&
      !config.disablePromptHint &&
      !promptHintsDismissed
    ) {
      void loadBuiltinPrompts();
      setPromptHints(
        usePromptStore.getState().search(userInput.slice(1), true),
      );
    }
  }, [
    promptStore.enabledPromptIds,
    promptStore.counter,
    userInput,
    config.disablePromptHint,
    promptHintsDismissed,
  ]);
  const showNoEnabledPrompts =
    userInput.startsWith("/") &&
    userInput.trim().length < SEARCH_TEXT_LIMIT &&
    !config.disablePromptHint &&
    !promptHintsDismissed &&
    usePromptStore.getState().search("", true).length === 0;

  useEffect(() => {
    if (!location.state?.showPromptHints) return;
    setUserInput("/");
    onSearch("");
    inputRef.current?.focus();
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate, onSearch]);

  // auto grow input
  const [inputRows, setInputRows] = useState(1);
  const hasMeasuredInput = useRef(false);
  const measure = useDebouncedCallback(
    (contentWidth?: number) => {
      const input = inputRef.current;
      const rows = input ? autoGrowTextArea(input, contentWidth) : 1;
      if (input) hasMeasuredInput.current = true;
      const inputRows = Math.min(20, Math.max(1, rows));
      setInputRows(inputRows);
    },
    100,
    {
      leading: true,
      trailing: true,
    },
  );

  useEffect(() => {
    // Warm empty input after native layout; typed text still measures immediately.
    if (
      userInput.length > 0 ||
      hasMeasuredInput.current ||
      typeof ResizeObserver === "undefined"
    ) {
      measure();
    }
  }, [userInput, config.fontFamily, measure]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    if (typeof ResizeObserver === "undefined") return () => measure.cancel();
    let width: number | undefined;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth === undefined || nextWidth === width) return;
      const firstSize = width === undefined;
      width = nextWidth;
      if (!firstSize || !hasMeasuredInput.current) measure(nextWidth);
    });
    observer.observe(input);
    return () => {
      observer.disconnect();
      measure.cancel();
    };
  }, [measure]);

  // chat commands shortcuts
  const chatCommands = useChatCommand({
    new: () => chatStore.newSession(),
    newm: () => navigate(Path.NewChat),
    prev: () => chatStore.nextSession(-1),
    next: () => chatStore.nextSession(1),
    clear: () =>
      chatStore.updateTargetSession(
        session,
        (session) => (session.clearContextIndex = session.messages.length),
      ),
    fork: () => chatStore.forkSession(),
    del: () =>
      chatStore.deleteSession(useChatStore.getState().currentSessionIndex),
  });

  // only search prompts when user input is short
  const onInput = (text: string) => {
    onSearch.cancel();
    setPromptHintsDismissed(false);
    setUserInput(text);
    const n = text.trim().length;

    // clear search results
    if (n === 0) {
      setPromptHints([]);
    } else if (text.match(ChatCommandPrefix)) {
      setPromptHints(chatCommands.search(text));
    } else if (!config.disablePromptHint && n < SEARCH_TEXT_LIMIT) {
      // check if need to trigger auto completion
      if (text.startsWith("/")) {
        let searchText = text.slice(1);
        onSearch(searchText);
      } else {
        setPromptHints([]);
      }
    } else {
      setPromptHints([]);
    }
  };

  const checkModelAvailability = () => {
    if (isLocalPreviewModel(session.mask.modelConfig.providerName)) {
      if (isLocalPreviewEnabled()) return true;
      showToast(LOCAL_PREVIEW_MESSAGE);
      return false;
    }
    const access = useAccessStore.getState();
    if (usesCustomProvider(access, session.mask.modelConfig.providerName)) {
      if (
        !access.useCustomConfig ||
        !access.customModelNames
          .split(/[,\n]/)
          .some((name) => name.trim() === session.mask.modelConfig.model)
      ) {
        showToast(Locale.Account.NoAvailableModel);
        return false;
      }
      return true;
    }
    if (
      isAccountModelMode(access) &&
      (access.switchingToken || access.modelListStatus !== "ready")
    ) {
      showToast(
        access.modelListStatus === "error"
          ? Locale.Settings.ModelSource.ModelsFailed
          : Locale.Settings.ModelSource.ModelsLoading,
      );
      return false;
    }
    if (
      isAccountModelMode(useAccessStore.getState()) &&
      !useAppConfig
        .getState()
        .models.some(
          (model) =>
            model.available && model.name === session.mask.modelConfig.model,
        )
    ) {
      showToast(Locale.Account.NoAvailableModel);
      return false;
    }
    return true;
  };

  const doSubmit = (userInput: string) => {
    if (submittedDraftRef.current === materialDraft) return;
    const snapshot = materialDraft.getSnapshot();
    if (userInput.trim() === "" && snapshot.items.length === 0) return;
    if (!checkModelAvailability()) return;
    const images = snapshot.images.map((image) => image.url);
    const files = snapshot.files.map((entry) => entry.file);
    if (capabilities.category === "video" && snapshot.pending === 0) {
      try {
        chatVideoDraft(
          formatQuoteInput(userInput, draftQuoteRef.current),
          session.mask.modelConfig.model,
          session.mask.modelConfig.providerName,
          images,
          session.remixSourceWorkId,
          session.mask.modelConfig.videoConfig,
          files,
        );
      } catch (error) {
        showToast(error instanceof Error ? error.message : "视频参数无效");
        return;
      }
    }
    let finalInput = formatQuoteInput(userInput, draftQuoteRef.current);
    if (files.length > 0) {
      finalInput = formatFileContent(files) + "\n\n" + finalInput;
    }
    if (isImageComposer && snapshot.pending === 0) {
      try {
        validateImagePrompt(
          images.length
            ? finalInput
            : fillTemplateWith(finalInput, session.mask.modelConfig),
        );
      } catch (error) {
        showToast((error as Error).message);
        return;
      }
    }
    const matchCommand = chatCommands.match(finalInput);
    if (
      matchCommand.matched &&
      snapshot.items.length === 0 &&
      !draftQuoteRef.current
    ) {
      setUserInput("");
      setPromptHints([]);
      setPromptHintsDismissed(true);
      matchCommand.invoke();
      return;
    }
    submittedDraftRef.current = materialDraft;
    const submittedTurn = {
      sessionId: session.id,
      lastMessageId: session.messages.at(-1)?.id,
    };
    submittedTurnRef.current = submittedTurn;
    setIsLoading(true);
    chatStore
      .onUserInput(
        finalInput,
        images,
        false,
        {
          text: userInput,
          files: files.map((file) => ({ ...file })),
          quote: draftQuoteRef.current,
        },
        undefined,
        snapshot.items.length > 0 ? materialDraft : undefined,
      )
      .finally(() => {
        if (submittedTurnRef.current !== submittedTurn) return;
        submittedTurnRef.current = undefined;
        if (attachmentsActiveRef.current) setIsLoading(false);
      });
    setMaterialDraft(createMaterialDraft());
    chatStore.setLastInput(draftQuoteRef.current ? userInput : finalInput);
    updateDraftQuote(undefined);
    setUserInput("");
    setPromptHints([]);
    if (!isMobileScreen) inputRef.current?.focus();
    scrollToBottom();
  };

  const onPromptSelect = (prompt: RenderPrompt) => {
    onSearch.cancel();
    setPromptHintsDismissed(true);
    setTimeout(() => {
      setPromptHints([]);

      const matchedChatCommand = chatCommands.match(prompt.content);
      if (matchedChatCommand.matched) {
        // if user is selecting a chat command, just trigger it
        matchedChatCommand.invoke();
        setUserInput("");
      } else {
        // or fill the prompt
        setUserInput(prompt.content);
      }
      inputRef.current?.focus();
    }, 30);
  };

  const onFollowupSelect = async (messageId: string, text: string) => {
    const owner = getLocalScope();
    const tokenId = getLocalTokenId();
    const canFill = () => {
      const current = activeChatSession(useChatStore.getState());
      const source = current?.messages.at(-1);
      return (
        attachmentsActiveRef.current &&
        isLocalWorkspaceActive() &&
        getLocalScope() === owner &&
        getLocalTokenId() === tokenId &&
        !useAccessStore.getState().switchingToken &&
        current?.id === session.id &&
        source?.id === messageId &&
        source.role === "assistant" &&
        !source.isError &&
        !source.interrupted &&
        !ChatControllerPool.hasPending(session.id) &&
        !current.messages.some(
          (message) =>
            message.streaming || message.materialStatus === "processing",
        ) &&
        !!readMessageInteractions(source.interactions)?.suggestions?.includes(
          text,
        )
      );
    };
    if (!canFill()) return false;
    const previousText = inputRef.current?.value ?? userInput;
    if (
      previousText.trim() &&
      previousText !== text &&
      !(await showConfirm("替换草稿中的文字为这条追问？引用和附件会保留。"))
    )
      return false;
    if (!canFill() || (inputRef.current?.value ?? userInput) !== previousText)
      return false;
    onSearch.cancel();
    setPromptHints([]);
    setPromptHintsDismissed(true);
    setUserInput(text);
    inputRef.current?.focus();
    return true;
  };

  const onSubmitMessageOptions = async (
    messageId: string,
    optionsId: string,
    selectedIds: string[],
  ) => {
    if (isLoading || editingMessageId || !checkModelAvailability())
      return false;
    setIsLoading(true);
    try {
      const operation = chatStore.submitMessageOptions(
        session.id,
        messageId,
        optionsId,
        selectedIds,
      );
      scrollToBottom();
      return await operation;
    } finally {
      if (attachmentsActiveRef.current) setIsLoading(false);
    }
  };

  // stop response
  const onUserStop = (messageId: string) => {
    ChatControllerPool.stop(session.id, messageId);
  };

  useEffect(() => {
    chatStore.updateTargetSession(session, (session) => {
      const stopTiming = Date.now() - REQUEST_TIMEOUT_MS;
      let clearedCompression = false;
      session.messages.forEach((m, index) => {
        const controllerId =
          m.role === "user" && m.materialStatus === "processing"
            ? session.messages[index + 1]?.id
            : m.id;
        const controller =
          ChatControllerPool.controllers[
            ChatControllerPool.key(session.id, controllerId)
          ];
        if (controller && !controller.signal.aborted) return;
        if (m.contextCompressing) {
          if (isContextCompressionActive(session.id, m.id)) return;
          m.contextCompressing = undefined;
          if (m.streaming) {
            m.streaming = false;
            m.interrupted = true;
          }
          clearedCompression = true;
        }
        if (m.materialStatus === "processing") {
          m.materialStatus = "failed";
          m.materialItems = m.materialItems?.map((item) =>
            item.status === "processing"
              ? {
                  ...item,
                  status: "failed",
                  error: Locale.Chat.InputActions.MaterialsInterrupted,
                }
              : item,
          );
          if (m.role === "assistant") {
            m.streaming = false;
            m.isError = true;
            m.content = Locale.Chat.InputActions.MaterialsInterrupted;
          }
        }
        // check if should stop all stale messages
        if (m.isError || new Date(m.date).getTime() < stopTiming) {
          if (m.streaming) {
            m.streaming = false;
          }

          if (
            m.content.length === 0 &&
            !m.reasoning?.length &&
            !m.tools?.length
          ) {
            m.isError = true;
            m.content = prettyObject({
              error: true,
              message: "empty response",
            });
          }
        }
      });

      if (clearedCompression) session.messages = [...session.messages];

      // auto sync mask config from global config
      if (session.mask.syncGlobalConfig) {
        session.mask.modelConfig = { ...useAppConfig.getState().modelConfig };
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // check if should send message
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeKey(e)) return;
    // if ArrowUp and no userInput, fill with last input
    if (
      e.key === "ArrowUp" &&
      userInput.length <= 0 &&
      !(e.metaKey || e.altKey || e.ctrlKey)
    ) {
      setUserInput(useChatStore.getState().lastInput ?? "");
      e.preventDefault();
      return;
    }
    if (shouldSubmit(e) && promptHints.length === 0 && !showNoEnabledPrompts) {
      doSubmit(userInput);
      e.preventDefault();
    }
  };
  const deleteMessage = (msgId?: string) => {
    if (msgId) chatStore.deleteMessage(session.id, msgId);
  };

  const onDelete = (msgId: string) => {
    deleteMessage(msgId);
  };

  const onResend = (message: ChatMessage) => {
    if (message.materialStatus === "processing") return;
    const resendingIndex = session.messages.findIndex(
      (m) => m.id === message.id,
    );

    if (resendingIndex < 0 || resendingIndex >= session.messages.length) {
      console.error("[Chat] failed to find resending message", message);
      return;
    }

    let userMessage: ChatMessage | undefined;
    let botMessage: ChatMessage | undefined;

    if (message.role === "assistant") {
      // if it is resending a bot's message, find the user input for it
      botMessage = message;
      for (let i = resendingIndex; i >= 0; i -= 1) {
        if (session.messages[i].role === "user") {
          userMessage = session.messages[i];
          break;
        }
      }
    } else if (message.role === "user") {
      // if it is resending a user's input, find the bot's response
      userMessage = message;
      for (let i = resendingIndex; i < session.messages.length; i += 1) {
        if (session.messages[i].role === "assistant") {
          botMessage = session.messages[i];
          break;
        }
      }
    }

    if (userMessage === undefined) {
      console.error("[Chat] failed to resend", message);
      return;
    }
    if (userMessage.materialStatus) {
      if (userMessage.materialStatus === "failed") {
        void chatStore.retryPreparedMaterials(session.id, userMessage.id);
      }
      return;
    }

    const pendingTask = pendingTasks().find(
      (task) =>
        task.sessionId === session.id && task.messageId === botMessage?.id,
    );
    if (pendingTask) {
      window.dispatchEvent(new Event("resume-local-tasks"));
      return;
    }

    if (!checkModelAvailability()) return;
    setIsLoading(true);
    chatStore
      .retryMessage(session.id, message.id)
      .finally(() => setIsLoading(false));
    inputRef.current?.focus();
  };

  const onReuseInput = async (message: ChatMessage) => {
    if (message.videoResultId) {
      const request = useVideoStore
        .getState()
        .results.find((result) => result.id === message.videoResultId)?.request;
      if (request) {
        await onReuseGeneration(videoGenerationReuse(request));
        return;
      }
    }
    if (materialDraft.getSnapshot().pending > 0) {
      showToast(Locale.Chat.InputActions.MaterialsProcessing);
      return;
    }
    const index = session.messages.findIndex((item) => item.id === message.id);
    if (index < 0) return;
    const source =
      message.role === "user"
        ? message
        : session.messages
            .slice(0, index)
            .reverse()
            .find((item) => item.role === "user" && !item.isMcpResponse);
    if (!source) return;
    if (
      (userInput || draftQuote || attachImages.length || attachFiles.length) &&
      !(await showConfirm(Locale.Chat.Actions.ReuseConfirm))
    ) {
      return;
    }
    if (
      !attachmentsActiveRef.current ||
      materialDraftRef.current !== materialDraft ||
      materialDraft.getSnapshot().pending > 0
    )
      return;
    onSearch.cancel();
    setPromptHints([]);
    setPromptHintsDismissed(true);
    setUserInput(source.composerInput?.text ?? getMessageTextContent(source));
    updateDraftQuote(readMessageQuote(source.composerInput?.quote));
    setMaterialDraft(
      createMaterialDraft({
        images: getMessageImages(source),
        files: messageFiles(source).map((file) => ({ ...file })),
      }),
    );
    inputRef.current?.focus();
  };

  const onReuseGeneration = async (request: GenerationReuse) => {
    if (!isLocalWorkspaceActive()) return;
    const owner = getLocalScope();
    const before = remixDraftRef.current;
    const beforeMaterials = before.material.getSnapshot();
    const beforeQuote = draftQuoteRef.current;
    if (beforeMaterials.pending) {
      showToast(Locale.Chat.InputActions.MaterialsProcessing);
      return;
    }
    if (
      (before.input || draftQuoteRef.current || beforeMaterials.items.length) &&
      !(await showConfirm(Locale.Chat.Actions.ReuseConfirm))
    )
      return;
    const current = remixDraftRef.current;
    if (
      !attachmentsActiveRef.current ||
      !isLocalWorkspaceActive() ||
      getLocalScope() !== owner ||
      current.sessionId !== before.sessionId ||
      current.input !== before.input ||
      current.material !== before.material ||
      current.material.getSnapshot() !== beforeMaterials ||
      draftQuoteRef.current !== beforeQuote
    )
      return;
    const [model, provider] = getModelProvider(request.model);
    const providerName =
      request.config.providerName ||
      provider ||
      remixModels.find((item) => item.available && item.name === model)
        ?.provider?.providerName ||
      "OpenAI";
    chatStore.updateTargetSession(session, (target) => {
      target.remixSourceWorkId = request.sourceWorkId;
      Object.assign(target.mask.modelConfig, request.config);
      target.mask.modelConfig.model = model;
      target.mask.modelConfig.providerName = providerName;
      target.mask.syncGlobalConfig = false;
    });
    onSearch.cancel();
    setPromptHints([]);
    setPromptHintsDismissed(true);
    updateDraftQuote(undefined);
    setUserInput(request.prompt);
    setMaterialDraft(
      createMaterialDraft({
        images: request.images,
        files: request.files,
      }),
    );
    inputRef.current?.focus();
    if (request.incomplete)
      showToast("已复用现有配置，部分历史参数未保存，请确认后再发送。");
  };

  const onEditMessage = (message: ChatMessage) => {
    const current = useChatStore.getState().currentSession();
    if (
      current.id !== session.id ||
      message.role !== "user" ||
      message.isMcpResponse ||
      message.materialStatus ||
      ChatControllerPool.hasPending(session.id) ||
      current.messages.some(
        (item) => item.streaming || item.materialStatus === "processing",
      )
    )
      return;
    reader.stop();
    pauseFollowing();
    setContextMenu(null);
    setEditingMessageId(message.id);
  };

  const onSaveMessage = async (message: ChatMessage, text: string) => {
    if (!checkModelAvailability()) return false;
    setIsLoading(true);
    try {
      const operation = chatStore.editMessage(session.id, message.id, text);
      scrollToBottom();
      const accepted = await operation;
      if (accepted)
        setEditingMessageId((current) =>
          current === message.id ? undefined : current,
        );
      return accepted;
    } finally {
      if (attachmentsActiveRef.current) setIsLoading(false);
    }
  };

  const onPinMessage = (message: ChatMessage) => {
    chatStore.updateTargetSession(session, (session) =>
      session.mask.context.push(message),
    );

    showToast(Locale.Chat.Actions.PinToastContent, {
      text: Locale.Chat.Actions.PinToastAction,
      onClick: () => {
        setShowPromptModal(true);
      },
    });
  };

  // 右键打开操作菜单
  const handleContextMenu = useCallback(
    (e: React.MouseEvent | React.TouchEvent, message: any) => {
      e.preventDefault();
      e.stopPropagation();

      let x: number, y: number;
      if ("touches" in e) {
        const touch = e.touches[0] || (e as React.TouchEvent).changedTouches[0];
        x = touch.clientX;
        y = touch.clientY;
      } else {
        x = (e as React.MouseEvent).clientX;
        y = (e as React.MouseEvent).clientY;
      }

      setContextMenu({
        x,
        y,
        messageId: message.id ?? "",
        isUser: message.role === "user",
        content: getMessageTextContent(message),
        selectedText: getMessageSelectionText(
          e.target instanceof Element
            ? e.target.closest(`.${styles["chat-message-container"]}`)
            : null,
        ),
        imageSrc:
          e.target instanceof HTMLImageElement
            ? e.target.currentSrc || e.target.src
            : undefined,
      });
    },
    [],
  );

  // 右键菜单
  const handleRightClick = handleContextMenu;

  const accessStore = useAccessStore(
    (state) => ({
      newApiEnabled: state.newApiEnabled,
      useCustomConfig: state.useCustomConfig,
      customApiMode: state.customApiMode,
      switchingToken: state.switchingToken,
      modelListStatus: state.modelListStatus,
      disableFastLink: state.disableFastLink,
      openaiApiKey: state.openaiApiKey,
      needCode: state.needCode,
      update: state.update,
      fetch: state.fetch,
      isValidOpenAI: state.isValidOpenAI,
      enabledAccessControl: state.enabledAccessControl,
      isAuthorized: state.isAuthorized,
    }),
    shallow,
  );
  const capabilities = useModelCapabilities(
    session.mask.modelConfig.model,
    session.mask.modelConfig.providerName,
  );
  const isImageComposer = shouldUseImageGenerationApi(
    session.mask.modelConfig,
    {
      capabilities,
      hasFiles:
        materials.items.some(
          (item) => item.status !== "ready" && !item.type.startsWith("image/"),
        ) || attachFiles.some((file) => !file.isText),
      customImageMode:
        usesCustomProvider(
          accessStore,
          session.mask.modelConfig.providerName,
        ) && accessStore.customApiMode !== "auto",
    },
  );
  const composerText = attachFiles.length
    ? formatFileContent(attachFiles) +
      "\n\n" +
      formatQuoteInput(userInput, draftQuote)
    : formatQuoteInput(userInput, draftQuote);
  const promptLength = isImageComposer
    ? imagePromptLength(
        attachImages.length
          ? composerText
          : fillTemplateWith(composerText, session.mask.modelConfig),
      )
    : 0;

  const context: RenderMessage[] = useMemo(() => {
    return session.mask.hideContext ? [] : session.mask.context.slice();
  }, [session.mask.context, session.mask.hideContext]);

  if (
    context.length === 0 &&
    session.messages.at(0)?.content !== BOT_HELLO.content
  ) {
    const copiedHello = Object.assign({}, BOT_HELLO);
    if (!accessStore.isAuthorized()) {
      copiedHello.content = Locale.Error.Unauthorized;
    }
    context.push(copiedHello);
  }

  // preview messages
  const awaitingSubmittedTurn =
    isLoading &&
    submittedTurnRef.current?.sessionId === session.id &&
    submittedTurnRef.current.lastMessageId === session.messages.at(-1)?.id;
  const renderMessages = useMemo(() => {
    return context
      .concat(session.messages as RenderMessage[])
      .concat(
        awaitingSubmittedTurn &&
          !session.messages.some(
            (message) => message.role === "assistant" && message.streaming,
          )
          ? [
              {
                ...previewMessages.assistant,
                model: session.mask.modelConfig.model,
                preview: true,
              },
            ]
          : [],
      )
      .concat(
        hasPreviewInput
          ? [
              {
                ...previewMessages.user,
                preview: true,
              },
            ]
          : [],
      );
  }, [
    context,
    awaitingSubmittedTurn,
    session.mask.modelConfig.model,
    session.messages,
    hasPreviewInput,
    previewMessages,
  ]);
  const previewMessage: RenderMessage | undefined = hasPreviewInput
    ? { ...previewMessages.user, content: previewInput, preview: true }
    : undefined;

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchTarget, setSearchTarget] = useState<{
    messageId: string;
    start: number;
  }>();
  const [externalSearchTarget, setExternalSearchTarget] = useState<{
    sessionId: string;
    messageId: string;
    query: string;
  }>();
  const [searchNavigation, setSearchNavigation] = useState(0);
  const searchTrigger = useRef<HTMLDivElement>(null);
  const {
    matches: searchMatches,
    ready: searchReady,
    refresh: refreshSearch,
  } = useConversationSearch({
    sessionId: session.id,
    messages: session.messages,
    revision: session,
    query: searchQuery,
    open: searchOpen,
  });
  const selectedSearchIndex = externalSearchTarget
    ? searchMatches.findIndex(
        (match) => match.messageId === externalSearchTarget.messageId,
      )
    : searchTarget
    ? searchMatches.findIndex(
        (match) =>
          match.messageId === searchTarget.messageId &&
          match.start === searchTarget.start,
      )
    : -1;
  const searchIndex =
    selectedSearchIndex >= 0
      ? selectedSearchIndex
      : searchMatches.length
      ? 0
      : -1;
  const searchMatch = searchMatches[searchIndex];
  const searchMessageId = searchMatch?.messageId;
  const searchMessageStart = searchMatch?.start;
  const searchRenderIndex = renderMessages.findIndex(
    (message) => message.id === searchMessageId,
  );
  const renderMessageCount = renderMessages.length;
  const searchOccurrence = searchMatch
    ? searchMatches
        .filter((match) => match.messageId === searchMatch.messageId)
        .indexOf(searchMatch)
    : 0;
  const openConversationSearch = () => {
    pauseFollowing();
    setSearchOpen(true);
    document
      .querySelector<HTMLInputElement>(
        '[data-testid="conversation-search"] input',
      )
      ?.focus({ preventScroll: true });
  };
  const closeConversationSearch = useCallback(() => {
    setSearchOpen(false);
    setExternalSearchTarget(undefined);
    searchTrigger.current
      ?.querySelector("button")
      ?.focus({ preventScroll: true });
  }, []);
  const navigateSearch = (direction: 1 | -1) => {
    const next = navigateConversationMatch(
      searchIndex,
      searchMatches.length,
      direction,
    );
    const match = searchMatches[next];
    if (match) {
      setSearchTarget({ messageId: match.messageId, start: match.start });
      setSearchNavigation((value) => value + 1);
    }
  };

  const [msgRenderIndex, _setMsgRenderIndex] = useState(
    Math.max(0, renderMessages.length - CHAT_PAGE_SIZE),
  );
  const historyAnchor = useRef<{ id: string; offset: number }>();

  function setMsgRenderIndex(newIndex: number, preservePosition = false) {
    newIndex = Math.min(renderMessages.length - CHAT_PAGE_SIZE, newIndex);
    newIndex = Math.max(0, newIndex);
    if (newIndex === msgRenderIndex) return;
    const body = scrollRef.current;
    if (preservePosition && body) {
      const retained = new Set(
        renderMessages
          .slice(newIndex, newIndex + 3 * CHAT_PAGE_SIZE)
          .map((message) => message.id),
      );
      const viewport = body.getBoundingClientRect();
      const anchor = Array.from(
        body.querySelectorAll<HTMLElement>("[data-message-id]"),
      ).find((message) => {
        if (!retained.has(message.dataset.messageId!)) return false;
        const rect = message.getBoundingClientRect();
        return rect.bottom > viewport.top && rect.top < viewport.bottom;
      });
      if (anchor)
        historyAnchor.current = {
          id: anchor.dataset.messageId!,
          offset: anchor.getBoundingClientRect().top - viewport.top,
        };
    }
    _setMsgRenderIndex(newIndex);
  }

  useLayoutEffect(() => {
    const anchor = historyAnchor.current;
    historyAnchor.current = undefined;
    const body = scrollRef.current;
    if (!body || !anchor) return;
    const message = Array.from(
      body.querySelectorAll<HTMLElement>("[data-message-id]"),
    ).find((item) => item.dataset.messageId === anchor.id);
    if (message)
      body.scrollTop +=
        message.getBoundingClientRect().top -
        body.getBoundingClientRect().top -
        anchor.offset;
  }, [msgRenderIndex]);

  const messages = useMemo(() => {
    const endRenderIndex = Math.min(
      msgRenderIndex + 3 * CHAT_PAGE_SIZE,
      renderMessages.length,
    );
    return renderMessages.slice(msgRenderIndex, endRenderIndex);
  }, [msgRenderIndex, renderMessages]);

  const isLatestWindow =
    msgRenderIndex + 3 * CHAT_PAGE_SIZE >= renderMessages.length;
  const messageSources = useMemo(() => {
    const result = new Map<string, ReturnType<typeof getMessageSources>>();
    let turnSources: ReturnType<typeof getMessageSources> = [];
    for (const message of session.messages) {
      if (message.role === "user" && !message.isMcpResponse) turnSources = [];
      if (message.role !== "assistant") continue;
      turnSources = getMessageSources({}, [
        ...turnSources,
        ...getMessageSources(message),
      ]);
      if (turnSources.length) result.set(message.id, turnSources);
    }
    return result;
  }, [session.messages]);
  const messageOptionReceipts = useMemo(() => {
    const sources = new Map<string, ChatMessage>();
    const receipts = new Map<string, MessageInteractionReceipt>();
    for (const message of session.messages) {
      if (message.role === "assistant") sources.set(message.id, message);
      if (message.role !== "user" || !message.optionResponse) continue;
      const response = message.optionResponse;
      const definition = readMessageInteractions(
        sources.get(response.sourceMessageId)?.interactions,
      )?.options;
      if (!definition || definition.id !== response.optionsId) continue;
      const selectedIds = validateOptionSelection(
        definition,
        response.selectedIds,
      );
      if (selectedIds && !receipts.has(response.sourceMessageId)) {
        receipts.set(response.sourceMessageId, {
          selectedIds,
          userMessageId: message.id,
        });
      }
    }
    return receipts;
  }, [session.messages]);
  const latestMessageId = session.messages.at(-1)?.id;
  const interactionsDisabled =
    isLoading ||
    hasPendingResponse ||
    uploading ||
    !!editingMessageId ||
    accessStore.switchingToken;
  const {
    autoScroll,
    positionReady,
    showScrollButton,
    scrollDomToBottom,
    pauseFollowing,
  } = useScrollToBottom(
    scrollRef,
    isLatestWindow,
    hasPendingResponse,
    session.messages.length > 0,
  );

  const shouldPreloadConversationSearch =
    positionReady && session.messages.length > 0;
  useEffect(() => {
    if (!shouldPreloadConversationSearch) return;
    return scheduleIdleTask(() => {
      void loadConversationSearch().catch(() => {});
    });
  }, [shouldPreloadConversationSearch]);

  useEffect(() => {
    if (!positionReady) return;
    return preloadCommonWorkspaceRoutes();
  }, [positionReady]);

  useLayoutEffect(() => {
    _setMsgRenderIndex((index) =>
      Math.min(index, Math.max(0, renderMessageCount - CHAT_PAGE_SIZE)),
    );
  }, [renderMessageCount]);

  useEffect(() => {
    const state = location.state as {
      searchSessionId?: string;
      searchMessageId?: string;
      searchQuery?: string;
    } | null;
    if (
      state?.searchSessionId !== session.id ||
      typeof state.searchQuery !== "string" ||
      typeof state.searchMessageId !== "string"
    )
      return;
    pauseFollowing();
    setSearchQuery(state.searchQuery);
    setSearchTarget(undefined);
    setExternalSearchTarget({
      sessionId: session.id,
      messageId: state.searchMessageId,
      query: state.searchQuery,
    });
    setSearchOpen(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate, pauseFollowing, session.id]);

  useEffect(() => {
    if (
      !searchOpen ||
      !searchReady ||
      externalSearchTarget?.sessionId !== session.id ||
      externalSearchTarget.query !== searchQuery
    )
      return;
    const match = searchMatches.find(
      (item) => item.messageId === externalSearchTarget.messageId,
    );
    setExternalSearchTarget(undefined);
    if (match)
      setSearchTarget({ messageId: match.messageId, start: match.start });
  }, [
    externalSearchTarget,
    searchMatches,
    searchOpen,
    searchQuery,
    searchReady,
    session.id,
  ]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !event.defaultPrevented &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.isComposing &&
        event.key.toLowerCase() === "f" &&
        !editingMessageId &&
        !document.querySelector(
          '[role="dialog"][aria-modal="true"], dialog[open]',
        )
      ) {
        event.preventDefault();
        pauseFollowing();
        setSearchOpen(true);
        const input = document.querySelector<HTMLInputElement>(
          '[data-testid="conversation-search"] input',
        );
        input?.focus({ preventScroll: true });
        input?.select();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [editingMessageId, pauseFollowing]);

  useLayoutEffect(() => {
    if (!searchOpen || searchRenderIndex < 0) return;
    pauseFollowing();
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    _setMsgRenderIndex(
      Math.max(
        0,
        Math.min(
          renderMessageCount - CHAT_PAGE_SIZE,
          searchRenderIndex - CHAT_PAGE_SIZE,
        ),
      ),
    );
  }, [
    searchOpen,
    searchMessageId,
    searchMessageStart,
    searchRenderIndex,
    renderMessageCount,
    searchNavigation,
    pauseFollowing,
  ]);

  useConversationSearchHighlight({
    containerRef: scrollRef,
    query: searchQuery,
    current: searchMatch,
    occurrence: searchOccurrence,
    navigation: searchNavigation,
    page: msgRenderIndex,
    enabled: searchOpen,
  });

  useEffect(() => {
    if (autoScroll) {
      _setMsgRenderIndex(Math.max(0, renderMessages.length - CHAT_PAGE_SIZE));
    }
  }, [autoScroll, renderMessages.length]);

  const onChatBodyScroll = (e: HTMLElement) => {
    if (autoScroll || !positionReady) return;
    if (searchOpen && searchQuery.trim()) return;
    // rAF 节流：避免高频滚动时同步 setState 导致卡顿
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const bottomHeight = e.scrollTop + e.clientHeight;
      const edgeThreshold = e.clientHeight;

      const isTouchTopEdge = e.scrollTop <= edgeThreshold;
      const isTouchBottomEdge = bottomHeight >= e.scrollHeight - edgeThreshold;
      const prevPageMsgIndex = msgRenderIndex - CHAT_PAGE_SIZE;
      const nextPageMsgIndex = msgRenderIndex + CHAT_PAGE_SIZE;

      if (isTouchTopEdge && !isTouchBottomEdge) {
        setMsgRenderIndex(prevPageMsgIndex, true);
      } else if (isTouchBottomEdge) {
        setMsgRenderIndex(nextPageMsgIndex, true);
      }
    });
  };

  function scrollToBottom() {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);
    scrollDomToBottom();
  }

  // clear context index = context length + index in messages
  const clearContextIndex =
    (session.clearContextIndex ?? -1) >= 0
      ? session.clearContextIndex! + context.length - msgRenderIndex
      : -1;

  const [showPromptModal, setShowPromptModal] = useState(false);

  const clientConfig = useMemo(() => getClientConfig(), []);

  const showMaxIcon = !isMobileScreen && !clientConfig?.isApp;

  useCommand({
    fill: setUserInput,
    submit: (text) => {
      doSubmit(text);
    },
    code: (_text) => {
      if (accessStore.disableFastLink) return;
      showConfirm("验证密码（CODE）系统已移除，请使用 ACCESS_PASSWORD");
    },
    settings: (text) => {
      if (accessStore.disableFastLink) return;

      try {
        const payload = JSON.parse(text) as {
          key?: string;
          url?: string;
        };

        if (payload.key || payload.url) {
          showConfirm(
            Locale.URLCommand.Settings +
              `\n${JSON.stringify(payload, null, 4)}`,
          ).then((res) => {
            if (!res) return;
            if (payload.key) {
              accessStore.update(
                (access) => (access.openaiApiKey = payload.key!),
              );
            }
            if (payload.url) {
              accessStore.update((access) => (access.openaiUrl = payload.url!));
            }
            accessStore.update((access) => (access.useCustomConfig = true));
          });
        }
      } catch {
        console.error("[Command] failed to get settings from url: ", text);
      }
    },
  });

  // edit / insert message modal
  const [isEditingMessage, setIsEditingMessage] = useState(false);
  const [isEditingInput, setIsEditingInput] = useState(false);

  // remember unfinished input
  useEffect(() => {
    // try to load from local storage
    const key = localKey(UNFINISHED_INPUT(session.id));
    const mayBeUnfinishedInput = localStorage.getItem(key);
    if (mayBeUnfinishedInput && userInput.length === 0) {
      setUserInput(mayBeUnfinishedInput);
      localStorage.removeItem(key);
    }

    const dom = inputRef.current;
    return () => {
      localStorage.setItem(key, dom?.value ?? "");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(quoteDraftKey);
    if (saved && !draftQuoteRef.current) {
      try {
        const quote = readMessageQuote(JSON.parse(saved));
        if (quote) {
          draftQuoteRef.current = quote;
          setDraftQuote(quote);
        } else localStorage.removeItem(quoteDraftKey);
      } catch {
        localStorage.removeItem(quoteDraftKey);
      }
    }
    return () => {
      const quote = draftQuoteRef.current;
      if (quote) localStorage.setItem(quoteDraftKey, JSON.stringify(quote));
      else localStorage.removeItem(quoteDraftKey);
    };
  }, [quoteDraftKey]);

  const reuseGenerationRef = useRef(onReuseGeneration);
  useLayoutEffect(() => {
    reuseGenerationRef.current = onReuseGeneration;
  });
  useEffect(() => {
    const target = location.state?.reuseGalleryWork as
      | GalleryReuseTarget
      | undefined;
    if (!target) return;
    let active = true;
    void readGalleryReuse(target)
      .then(async (request) => {
        if (active) await reuseGenerationRef.current(request);
      })
      .catch((error) => {
        if (active)
          showToast(
            error instanceof Error ? error.message : "无法复用这次配置",
          );
      })
      .finally(() => {
        if (active) navigate(location.pathname, { replace: true, state: null });
      });
    return () => {
      active = false;
    };
  }, [location.state, location.pathname, navigate]);

  const handleAttachmentFiles = useCallback(
    (files: File[]) => materialDraft.add(files),
    [materialDraft],
  );

  const onFileSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      await handleAttachmentFiles(files);
    },
    [handleAttachmentFiles],
  );

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      try {
        const items = (event.clipboardData || window.clipboardData).items;
        const imageFiles: File[] = [];
        for (const item of items) {
          if (item.kind === "file" && item.type.startsWith("image/")) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) imageFiles.push(file);
          }
        }
        if (imageFiles.length > 0) {
          await handleAttachmentFiles(imageFiles);
        }
      } catch (e) {
        console.error("[Paste] Unexpected error:", e);
      }
    },
    [handleAttachmentFiles],
  );

  // 拖拽上传相关状态
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 检查是否包含文件
    if (e.dataTransfer.types?.includes("Files")) {
      dragCounterRef.current += 1;
      setIsDragOver(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types?.includes("Files")) {
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        await handleAttachmentFiles(files);
      }
    },
    [handleAttachmentFiles],
  );

  // 快捷键 shortcut keys
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const focusInput = useCallback(() => inputRef.current?.focus(), []);
  const copyLastCode = useCallback(() => {
    const code = getLastChatCode(scrollRef.current);
    if (code !== undefined) void copyToClipboard(code);
  }, [scrollRef]);
  const copyLastReply = useCallback(() => {
    const lastReply = messagesRef.current
      .filter((message) => message.role !== "user")
      .pop();
    if (lastReply) void copyToClipboard(getMessageTextContent(lastReply));
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 打开新聊天 command + shift + o
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "o"
      ) {
        event.preventDefault();
        setTimeout(() => {
          chatStore.newSession();
          navigate(Path.Chat);
        }, 10);
      }
      // 聚焦聊天输入 shift + esc
      else if (event.shiftKey && event.key.toLowerCase() === "escape") {
        event.preventDefault();
        focusInput();
      }
      // 复制最后一个代码块 command + shift + ;
      else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.code === "Semicolon"
      ) {
        event.preventDefault();
        copyLastCode();
      }
      // 复制最后一个回复 command + shift + c
      else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "c"
      ) {
        event.preventDefault();
        copyLastReply();
      }
      // 展示快捷键 command + /
      else if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        dispatchWorkspaceAction("shortcuts");
      }
      // 清除上下文 command + shift + backspace
      else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "backspace"
      ) {
        event.preventDefault();
        dispatchWorkspaceAction("clear-context");
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [chatStore, navigate, focusInput, copyLastCode, copyLastReply]);

  const [previewCode, setPreviewCode] = useState<string | null>(null);
  useEffect(() => setPreviewCode(null), [session.id]);
  const showWelcome =
    session.messages.length === 0 &&
    context.length === 1 &&
    context[0].id === BOT_HELLO.id &&
    accessStore.isAuthorized() &&
    previewInput.length === 0 &&
    !isLoading;

  const messageHandlers = useRef({
    onQuoteSelected,
    onFollowupSelect,
    onSubmitMessageOptions,
    onUserStop,
    onResend,
    onReuseInput,
    onEditMessage,
    onSaveMessage,
    onDelete,
    onPinMessage,
    reader,
  });
  useLayoutEffect(() => {
    // Cached history nodes must use the latest committed draft and controls.
    messageHandlers.current = {
      onQuoteSelected,
      onFollowupSelect,
      onSubmitMessageOptions,
      onUserStop,
      onResend,
      onReuseInput,
      onEditMessage,
      onSaveMessage,
      onDelete,
      onPinMessage,
      reader,
    };
  });

  useWorkspaceActions({
    "focus-input": focusInput,
    "copy-last-code": copyLastCode,
    "copy-last-reply": copyLastReply,
    search: openConversationSearch,
    export: () => setShowExport(true),
    "regenerate-title": () => {
      showToast(Locale.Chat.Actions.RefreshToast);
      void chatStore.summarizeSession(true, session);
    },
    "edit-messages": () => setIsEditingMessage(true),
    "chat-settings": () => setShowPromptModal(true),
  });

  const headerActions = (
    <div
      className={clsx(
        "window-actions",
        styles["chat-input-actions"],
        styles["composer-toolbar"],
        styles["chat-header-actions"],
      )}
    >
      <div ref={searchTrigger}>
        <ChatAction
          icon={<Search aria-hidden="true" />}
          text="搜索对话"
          expanded={searchOpen}
          onClick={openConversationSearch}
        />
      </div>
      <ChatAction
        icon={<Share2 aria-hidden="true" />}
        text={Locale.Chat.Actions.Export}
        onClick={() => {
          setShowExport(true);
        }}
      />
      {showMaxIcon && (
        <ChatAction
          icon={
            config.tightBorder ? (
              <Minimize aria-hidden="true" />
            ) : (
              <Maximize aria-hidden="true" />
            )
          }
          text={
            config.tightBorder
              ? Locale.Chat.Actions.ExitFullScreen
              : Locale.Chat.Actions.FullScreen
          }
          onClick={() => {
            config.update(
              (config) => (config.tightBorder = !config.tightBorder),
            );
          }}
        />
      )}
    </div>
  );

  return (
    <>
      <div
        className={styles.chat}
        data-welcome={showWelcome || undefined}
        key={session.id}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className={styles["chat-drag-overlay"]}>
            <div className={styles["chat-drag-overlay-content"]}>
              <ImageIcon />
              <span>松开以上传图片</span>
            </div>
          </div>
        )}
        <div
          className={clsx("window-header", styles["workspace-chat-header"])}
          data-tauri-drag-region
        >
          <div
            className={clsx(
              "window-header-title",
              styles["chat-body-title"],
              styles["workspace-chat-title"],
            )}
            data-empty={
              session.messages.length === 0 && session.topic === DEFAULT_TOPIC
                ? true
                : undefined
            }
          >
            <button
              type="button"
              className={styles["chat-body-main-title"]}
              title="重命名对话"
              onClick={() => void renameChatSession(session.id)}
            >
              <span className="window-header-main-title">
                {!session.topic ? DEFAULT_TOPIC : session.topic}
              </span>
              <span className="window-header-sub-title">
                {Locale.Chat.SubTitle(session.messages.length)}
              </span>
            </button>
          </div>
          {!isMobileScreen &&
            (headerActionsTarget
              ? createPortal(headerActions, headerActionsTarget)
              : headerActions)}
          {showPromptModal && (
            <SessionConfigModel onClose={() => setShowPromptModal(false)} />
          )}
        </div>
        <ConversationSearch
          open={searchOpen}
          query={searchQuery}
          currentIndex={searchIndex}
          matches={searchMatches}
          onChange={(query) => {
            setSearchQuery(query);
            setSearchTarget(undefined);
            setExternalSearchTarget(undefined);
          }}
          onFocus={refreshSearch}
          onNavigate={navigateSearch}
          onClose={closeConversationSearch}
        />
        <ChatSplitPane
          className={styles["chat-main"]}
          preview={
            previewCode ? (
              <HTMLPreview code={previewCode} height="100%" />
            ) : undefined
          }
          onClose={() => setPreviewCode(null)}
          onOpen={setPreviewCode}
        >
          <div
            className={clsx(styles["chat-body-container"], {
              [styles["chat-workspace-welcome"]]: showWelcome,
            })}
          >
            <div
              className={clsx(styles["chat-body"], {
                [styles["chat-body-welcome"]]: showWelcome,
              })}
              ref={scrollRef}
              data-scroll-following={autoScroll}
              data-scroll-ready={positionReady}
              data-auto-hide-scrollbar
              tabIndex={0}
              onScroll={(e) => onChatBodyScroll(e.currentTarget)}
              onMouseDown={() => inputRef.current?.blur()}
              onTouchStart={() => {
                inputRef.current?.blur();
              }}
            >
              {showWelcome && (
                <section className={styles["chat-welcome"]}>
                  <div
                    className={clsx(styles["welcome-mark"], "no-dark")}
                    aria-hidden="true"
                  >
                    <OctopusIcon width={36} height={36} />
                  </div>
                  <h1>{Locale.Store.BotHello}</h1>
                </section>
              )}
              <ChatMessageHistory
                preview={previewMessage}
                view={useMemo(() => {
                  const renderMessage = (message: RenderMessage, i: number) => {
                    const isUser = message.role === "user";
                    const copyImages = isUser
                      ? []
                      : generatedImageUrls(getMessageTextContent(message));
                    if (!isUser && message.materialStatus === "processing")
                      return null;
                    const absoluteIndex = msgRenderIndex + i;
                    const isContext = absoluteIndex < context.length;
                    const showActions =
                      absoluteIndex > 0 &&
                      editingMessageId !== message.id &&
                      !message.preview &&
                      !message.materialStatus &&
                      (message.streaming ||
                        message.content.length > 0 ||
                        !!message.reasoning?.length ||
                        !!message.tools?.length) &&
                      !isContext;
                    const showTyping = message.preview || message.streaming;
                    const waiting =
                      !isUser &&
                      showTyping &&
                      message.content.length === 0 &&
                      !message.reasoning?.length &&
                      !message.tools?.length;
                    const branches =
                      !isContext && !message.preview
                        ? chatStore.getMessageBranches(session.id, message.id)
                        : undefined;
                    const sources = messageSources.get(message.id);
                    const messageQuote = isUser
                      ? readMessageQuote(message.composerInput?.quote)
                      : undefined;
                    const interactions =
                      message.role === "assistant" &&
                      !isContext &&
                      !message.preview &&
                      !message.streaming &&
                      !message.isError &&
                      !message.interrupted
                        ? readMessageInteractions(message.interactions)
                        : undefined;
                    const optionReceipt = messageOptionReceipts.get(message.id);
                    const latestAnswer = latestMessageId === message.id;
                    if (branches && hasPendingResponse)
                      branches.disabled = true;

                    const shouldShowClearContextDivider =
                      i === clearContextIndex - 1;

                    // 日期分隔符：使用时间戳比较，避免反复创建 Date 对象
                    let dateSeparator: string | null = null;
                    if (!isContext && message.date) {
                      const curTime = new Date(message.date).setHours(
                        0,
                        0,
                        0,
                        0,
                      );
                      const prevMsg = i > 0 ? messages[i - 1] : null;
                      const prevTime = prevMsg?.date
                        ? new Date(prevMsg.date).setHours(0, 0, 0, 0)
                        : null;
                      if (prevTime === null || prevTime !== curTime) {
                        dateSeparator = getDateSeparatorLabel(
                          new Date(message.date),
                        );
                      }
                    }

                    return (
                      <Fragment key={message.id}>
                        {dateSeparator && (
                          <div className={styles["chat-date-separator"]}>
                            <span
                              className={styles["chat-date-separator-text"]}
                            >
                              {dateSeparator}
                            </span>
                          </div>
                        )}
                        <div
                          className={
                            isUser
                              ? styles["chat-message-user"]
                              : styles["chat-message"]
                          }
                        >
                          <div
                            className={styles["chat-message-container"]}
                            style={
                              editingMessageId === message.id
                                ? { width: "min(100%, 640px)" }
                                : undefined
                            }
                            data-message-id={message.id}
                            data-message-role={message.role}
                            data-quotable-message={
                              !isContext &&
                              !message.preview &&
                              !message.materialStatus &&
                              editingMessageId !== message.id &&
                              ["user", "assistant"].includes(message.role)
                                ? ""
                                : undefined
                            }
                            onContextMenu={(e) => {
                              const pointerType =
                                "pointerType" in e.nativeEvent
                                  ? e.nativeEvent.pointerType
                                  : undefined;
                              if (
                                pointerType === "touch" ||
                                pointerType === "pen" ||
                                (isMobileScreen && pointerType !== "mouse")
                              )
                                return;
                              if (
                                !isContext &&
                                !isMessageInteractiveTarget(e.target)
                              )
                                handleRightClick(e, message);
                            }}
                          >
                            <div className={styles["chat-message-header"]}>
                              <div className={styles["chat-message-avatar"]}>
                                <div className={styles["chat-message-edit"]}>
                                  <IconButton
                                    icon={<SquarePen aria-hidden="true" />}
                                    title={Locale.Chat.Actions.Edit}
                                    aria={Locale.Chat.Actions.Edit}
                                    disabled={
                                      isUser &&
                                      !isContext &&
                                      (hasPendingResponse ||
                                        !!message.materialStatus ||
                                        !!branches?.disabled)
                                    }
                                    onClick={async () => {
                                      if (message.materialStatus) return;
                                      if (
                                        isUser &&
                                        !isContext &&
                                        !message.preview
                                      ) {
                                        messageHandlers.current.onEditMessage(
                                          message,
                                        );
                                        return;
                                      }
                                      const newMessage = await showPrompt(
                                        Locale.Chat.Actions.Edit,
                                        getMessageTextContent(message),
                                        10,
                                      );
                                      if (newMessage === null) return;
                                      let newContent:
                                        | string
                                        | MultimodalContent[] = newMessage;
                                      const attachments = Array.isArray(
                                        message.content,
                                      )
                                        ? message.content.filter(
                                            (part) => part.type !== "text",
                                          )
                                        : [];
                                      if (attachments.length > 0) {
                                        newContent = [
                                          { type: "text", text: newMessage },
                                          ...attachments,
                                        ];
                                      }
                                      chatStore.updateTargetSession(
                                        session,
                                        (session) => {
                                          const m = session.mask.context
                                            .concat(session.messages)
                                            .find((m) => m.id === message.id);
                                          if (m) {
                                            if (
                                              getMessageTextContent(m) !==
                                              newMessage
                                            ) {
                                              m.interactions = undefined;
                                              m.optionResponse = undefined;
                                            }
                                            m.content = newContent;
                                            m.composerInput = undefined;
                                          }
                                        },
                                      );
                                    }}
                                  ></IconButton>
                                </div>
                                {isUser ? (
                                  <Avatar avatar={config.avatar} />
                                ) : (
                                  <>
                                    {["system"].includes(message.role) ? (
                                      <Avatar avatar="2699-fe0f" />
                                    ) : (
                                      <MaskAvatar
                                        avatar={session.mask.avatar}
                                        model={
                                          message.model ||
                                          session.mask.modelConfig.model
                                        }
                                      />
                                    )}
                                  </>
                                )}
                              </div>
                              {!isUser && (
                                <div className={styles["chat-message-meta"]}>
                                  <div className={styles["chat-model-name"]}>
                                    {message.model}
                                  </div>
                                  <span className={styles["chat-message-time"]}>
                                    {isContext
                                      ? Locale.Chat.IsContext
                                      : formatMessageDate(
                                          new Date(message.date),
                                        )}
                                  </span>
                                  {(!message.tools ||
                                    message.tools.length === 0) &&
                                    !message.reasoning?.length &&
                                    !(
                                      message.contextCompressing &&
                                      hasPendingResponse
                                    ) &&
                                    showTyping && (
                                      <div
                                        className={
                                          styles["chat-message-status"]
                                        }
                                      >
                                        <AiStatus
                                          state={
                                            message.content.length
                                              ? "writing"
                                              : "thinking"
                                          }
                                        />
                                      </div>
                                    )}
                                </div>
                              )}
                            </div>
                            {!isUser && !isContext && !message.preview && (
                              <ContextCompressionNotice
                                compressed={message.contextCompressed}
                                compressing={
                                  !!message.contextCompressing &&
                                  ((!!message.streaming &&
                                    hasPendingResponse) ||
                                    isContextCompressionActive(
                                      session.id,
                                      message.id,
                                    ))
                                }
                              />
                            )}
                            {/*@ts-ignore*/}
                            {message?.tools?.length > 0 && (
                              <div className={styles["chat-message-tools"]}>
                                {message?.tools?.map((tool) => (
                                  <MessageToolActivity
                                    key={tool.id}
                                    sessionId={session.id}
                                    messageId={message.id}
                                    tool={tool}
                                    disabled={
                                      !!message.streaming ||
                                      !!branches?.disabled
                                    }
                                  />
                                ))}
                              </div>
                            )}
                            <div
                              className={styles["chat-message-item"]}
                              data-waiting={waiting || undefined}
                              data-streaming={
                                (!isUser && !!message.streaming) || undefined
                              }
                              style={
                                editingMessageId === message.id
                                  ? {
                                      width: "100%",
                                      background: "transparent",
                                      padding: 0,
                                    }
                                  : undefined
                              }
                            >
                              {isUser && message.materialItems && (
                                <MaterialStatus
                                  items={message.materialItems}
                                  state={message.materialStatus}
                                  onRetry={() =>
                                    void chatStore.retryPreparedMaterials(
                                      session.id,
                                      message.id,
                                    )
                                  }
                                  onCancel={() => {
                                    const index = session.messages.findIndex(
                                      (item) => item.id === message.id,
                                    );
                                    const response =
                                      session.messages[index + 1];
                                    if (response?.role === "assistant")
                                      messageHandlers.current.onUserStop(
                                        response.id,
                                      );
                                  }}
                                />
                              )}
                              {!isUser && message.interrupted && (
                                <div role="status">
                                  输出已中断，已有内容已保留。
                                </div>
                              )}
                              {!isUser && (
                                <ReasoningPanel
                                  content={message.reasoning}
                                  streaming={!!message.streaming}
                                  interrupted={message.interrupted}
                                  hasAnswer={
                                    getMessageTextContent(message).length > 0
                                  }
                                />
                              )}
                              {!isUser && message.gallerySave === "failed" && (
                                <div role="status">
                                  保存作品失败。
                                  <button
                                    onClick={() => {
                                      const urls = generatedImageUrls(
                                        getMessageTextContent(message),
                                      );
                                      const previous = messages
                                        .slice(0, i)
                                        .reverse()
                                        .find((item) => item.role === "user");
                                      if (urls.length)
                                        void chatStore.saveGeneratedImage(
                                          session.id,
                                          message.id,
                                          urls,
                                          previous
                                            ? getMessageTextContent(previous)
                                            : "",
                                          message.model || "",
                                        );
                                    }}
                                  >
                                    重试保存
                                  </button>
                                </div>
                              )}
                              {messageQuote && (
                                <MessageQuoteView quote={messageQuote} />
                              )}
                              {editingMessageId === message.id ? (
                                <MessageEditor
                                  key={message.id}
                                  initialValue={
                                    message.composerInput?.text ??
                                    getMessageTextContent(message)
                                  }
                                  disabled={hasPendingResponse}
                                  allowEmpty={
                                    getMessageImages(message).length > 0 ||
                                    messageFiles(message).length > 0
                                  }
                                  onCancel={() =>
                                    setEditingMessageId(undefined)
                                  }
                                  onSave={(text) =>
                                    messageHandlers.current.onSaveMessage(
                                      message,
                                      text,
                                    )
                                  }
                                />
                              ) : message.videoResultId ? (
                                <ChatVideoResult id={message.videoResultId} />
                              ) : (
                                <Markdown
                                  key={message.id}
                                  searchContent={!isContext && !message.preview}
                                  imageId={
                                    !isUser
                                      ? message.imageId ?? message.id
                                      : undefined
                                  }
                                  imageRequestDurationMs={
                                    !isUser
                                      ? message.imageRequestDurationMs
                                      : undefined
                                  }
                                  streaming={
                                    !isUser &&
                                    !!message.streaming &&
                                    !getMessageTextContent(message).startsWith(
                                      "![生成预览](",
                                    )
                                  }
                                  content={
                                    isUser && messageQuote
                                      ? message.composerInput?.text ??
                                        getMessageTextContent(message)
                                      : getConversationSearchText(message)
                                  }
                                  sources={sources}
                                  isError={!isUser && message.isError}
                                  allowErrorDetails={!isUser}
                                  //   onContextMenu={(e) => onRightClick(e, message)} // hard to use
                                  onDoubleClickCapture={(event) => {
                                    if (!isMobileScreen) return;
                                    if (
                                      getMessageSelectionText(
                                        event.currentTarget,
                                      )?.trim()
                                    )
                                      return;
                                    setUserInput(
                                      getMessageTextContent(message),
                                    );
                                  }}
                                  fontSize={fontSize}
                                  fontFamily={fontFamily}
                                  parentRef={scrollRef}
                                  defaultShow={i >= messages.length - 6}
                                  onImageClick={setLightboxImage}
                                />
                              )}
                              {!isUser &&
                                !message.videoResultId &&
                                isAccountModelMode(accessStore) &&
                                message.quotaExceeded && (
                                  <QuotaPricingCard
                                    model={message.model || ""}
                                  />
                                )}
                              {!isUser && sources && (
                                <MessageSources sources={sources} />
                              )}
                              {getMessageImages(message).length == 1 && (
                                // eslint-disable-next-line @next/next/no-img-element -- User images have no size metadata; preserve their intrinsic layout and direct source.
                                <img
                                  className={styles["chat-message-item-image"]}
                                  src={getMessageImages(message)[0]}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  onClick={() =>
                                    setLightboxImage(
                                      getMessageImages(message)[0],
                                    )
                                  }
                                  style={{ cursor: "pointer" }}
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display =
                                      "none";
                                  }}
                                />
                              )}
                              {getMessageImages(message).length > 1 && (
                                <div
                                  className={styles["chat-message-item-images"]}
                                  style={
                                    {
                                      "--image-count":
                                        getMessageImages(message).length,
                                    } as React.CSSProperties
                                  }
                                >
                                  {getMessageImages(message).map(
                                    (image, index) => {
                                      return (
                                        // eslint-disable-next-line @next/next/no-img-element -- User images have no size metadata; preserve their existing responsive grid and direct source.
                                        <img
                                          className={
                                            styles[
                                              "chat-message-item-image-multi"
                                            ]
                                          }
                                          key={index}
                                          src={image}
                                          alt=""
                                          loading="lazy"
                                          decoding="async"
                                          onClick={() =>
                                            setLightboxImage(image)
                                          }
                                          style={{ cursor: "pointer" }}
                                          onError={(e) => {
                                            (
                                              e.target as HTMLElement
                                            ).style.display = "none";
                                          }}
                                        />
                                      );
                                    },
                                  )}
                                </div>
                              )}
                            </div>

                            {interactions?.options && (
                              <MessageOptionList
                                key={`${message.id}:${
                                  interactions.options.id
                                }:${
                                  optionReceipt?.userMessageId ??
                                  latestMessageId
                                }`}
                                definition={interactions.options}
                                receipt={optionReceipt}
                                disabled={interactionsDisabled || !latestAnswer}
                                onSubmit={(selectedIds) =>
                                  messageHandlers.current.onSubmitMessageOptions(
                                    message.id,
                                    interactions.options!.id,
                                    selectedIds,
                                  )
                                }
                              />
                            )}
                            {latestAnswer &&
                              interactions?.suggestions?.length && (
                                <FollowupSuggestions
                                  key={message.id}
                                  suggestions={interactions.suggestions}
                                  disabled={interactionsDisabled}
                                  onSelect={(text) =>
                                    messageHandlers.current.onFollowupSelect(
                                      message.id,
                                      text,
                                    )
                                  }
                                />
                              )}

                            {branches && branches.total > 1 && (
                              <nav
                                className={styles["message-branch-picker"]}
                                aria-label={isUser ? "问题版本" : "回答版本"}
                              >
                                <button
                                  type="button"
                                  aria-label={
                                    isUser ? "上一个问题" : "上一个回答"
                                  }
                                  title={isUser ? "上一个问题" : "上一个回答"}
                                  disabled={
                                    branches.disabled || branches.index === 0
                                  }
                                  onClick={() => {
                                    messageHandlers.current.reader.stop();
                                    chatStore.selectMessageBranch(
                                      session.id,
                                      message.id,
                                      branches.messageIds[branches.index - 1],
                                    );
                                  }}
                                >
                                  <ChevronLeft size={16} aria-hidden="true" />
                                </button>
                                <span
                                  role="status"
                                  aria-label={`第 ${branches.index + 1} 个${
                                    isUser ? "问题" : "回答"
                                  }，共 ${branches.total} 个`}
                                >
                                  {branches.index + 1} / {branches.total}
                                </span>
                                <button
                                  type="button"
                                  aria-label={
                                    isUser ? "下一个问题" : "下一个回答"
                                  }
                                  title={isUser ? "下一个问题" : "下一个回答"}
                                  disabled={
                                    branches.disabled ||
                                    branches.index === branches.total - 1
                                  }
                                  onClick={() => {
                                    messageHandlers.current.reader.stop();
                                    chatStore.selectMessageBranch(
                                      session.id,
                                      message.id,
                                      branches.messageIds[branches.index + 1],
                                    );
                                  }}
                                >
                                  <ChevronRight size={16} aria-hidden="true" />
                                </button>
                              </nav>
                            )}
                            {showActions &&
                              !isUser &&
                              !message.videoResultId &&
                              !message.streaming &&
                              !message.isError &&
                              !message.interrupted && (
                                <div
                                  className={
                                    styles["chat-message-community-share"]
                                  }
                                >
                                  <CommunityShareButton
                                    kind={
                                      messageShareSource(
                                        message.content,
                                        "",
                                        "",
                                      ).kind
                                    }
                                    resultId={message.id}
                                    sourceWorkId={
                                      messageGeneration(
                                        session.messages,
                                        message.id,
                                      )?.sourceWorkId
                                    }
                                    source={() => {
                                      const generation = messageGeneration(
                                        session.messages,
                                        message.id,
                                      );
                                      return {
                                        ...messageShareSource(
                                          message.content,
                                          generation?.prompt ?? "",
                                          generation?.model ||
                                            message.model ||
                                            "",
                                        ),
                                        references: generation?.references.map(
                                          (url) => ({ url }),
                                        ),
                                        sourceWorkId: generation?.sourceWorkId,
                                      };
                                    }}
                                  />
                                </div>
                              )}
                            {showActions && (
                              <div className={styles["chat-message-actions"]}>
                                {message.streaming ? (
                                  <div className={styles["chat-input-actions"]}>
                                    <ChatAction
                                      text={Locale.Chat.Actions.Stop}
                                      icon={<Square size={16} />}
                                      onClick={() =>
                                        messageHandlers.current.onUserStop(
                                          message.id ?? i,
                                        )
                                      }
                                    />
                                  </div>
                                ) : (
                                  <ChatMessageActions
                                    compact={isMobileScreen}
                                    onQuoteSelection={(text) => {
                                      const quote = createMessageQuote(
                                        message,
                                        text,
                                      );
                                      if (quote)
                                        messageHandlers.current.onQuoteSelected(
                                          quote,
                                        );
                                    }}
                                    actions={[
                                      {
                                        id: "retry",
                                        text: Locale.Chat.Actions.Retry,
                                        icon: <RotateCw size={16} />,
                                        onClick: () =>
                                          messageHandlers.current.onResend(
                                            message,
                                          ),
                                      },
                                      {
                                        id: "reuse",
                                        text: Locale.Chat.Actions.Reuse,
                                        icon: <CopyPlus size={16} />,
                                        onClick: () =>
                                          void messageHandlers.current.onReuseInput(
                                            message,
                                          ),
                                      },
                                      {
                                        id: "delete",
                                        text: Locale.Chat.Actions.Delete,
                                        icon: <Trash2 size={16} />,
                                        destructive: true,
                                        onClick: () =>
                                          messageHandlers.current.onDelete(
                                            message.id ?? i,
                                          ),
                                      },
                                      {
                                        id: "pin",
                                        text: Locale.Chat.Actions.Pin,
                                        icon: <Pin size={16} />,
                                        onClick: () =>
                                          messageHandlers.current.onPinMessage(
                                            message,
                                          ),
                                      },
                                      {
                                        id: "copy",
                                        text: copyImages.length
                                          ? copyImages.length > 1
                                            ? "复制首张图片"
                                            : "复制图片"
                                          : Locale.Chat.Actions.Copy,
                                        icon: <Copy size={16} />,
                                        onClick: () => {
                                          if (copyImages.length) {
                                            void copyImageToClipboard(() =>
                                              loadImageAsset(
                                                copyImages[0],
                                                message.imageId ?? message.id,
                                              ),
                                            );
                                          } else {
                                            void copyToClipboard(
                                              getMessageTextContent(message),
                                            );
                                          }
                                        },
                                      },
                                      ...(!isUser && reader.supported
                                        ? [
                                            {
                                              id: "speech",
                                              text:
                                                reader.activeId === message.id
                                                  ? Locale.Chat.Actions
                                                      .StopSpeech
                                                  : Locale.Chat.Actions.Speech,
                                              title:
                                                reader.activeId === message.id
                                                  ? "停止朗读"
                                                  : Locale.Chat.Actions.Speech,
                                              icon:
                                                reader.activeId ===
                                                message.id ? (
                                                  <Square size={16} />
                                                ) : (
                                                  <Volume2 size={16} />
                                                ),
                                              selected:
                                                reader.activeId === message.id,
                                              keepVisible:
                                                reader.activeId === message.id,
                                              onClick: () =>
                                                reader.activeId === message.id
                                                  ? messageHandlers.current.reader.stop()
                                                  : messageHandlers.current.reader.speak(
                                                      message.id ?? String(i),
                                                      getMessageTextContent(
                                                        message,
                                                      ),
                                                    ),
                                            },
                                          ]
                                        : []),
                                    ]}
                                  />
                                )}
                              </div>
                            )}
                            {isUser && (
                              <div
                                className={styles["chat-message-action-date"]}
                              >
                                {isContext
                                  ? Locale.Chat.IsContext
                                  : formatMessageDate(new Date(message.date))}
                              </div>
                            )}
                          </div>
                        </div>
                        {shouldShowClearContextDivider && (
                          <ClearContextDivider />
                        )}
                      </Fragment>
                    );
                  };
                  return {
                    nodes: (showWelcome ? [] : messages).flatMap(
                      (message, i) =>
                        message.preview && message.role === "user"
                          ? []
                          : [renderMessage(message, i)],
                    ),
                    renderMessage,
                    previewIndex: messages.findIndex(
                      (message) => message.preview && message.role === "user",
                    ),
                  };
                }, [
                  showWelcome,
                  messages,
                  msgRenderIndex,
                  session,
                  context.length,
                  clearContextIndex,
                  chatStore,
                  accessStore,
                  config.avatar,
                  fontSize,
                  fontFamily,
                  isMobileScreen,
                  handleRightClick,
                  reader.supported,
                  reader.activeId,
                  hasPendingResponse,
                  editingMessageId,
                  messageSources,
                  messageOptionReceipts,
                  latestMessageId,
                  interactionsDisabled,
                ])}
              />
            </div>
            <div {...composerFocus} className={styles["chat-input-panel"]}>
              <AccountReadiness
                model={
                  [...messages]
                    .reverse()
                    .find((message) => message.quotaExceeded)?.model ||
                  session.mask.modelConfig.model
                }
              />
              {showScrollButton && (
                <IconButton
                  className={styles["chat-scroll-bottom"]}
                  icon={<ArrowDown size={20} aria-hidden="true" />}
                  aria={Locale.Chat.InputActions.ToBottom}
                  title={Locale.Chat.InputActions.ToBottom}
                  onClick={scrollToBottom}
                  bordered
                  shadow
                />
              )}
              <PromptHints
                prompts={promptHints}
                onPromptSelect={onPromptSelect}
                onClose={() => {
                  onSearch.cancel();
                  setPromptHints([]);
                  setPromptHintsDismissed(true);
                  inputRef.current?.focus();
                }}
                emptyAction={
                  showNoEnabledPrompts
                    ? () => {
                        void preloadWorkspaceRoute(Path.Settings, "activation");
                        navigate(Path.Settings, {
                          state: { managePrompts: true },
                        });
                      }
                    : undefined
                }
                onEmptyActionIntent={(activation) => {
                  void preloadWorkspaceRoute(
                    Path.Settings,
                    activation ? "activation" : "intent",
                  );
                }}
              />

              {isImageComposer && promptLength > IMAGE_PROMPT_LIMIT && (
                <div
                  id="image-prompt-counter"
                  className={styles["image-prompt-counter"]}
                  data-invalid="true"
                  role="alert"
                >
                  提示词超过 32,000 字符，请精简后再发送（当前{" "}
                  {promptLength.toLocaleString("en-US")} 字符）
                </div>
              )}
              {materials.items.some((item) => item.status !== "ready") && (
                <MaterialStatus
                  items={materials.items.filter(
                    (item) => item.status !== "ready",
                  )}
                  state={uploading ? "processing" : "failed"}
                  onRetry={() => materialDraft.retry()}
                  onRemove={(id) => materialDraft.remove(id)}
                />
              )}
              {attachFiles.length > 0 && (
                <div className={styles["attach-files"]}>
                  {attachFiles.map((file, index) => (
                    <button
                      key={`${file.name}-${index}`}
                      type="button"
                      title={`移除 ${file.name}`}
                      aria-label={`移除 ${file.name}`}
                      onClick={() =>
                        materialDraft.remove(materials.files[index].id)
                      }
                    >
                      <FolderOpen size={14} aria-hidden="true" />
                      <FileName name={file.name} />
                      <CloseIcon aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
              {embedded && (
                <ComposerBilling
                  model={session.mask.modelConfig.model}
                  customProvider={usesCustomProvider(
                    accessStore,
                    session.mask.modelConfig.providerName,
                  )}
                />
              )}
              {!embedded &&
                !isImageComposer &&
                capabilities.category !== "video" && (
                  <ContextUsage
                    session={session}
                    draftText={userInput}
                    imageCount={attachImages.length}
                    files={attachFiles}
                    quote={draftQuote}
                    mobile={isMobileScreen}
                    pendingAttachments={materials.pending}
                  />
                )}
              <div
                className={styles["chat-input-panel-inner"]}
                role="group"
                aria-label="消息输入"
                data-composer-focus-area
              >
                {draftQuote && (
                  <MessageQuoteView
                    quote={draftQuote}
                    onRemove={() => {
                      updateDraftQuote(undefined);
                      inputRef.current?.focus();
                    }}
                  />
                )}
                <textarea
                  id="chat-input"
                  ref={inputRef}
                  className={styles["chat-input"]}
                  placeholder={Locale.Chat.InputPlaceholder}
                  title={Locale.Chat.Input(submitKey)}
                  onInput={(e) => onInput(e.currentTarget.value)}
                  value={userInput}
                  aria-describedby={
                    isImageComposer && promptLength > IMAGE_PROMPT_LIMIT
                      ? "image-prompt-counter"
                      : undefined
                  }
                  aria-invalid={
                    isImageComposer && promptLength > IMAGE_PROMPT_LIMIT
                  }
                  onKeyDown={onInputKeyDown}
                  onKeyUp={onKeyUp}
                  onCompositionStart={onCompositionStart}
                  onCompositionEnd={onCompositionEnd}
                  onPaste={handlePaste}
                  rows={inputRows}
                  aria-label={Locale.Chat.InputPlaceholder}
                  role="textbox"
                  aria-multiline="true"
                  style={{
                    fontFamily: config.fontFamily,
                  }}
                />
                {attachImages.length != 0 && (
                  <div className={styles["attach-images"]}>
                    {attachImages.map((image, index) => {
                      return (
                        <div
                          key={index}
                          className={styles["attach-image"]}
                          style={{ backgroundImage: `url("${image}")` }}
                        >
                          <div className={styles["attach-image-mask"]}>
                            <DeleteImageButton
                              deleteImage={() => {
                                materialDraft.remove(
                                  materials.images[index].id,
                                );
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <ChatActions
                  uploading={uploading}
                  handleFileUpload={handleFileUpload}
                  onComposerActionComplete={restoreAfterAction}
                  isImageSkill={isImageComposer}
                  referenceCount={attachImages.length}
                  onSkillOpen={() => {
                    onSearch.cancel();
                    setPromptHints([]);
                    setPromptHintsDismissed(true);
                  }}
                >
                  <div className={styles["chat-input-send-actions"]}>
                    <button
                      type="button"
                      className={clsx(styles["chat-input-action-btn"], {
                        [styles["active"]]: voiceInput.isListening,
                      })}
                      onClick={() => {
                        if (voiceInput.isListening) {
                          voiceInput.stop();
                        } else {
                          voiceInput.start();
                        }
                      }}
                      title={voiceInput.isListening ? "停止语音" : "语音输入"}
                      aria-label={
                        voiceInput.isListening ? "停止语音" : "语音输入"
                      }
                      aria-pressed={voiceInput.isListening}
                    >
                      {voiceInput.isListening ? (
                        <FluidOrb
                          levelRef={voiceInput.levelRef}
                          style={{ width: "100%", height: "100%" }}
                        />
                      ) : (
                        <Mic aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      className={styles["chat-input-action-btn"]}
                      onClick={() => setIsEditingInput(true)}
                      title="展开编辑"
                      aria-label="展开编辑"
                    >
                      <Maximize2 aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={clsx(
                        styles["chat-input-action-btn"],
                        styles["primary"],
                        { [styles["stopping"]]: showStop },
                      )}
                      disabled={
                        !showStop &&
                        ((!isLocalPreview &&
                          isAccountModelMode(accessStore) &&
                          !usesCustomProvider(
                            accessStore,
                            session.mask.modelConfig.providerName,
                          ) &&
                          (accessStore.switchingToken ||
                            accessStore.modelListStatus !== "ready")) ||
                          (isImageComposer &&
                            promptLength > IMAGE_PROMPT_LIMIT) ||
                          !hasDraft)
                      }
                      onClick={() => {
                        if (showStop) {
                          ChatControllerPool.stopSession(session.id, {
                            preserveTasks: true,
                          });
                        } else {
                          doSubmit(userInput);
                        }
                      }}
                      title={
                        showStop
                          ? Locale.Chat.InputActions.Stop
                          : Locale.Chat.Send
                      }
                      aria-label={
                        showStop
                          ? Locale.Chat.InputActions.Stop
                          : Locale.Chat.Send
                      }
                    >
                      {showStop ? (
                        <Square
                          aria-hidden="true"
                          fill="currentColor"
                          strokeWidth={0}
                        />
                      ) : (
                        <ArrowUp aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </ChatActions>
              </div>
            </div>
          </div>
        </ChatSplitPane>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={`image/*,video/*,audio/*,${getFileAccept()}`}
        aria-label={Locale.Chat.InputActions.UploadFile}
        multiple
        style={{ display: "none" }}
        onChange={onFileSelected}
      />
      {showExport && (
        <ExportMessageModal onClose={() => setShowExport(false)} />
      )}

      {isEditingMessage && (
        <EditMessageModal
          onClose={() => {
            setIsEditingMessage(false);
          }}
        />
      )}

      {isEditingInput && (
        <EditInputModal
          initialValue={userInput}
          onConfirm={(text) => {
            setUserInput(text);
            inputRef.current?.focus();
          }}
          onClose={() => setIsEditingInput(false)}
        />
      )}

      {lightboxImage && (
        <Lightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />
      )}

      {contextMenu && (
        <ChatContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onCopy={(content) => {
            copyToClipboard(content);
            showToast(Locale.Copy.Success);
          }}
          onQuote={(text) => {
            const message = session.messages.find(
              (item) => item.id === contextMenu.messageId,
            );
            const quote = message && createMessageQuote(message, text);
            if (quote) onQuoteSelected(quote);
          }}
          onDelete={(id) => onDelete(id)}
          onRetry={(id) => {
            const msg = session.messages.find((m) => m.id === id);
            if (msg) onResend(msg);
          }}
          onEdit={() => {
            const message = session.messages.find(
              (item) => item.id === contextMenu.messageId,
            );
            if (message) onEditMessage(message);
          }}
          onPin={(id) => {
            const msg = session.messages.find((m) => m.id === id);
            if (msg) onPinMessage(msg);
          }}
          isStreaming={
            !!session.messages.find((m) => m.id === contextMenu.messageId)
              ?.streaming
          }
        />
      )}
    </>
  );
}

const MemoizedChatSession = React.memo(ChatSession);

export function Chat({ embedded = false }: { embedded?: boolean } = {}) {
  const sessionId = useChatStore((state) => activeChatSession(state)?.id);
  return sessionId !== undefined ? (
    <MemoizedChatSession key={sessionId} embedded={embedded} />
  ) : null;
}
