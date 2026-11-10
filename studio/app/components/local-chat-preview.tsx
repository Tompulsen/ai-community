"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Calculator,
  FileText,
  Gauge,
  Images,
  PanelsTopLeft,
  Play,
  Shrink,
  Tags,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { createMessage, useChatStore } from "../store/chat";
import { createEmptyMask } from "../store/mask";
import {
  isLocalPreviewEnabled,
  LOCAL_PREVIEW_COMPONENTS_MODEL,
  LOCAL_PREVIEW_COMPRESSION_MODEL,
  LOCAL_PREVIEW_LONG_MODEL,
  LOCAL_PREVIEW_MEDIA_MODEL,
  LOCAL_PREVIEW_METRICS_MODEL,
  LOCAL_PREVIEW_NO_USAGE_MODEL,
  LOCAL_PREVIEW_PROVIDER,
} from "../utils/local-preview-models";
import {
  getLocalScope,
  isLocalWorkspaceActive,
} from "../utils/local-workspace";
import { ChatActionMenu } from "./chat-action";
import { showToast } from "./ui-lib";

type PreviewScene = {
  key: string;
  model: string;
  label: string;
  icon: LucideIcon;
  streamOnLink?: boolean;
  completeLabel?: string;
  streamLabel?: string;
};

const scenes: PreviewScene[] = [
  {
    key: "long",
    model: LOCAL_PREVIEW_LONG_MODEL,
    label: "长文本",
    icon: FileText,
  },
  {
    key: "components",
    model: LOCAL_PREVIEW_COMPONENTS_MODEL,
    label: "组件",
    icon: PanelsTopLeft,
  },
  {
    key: "media",
    model: LOCAL_PREVIEW_MEDIA_MODEL,
    label: "图片与视频",
    icon: Images,
  },
  {
    key: "metrics",
    model: LOCAL_PREVIEW_METRICS_MODEL,
    label: "指标变化",
    icon: Gauge,
    streamOnLink: true,
  },
  {
    key: "estimated",
    model: LOCAL_PREVIEW_NO_USAGE_MODEL,
    label: "估算速度",
    icon: Calculator,
    streamOnLink: true,
  },
  {
    key: "compression",
    model: LOCAL_PREVIEW_COMPRESSION_MODEL,
    label: "自动压缩",
    icon: Shrink,
    streamOnLink: true,
    completeLabel: "压缩前",
    streamLabel: "模拟压缩",
  },
];

export function LocalChatPreview({
  open,
  onClose,
  onBusyChange,
}: {
  open: boolean;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const starting = useRef(false);
  const initialPreview = useRef(false);
  const id = useId();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  const startPreview = useCallback(
    async (model: string, stream: boolean) => {
      if (
        starting.current ||
        !isLocalPreviewEnabled() ||
        !isLocalWorkspaceActive()
      )
        return;
      starting.current = true;
      setBusy(true);
      try {
        const owner = getLocalScope();
        const previousSessionId = useChatStore.getState().currentSession().id;
        const { getLocalPreviewResponse, getLocalPreviewHistory } =
          await import("../utils/local-preview-response");
        if (
          !isLocalWorkspaceActive() ||
          getLocalScope() !== owner ||
          useChatStore.getState().currentSession().id !== previousSessionId
        )
          return;
        const scene = scenes.find((item) => item.model === model);
        if (!scene) return;
        const response = getLocalPreviewResponse(model);
        const prompt = `${scene.label}预览`;
        const mask = createEmptyMask();
        mask.name = `本地测试 · ${scene.label}`;
        mask.context = [];
        mask.syncGlobalConfig = false;
        mask.modelConfig = {
          ...mask.modelConfig,
          model,
          providerName: LOCAL_PREVIEW_PROVIDER,
          stream: true,
          sendMemory: model === LOCAL_PREVIEW_COMPRESSION_MODEL,
          enableInjectSystemPrompts: false,
          ...(model === LOCAL_PREVIEW_COMPRESSION_MODEL
            ? { compressionThreshold: 2000 }
            : {}),
        };
        const store = useChatStore.getState();
        store.newSession(mask);
        const session = useChatStore.getState().currentSession();
        store.updateTargetSession(session, (target) => {
          target.topic = mask.name;
          target.messages = getLocalPreviewHistory(model).map((message) =>
            createMessage({
              ...message,
              model: message.role === "assistant" ? model : undefined,
            }),
          );
        });
        if (stream) {
          void useChatStore.getState().onUserInput(prompt);
        } else if (model !== LOCAL_PREVIEW_COMPRESSION_MODEL) {
          store.updateTargetSession(session, (target) => {
            target.messages = [
              ...target.messages,
              createMessage({ role: "user", content: prompt }),
              createMessage({
                role: "assistant",
                model,
                content: response.content,
                reasoning: response.reasoning,
                tools: response.tools,
                responseMetrics: response.responseMetrics,
              }),
            ];
            target.stat.charCount = prompt.length + response.content.length;
          });
        }
        if (location.pathname !== Path.Chat && location.pathname !== Path.Home)
          navigate(Path.Chat);
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "本地预览加载失败，请重试",
        );
      } finally {
        starting.current = false;
        setBusy(false);
      }
    },
    [location.pathname, navigate],
  );

  useEffect(() => {
    if (!isLocalPreviewEnabled() || initialPreview.current) return;
    const params = new URLSearchParams(location.search);
    const preview = params.get("local-preview");
    const scene = scenes.find((item) => item.key === preview);
    if (!scene) return;
    initialPreview.current = true;
    params.delete("local-preview");
    navigate(
      {
        pathname: location.pathname,
        search: params.size ? `?${params.toString()}` : "",
      },
      { replace: true },
    );
    void startPreview(scene.model, !!scene.streamOnLink);
  }, [location.pathname, location.search, navigate, startPreview]);

  if (!isLocalPreviewEnabled()) return null;

  return (
    <ChatActionMenu
      id={id}
      title="本地测试"
      open={open}
      onClose={onClose}
      actions={[
        ...scenes.flatMap((scene) =>
          [false, true].map((stream) => ({
            id: `${scene.model}-${stream ? "stream" : "complete"}`,
            text: `${scene.label} · ${
              stream
                ? scene.streamLabel ?? "模拟输出"
                : scene.completeLabel ?? "完整展示"
            }`,
            icon: stream ? (
              <Play aria-hidden="true" />
            ) : (
              <scene.icon aria-hidden="true" />
            ),
            onClick: () => void startPreview(scene.model, stream),
          })),
        ),
        {
          id: "account-preview",
          text: "账号与密钥 · 本地预览",
          icon: <UserRound aria-hidden="true" />,
          onClick: () => navigate(`${Path.Account}?local-preview=account`),
        },
        {
          id: "pricing-preview",
          text: "模型价格 · 本地预览",
          icon: <Tags aria-hidden="true" />,
          onClick: () => navigate(`${Path.Pricing}?local-preview=account`),
        },
      ]}
    />
  );
}
