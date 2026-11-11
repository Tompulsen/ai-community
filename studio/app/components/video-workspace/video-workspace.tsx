"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { videoGenerationMetadata } from "../../utils/community-share";
import { useCommunityRemix, remixImages } from "../../utils/community-remix";
import { CommunityShareButton } from "../community-share-button";
import { QuotaPricingCard } from "../quota-pricing-card";
import { isInsufficientBalance } from "../../utils/quota-error";
import { VideoPromptInput } from "./video-prompt-input";
import { VideoParameterControls } from "./video-parameter-controls";
import { ModelSelect } from "../model-select";
import { SelectionDialog } from "../selection-dialog";
import styles from "./video-workspace.module.scss";
import parameterStyles from "./video-parameter-controls.module.scss";
import {
  Clapperboard,
  Plus,
  ChevronDown,
  ArrowUp,
  SlidersHorizontal,
  Download,
  Trash2,
  Music2,
  X,
  MoreHorizontal,
  RotateCcw,
  Pause,
  ArrowDown,
  RectangleHorizontal,
  RefreshCw,
  Image as ImageIcon,
  Images,
  Type,
  Columns2,
  CopyPlus,
  Check,
} from "lucide-react";
import {
  useVideoStore,
  type VideoGenMode,
  type VideoResult,
  type VideoDraft,
} from "../../store/video";
import {
  Select,
  showConfirm,
  showImageModal,
  showModal,
  showToast,
} from "../ui-lib";
import { SmoothPanelContent } from "../smooth-panel-content";
import { nanoid } from "nanoid";
import { PageHeader } from "../page-header";
import { refetchModels, useAccessStore } from "../../store/access";
import { getModelProvider } from "../../utils/model";
import { useAllModels } from "../../utils/hooks";
import { useAnchoredPanel } from "../../utils/use-anchored-panel";
import { isSelectMenuWithin } from "../../utils/select-interaction";
import { useModelCapabilitiesResolver } from "../../utils/model-capabilities";
import { CUSTOM_MODEL_PROVIDER } from "../../utils/custom-provider";
import {
  buildVideoRequest,
  videoApiFormat,
  videoOptions,
  parseVideoCustomParams,
  openaiVideoReference,
  videoBuiltinParameters,
  videoParameterFormat,
  videoCustomParams,
  videoUploadMode,
  MAX_VIDEO_REFERENCES,
} from "../../utils/video-api";
import { fetchVideoMedia } from "../../utils/video-media";
import Image from "next/image";
import {
  cachedVideoPoster,
  videoPosterCapture,
} from "../../utils/video-poster";
import {
  getLocalScope,
  isLocalWorkspaceActive,
} from "../../utils/local-workspace";
import { prefersReducedMotion } from "../../utils/motion";
import { formatMessageDate } from "../../utils/format";
import {
  generateVideoRequest,
  stopVideoWaiting,
  resumeVideoRequest,
  reuseVideoRequest,
} from "../../utils/video-generation";

// ─── 常量 ──────────────────────────────────────────────────────────

const MODE_OPTIONS: { value: VideoGenMode; label: string }[] = [
  { value: "text-to-video", label: "文生视频" },
  { value: "image-to-video", label: "图生视频" },
  { value: "first-last-frame", label: "首尾帧" },
  { value: "reference-to-video", label: "多图参考" },
];

const MODE_LABELS: Record<VideoGenMode, string> = {
  "text-to-video": "文生视频",
  "image-to-video": "图生视频",
  "first-last-frame": "首尾帧",
  "reference-to-video": "多图参考",
};

const MODE_ICONS = {
  "text-to-video": Type,
  "image-to-video": ImageIcon,
  "first-last-frame": Columns2,
  "reference-to-video": Images,
};

// ─── 胶囊下拉组件 ──────────────────────────────────────────────────

interface DropdownOption {
  value: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
}

function videoPanelMinimumTop(trigger: HTMLElement, viewportTop: number) {
  const header = trigger
    .closest(`.${styles["video-workspace"]}`)
    ?.querySelector<HTMLElement>(".window-header");
  return (header?.getBoundingClientRect().bottom ?? viewportTop) + 6;
}

function CapsuleDropdown({
  label,
  value,
  options,
  onSelect,
  width,
  maxHeight = 280,
  className,
  trigger,
  ariaLabel,
  actions,
  panelContent,
}: {
  label: string;
  value: string;
  options: DropdownOption[];
  onSelect: (v: string) => void;
  width?: number;
  maxHeight?: number;
  className?: string;
  trigger?: React.ReactNode;
  ariaLabel?: string;
  actions?: React.ReactNode;
  panelContent?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelStyle = useAnchoredPanel(
    open,
    triggerRef,
    panelRef,
    width ?? 220,
    { align: "center", minimumTop: videoPanelMinimumTop, maxHeight },
  );
  useLayoutEffect(() => {
    if (!open || panelStyle.visibility !== "visible") return;
    const panel = panelRef.current;
    const targets = Array.from(
      panel?.querySelectorAll<HTMLElement>(
        "input:checked, button:not(:disabled), input:not(:disabled), summary",
      ) ?? [],
    ).filter((element) => element.getClientRects().length > 0);
    (
      targets.find((element) =>
        element.matches('input:checked, button[aria-pressed="true"]'),
      ) ?? targets[0]
    )?.focus({ preventScroll: true });
  }, [open, panelStyle.visibility]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      if (
        !ref.current?.contains(e.target as Node) &&
        !panelRef.current?.contains(e.target as Node) &&
        !isSelectMenuWithin(e.target as Node, panelRef.current)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [open]);

  return (
    <div
      className={[styles["capsule-wrapper"], className]
        .filter(Boolean)
        .join(" ")}
      ref={ref}
      onBlur={(e) => {
        if (
          !e.currentTarget.contains(e.relatedTarget) &&
          !panelRef.current?.contains(e.relatedTarget) &&
          !(
            e.relatedTarget instanceof Node &&
            isSelectMenuWithin(e.relatedTarget, panelRef.current)
          )
        )
          setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open && !e.defaultPrevented) {
          e.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`${styles["capsule-btn"]} ${open ? styles.active : ""}`}
        aria-expanded={open}
        aria-label={ariaLabel ?? [label, value].filter(Boolean).join("：")}
        title={ariaLabel}
        onClick={() => setOpen(!open)}
      >
        {trigger ?? (
          <>
            <span className={styles["capsule-label"]}>{label}</span>
            {value && <span className={styles["capsule-value"]}>{value}</span>}
            <ChevronDown
              className={`${styles["capsule-arrow"]} ${open ? styles.up : ""}`}
              size={14}
              aria-hidden="true"
            />
          </>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={styles["capsule-popup"]}
            style={panelStyle}
          >
            {panelContent}
            {options.map((opt) => (
              <button
                type="button"
                disabled={opt.disabled}
                key={opt.value}
                aria-pressed={opt.value === value}
                className={`${styles["popup-item"]} ${
                  opt.disabled ? styles.disabled : ""
                }`}
                onClick={() => {
                  if (opt.disabled) return;
                  onSelect(opt.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <span className={styles["popup-item-label"]}>{opt.label}</span>
                {opt.value === value && (
                  <Check
                    className={styles["popup-item-check"]}
                    size={14}
                    aria-hidden="true"
                  />
                )}
                {opt.sublabel && (
                  <span className={styles["popup-item-sub"]}>
                    {opt.sublabel}
                  </span>
                )}
              </button>
            ))}
            {actions && (
              <div
                className={styles["result-menu"]}
                role="group"
                aria-label="视频操作"
                onClick={(event) => {
                  if (
                    (event.target as Element).closest("button:not(:disabled)")
                  ) {
                    setOpen(false);
                    triggerRef.current?.focus({ preventScroll: true });
                  }
                }}
              >
                {actions}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

// ─── 素材上传入口 ──────────────────────────────────────────────────

function MaterialUpload() {
  const { draft, addMaterial, updateDraft } = useVideoStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files) return;
      const owner = getLocalScope();
      const remaining =
        MAX_VIDEO_REFERENCES - useVideoStore.getState().draft.materials.length;
      if (remaining <= 0) {
        showToast(`最多使用 ${MAX_VIDEO_REFERENCES} 张参考图`);
        return;
      }
      const toProcess = Array.from(files).slice(0, remaining);
      for (const file of toProcess) {
        if (!/^image\/(?:png|jpeg|webp)$/.test(file.type)) {
          showToast(`${file.name} 不是支持的 PNG、JPEG 或 WebP 图片`);
          continue;
        }
        if (file.size > 20 * 1024 * 1024) {
          showToast(`${file.name} 超过 20MB，已跳过`);
          continue;
        }
        try {
          const url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () =>
              reject(new Error(`${file.name} 读取失败，请重新上传`));
            reader.readAsDataURL(file);
          });
          if (!isLocalWorkspaceActive() || getLocalScope() !== owner) return;
          const current = useVideoStore.getState().draft;
          if (current.materials.length >= MAX_VIDEO_REFERENCES) {
            showToast(`最多使用 ${MAX_VIDEO_REFERENCES} 张参考图`);
            break;
          }
          updateDraft({
            mode: videoUploadMode(current.mode, current.materials.length + 1),
            ...(current.apiFormat === "openai"
              ? { openaiReferenceSource: "upload" }
              : {}),
          });
          addMaterial({
            id: nanoid(8),
            type: "image",
            url,
            name: file.name,
          });
        } catch (error) {
          showToast((error as Error).message);
        }
      }
    },
    [addMaterial, updateDraft],
  );

  return (
    <div
      className={styles["material-entry"]}
      role="button"
      tabIndex={0}
      aria-label="上传参考内容"
      title="上传素材"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fileRef.current?.click();
        }
      }}
      onClick={() => fileRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        e.currentTarget.classList.add(styles["drag-over"]);
      }}
      onDragLeave={(e) => {
        e.currentTarget.classList.remove(styles["drag-over"]);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.currentTarget.classList.remove(styles["drag-over"]);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className={styles["material-entry-inner"]}>
        <Plus size={18} aria-hidden="true" />
        <span className={styles["material-entry-text"]}>上传素材</span>
        {draft.materials.length > 0 &&
          !(
            draft.apiFormat === "openai" &&
            draft.mode === "image-to-video" &&
            draft.openaiReferenceSource &&
            draft.openaiReferenceSource !== "upload"
          ) && (
            <span className={styles["material-count"]}>
              {draft.materials.length}
            </span>
          )}
      </div>
    </div>
  );
}

// ─── 素材缩略图列表 ────────────────────────────────────────────────

function MaterialThumbnails() {
  const { draft, removeMaterial } = useVideoStore();

  if (
    draft.materials.length === 0 ||
    (draft.apiFormat === "openai" &&
      draft.mode === "image-to-video" &&
      draft.openaiReferenceSource &&
      draft.openaiReferenceSource !== "upload")
  )
    return null;

  return (
    <div className={styles["material-thumbs"]}>
      {draft.materials.map((m, idx) => (
        <div key={m.id} className={styles["material-thumb"]}>
          <div className={styles["thumb-preview"]}>
            {m.type === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.url} alt={m.name} />
            )}
            {m.type === "video" && <video src={m.url} muted playsInline />}
            {m.type === "audio" && (
              <div className={styles["thumb-audio"]}>
                <Music2 size={16} aria-hidden="true" />
              </div>
            )}
            <span className={styles["thumb-index"]}>
              {draft.mode === "first-last-frame"
                ? idx === 0
                  ? "首帧"
                  : "尾帧"
                : `图片${idx + 1}`}
            </span>
          </div>
          <button
            className={styles["thumb-remove"]}
            aria-label={`移除素材 ${m.name}`}
            title={`移除素材 ${m.name}`}
            onClick={() => removeMaterial(m.id)}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── 结果卡片 ──────────────────────────────────────────────────────

function RequestParameters({ result }: { result: VideoResult }) {
  return (
    <>
      {result.mode && <span>{MODE_LABELS[result.mode]}</span>}
      {result.size ? (
        <span>{result.size}</span>
      ) : (
        <>
          {result.aspectRatio && (
            <span>
              {result.aspectRatio === "adaptive" ? "自动" : result.aspectRatio}
            </span>
          )}
          {result.resolution && <span>{result.resolution}</span>}
        </>
      )}
      {!!result.duration && <span>{result.duration} 秒</span>}
    </>
  );
}

function ResultMore({ onDelete }: { onDelete: () => void }) {
  return (
    <CapsuleDropdown
      className={styles["result-more"]}
      label=""
      value=""
      options={[]}
      onSelect={() => {}}
      width={176}
      ariaLabel="更多视频操作"
      trigger={<MoreHorizontal size={16} aria-hidden="true" />}
      actions={
        <>
          <button
            type="button"
            className={styles["delete-btn"]}
            aria-label="删除视频"
            onClick={onDelete}
          >
            <Trash2 size={14} aria-hidden="true" />
            删除记录
          </button>
        </>
      }
    />
  );
}

function RequestStatus({
  result,
  onReuse,
  onDelete,
}: {
  result: VideoResult;
  onReuse?: () => void;
  onDelete?: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  const busy = useVideoStore((state) => state.isGenerating);
  const paused = result.phase === "paused";
  useEffect(() => {
    if (paused) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [paused]);
  const elapsed = Math.max(0, Math.floor((now - result.createdAt) / 1000));
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(
    elapsed % 60,
  ).padStart(2, "0")}`;
  const status = paused
    ? "已停止等待"
    : result.phase === "submitting"
    ? "正在提交请求"
    : result.phase === "queued"
    ? "等待生成"
    : result.phase === "preparing"
    ? "视频准备中"
    : "正在生成视频";
  return (
    <>
      <div
        className={styles["request-status"]}
        role="status"
        aria-live="polite"
      >
        {!paused && (
          <span className={styles["result-spinner"]} aria-hidden="true" />
        )}
        <span>{status}</span>
        {!paused && (
          <span className={styles["request-elapsed"]} aria-live="off">
            已等待 {clock}
          </span>
        )}
        {!paused && typeof result.progress === "number" && (
          <span className={styles["request-elapsed"]}>
            {Math.round(result.progress)}%
          </span>
        )}
      </div>
      {!paused && typeof result.progress === "number" && (
        <progress
          className={styles["request-progress"]}
          aria-label="视频生成进度"
          value={result.progress}
          max={100}
        />
      )}
      {(result.error || paused) && (
        <p className={styles["request-notice"]}>
          {result.error ||
            "任务可能仍在服务端运行，可继续查询结果，无需重复生成。"}
        </p>
      )}
      <div className={styles["result-actions"]}>
        {paused ? (
          result.upstreamId && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void resumeVideoRequest(result.id).catch((error) =>
                  showToast(
                    error instanceof Error ? error.message : "无法恢复查询",
                  ),
                )
              }
            >
              <RotateCcw size={14} aria-hidden="true" />
              继续查询
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={() => stopVideoWaiting(result.id)}
            title="仅停止本地等待，服务端任务可能继续运行"
          >
            <Pause size={14} aria-hidden="true" />
            停止等待
          </button>
        )}
        {paused && onReuse && (
          <button type="button" onClick={onReuse}>
            <RotateCcw size={14} aria-hidden="true" />
            复用
          </button>
        )}
        {onDelete && <ResultMore onDelete={onDelete} />}
      </div>
    </>
  );
}

function ResultCard({
  result,
  onDelete,
  onReuse,
  onRetry,
}: {
  result: VideoResult;
  onDelete?: () => void;
  onReuse?: () => void;
  onRetry?: () => void;
}) {
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [retry, setRetry] = useState(0);
  const mediaResult = useRef(result);
  mediaResult.current = result;
  const mediaIdentity = JSON.stringify([
    result.id,
    result.url,
    result.mediaPath,
    result.customApiBase,
    result.tokenId,
  ]);
  const busy = useVideoStore((state) => state.isGenerating);
  const cardRef = useRef<HTMLDivElement>(null);
  const accountMode = useAccessStore((state) => state.newApiEnabled);
  const source = useAccessStore((state) =>
    result.customApiBase
      ? JSON.stringify([
          state.openaiUrl,
          state.openaiApiKey,
          state.useCustomConfig,
        ])
      : "",
  );
  useEffect(() => {
    const result = mediaResult.current;
    if (!result.mediaPath) return;
    const controller = new AbortController();
    let objectUrl = "";
    const pause = () => {
      controller.abort();
      setMediaUrl("");
      setMediaError("接口或密钥已切换，请切回原配置后重新加载视频");
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    setMediaUrl("");
    setMediaError("");
    const events = [
      ...(result.customApiBase ? ["model-source-changing"] : []),
      "local-workspace-switch",
      "local-data-maintenance",
    ];
    for (const event of events) window.addEventListener(event, pause);
    const load = () =>
      void fetchVideoMedia(result, controller.signal)
        .then((blob) => {
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setMediaUrl(objectUrl);
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setMediaError(
              error instanceof Error ? error.message : "视频加载失败",
            );
        });
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined" && cardRef.current) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer?.disconnect();
          load();
        }
      });
      observer.observe(cardRef.current);
    } else load();
    return () => {
      controller.abort();
      observer?.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      for (const event of events) window.removeEventListener(event, pause);
    };
  }, [mediaIdentity, source, retry]);
  const playableUrl = result.mediaPath ? mediaUrl : result.url;
  const poster = cachedVideoPoster(result);
  const capturePoster = videoPosterCapture(result);
  return (
    <div
      ref={cardRef}
      className={`${styles["result-card"]} ${
        result.status === "success"
          ? styles["result-success"]
          : styles["result-failed"]
      }`}
    >
      {result.status === "success" && playableUrl && !mediaError ? (
        <video
          key={retry}
          className={styles["result-video"]}
          aria-label={`播放视频：${result.prompt}`}
          onError={() =>
            setMediaError("视频暂时无法播放，请重新加载。也可下载后查看。")
          }
          src={playableUrl}
          poster={poster}
          onLoadedData={(event) => capturePoster(event.currentTarget)}
          controls
          muted
          preload="metadata"
          playsInline
          onPlay={(event) => {
            for (const video of event.currentTarget
              .closest(`.${styles.thread}`)
              ?.querySelectorAll("video") ?? []) {
              if (video !== event.currentTarget) video.pause();
            }
          }}
        />
      ) : !mediaError && result.status === "success" && poster ? (
        <Image
          className={styles["result-video"]}
          src={poster}
          alt={result.prompt}
          width={480}
          height={270}
          unoptimized
        />
      ) : (
        <div
          className={`${styles["result-video"]} ${styles["result-placeholder"]}`}
        >
          <span role={result.status === "failed" ? "alert" : "status"}>
            {mediaError ||
              (result.status === "success" ? "正在加载视频..." : "生成失败")}
            {result.status === "failed" && result.error && (
              <p className={styles["request-notice"]}>{result.error}</p>
            )}
            {mediaError && (
              <button
                type="button"
                onClick={() => {
                  setMediaError("");
                  setRetry((value) => value + 1);
                }}
              >
                重新加载
              </button>
            )}
          </span>
        </div>
      )}
      {result.status === "failed" &&
        accountMode &&
        !result.customApiBase &&
        isInsufficientBalance(result.error) && (
          <QuotaPricingCard model={result.model} />
        )}
      {result.status === "success" && (
        <div className={styles["result-summary"]}>
          <span className={styles["result-ready"]}>
            <Check size={14} aria-hidden="true" />
            视频已生成
          </span>
          <span className={styles["result-specs"]}>
            {[
              result.size || result.resolution,
              result.aspectRatio && result.aspectRatio !== "adaptive"
                ? result.aspectRatio
                : "",
              result.duration ? `${result.duration} 秒` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      )}
      <div className={styles["result-actions"]}>
        {result.status === "success" && playableUrl && (
          <button
            type="button"
            aria-label="下载视频"
            title="下载视频"
            onClick={(e) => {
              e.stopPropagation();
              const link = document.createElement("a");
              link.href = playableUrl;
              link.download = `video_${result.id}.mp4`;
              link.click();
            }}
          >
            <Download size={14} aria-hidden="true" />
            <span>下载视频</span>
          </button>
        )}
        {onReuse && (
          <button
            type="button"
            aria-label="复用配置"
            title="复用配置"
            onClick={onReuse}
          >
            <CopyPlus size={14} aria-hidden="true" />
            <span>复用配置</span>
          </button>
        )}
        {result.status === "failed" && onRetry && (
          <button type="button" disabled={busy} onClick={onRetry}>
            <RotateCcw size={14} aria-hidden="true" />
            重新生成
          </button>
        )}
        {onDelete && <ResultMore onDelete={onDelete} />}
        {result.status === "success" && playableUrl && (
          <span className={styles["result-publish"]}>
            <CommunityShareButton
              kind="video"
              resultId={result.id}
              sourceWorkId={result.request?.sourceWorkId}
              source={() => ({
                kind: "video",
                media: [{ url: playableUrl }],
                sourceWorkId: result.request?.sourceWorkId,
                ...(result.request
                  ? videoGenerationMetadata(
                      buildVideoRequest(
                        result.request,
                        getModelProvider(result.request.model)[0],
                      ).body,
                      { prompt: result.prompt, model: result.model || "" },
                    )
                  : {
                      prompt: result.prompt,
                      model: result.model || "",
                      references: [],
                    }),
              })}
            />
          </span>
        )}

        {result.completedAt && result.completedAt >= result.createdAt && (
          <span className={styles["request-elapsed"]}>
            耗时{" "}
            {Math.max(
              1,
              Math.round((result.completedAt - result.createdAt) / 1000),
            )}{" "}
            秒
          </span>
        )}
      </div>
    </div>
  );
}

function VideoRequestTurn({
  result,
  onDelete,
  onReuse,
  onRetry,
}: {
  result: VideoResult;
  onDelete: () => void;
  onReuse: () => void;
  onRetry: () => void;
}) {
  const materials = result.request?.materials ?? [];
  const externalReference =
    result.request?.openaiReferenceSource === "image_url"
      ? result.request.openaiImageUrl
      : undefined;
  return (
    <article
      className={styles["request-turn"]}
      data-video-request={result.id}
      aria-label={`视频请求：${result.prompt || "参考素材"}`}
    >
      <div className={styles["request-user"]}>
        <div className={styles["request-message"]}>
          {(materials.length > 0 || externalReference) && (
            <div
              className={styles["request-materials"]}
              aria-label="本次参考素材"
            >
              {materials.map((material) => (
                <button
                  key={material.id}
                  type="button"
                  className={styles["request-material"]}
                  aria-label={`查看参考素材：${material.name}`}
                  title={material.name}
                  onClick={() => {
                    if (material.type === "image") showImageModal(material.url);
                    else
                      showModal({
                        title: material.name,
                        children:
                          material.type === "video" ? (
                            <video
                              src={material.url}
                              controls
                              playsInline
                              style={{ maxWidth: "100%" }}
                            />
                          ) : (
                            <audio
                              src={material.url}
                              controls
                              style={{ maxWidth: "100%" }}
                            />
                          ),
                      });
                  }}
                >
                  {material.type === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={material.url}
                      alt={material.name}
                      loading="lazy"
                    />
                  ) : material.type === "video" ? (
                    <video
                      src={material.url}
                      muted
                      preload="metadata"
                      aria-label={material.name}
                    />
                  ) : (
                    <Music2 size={20} aria-hidden="true" />
                  )}
                </button>
              ))}
              {externalReference && materials.length === 0 && (
                <button
                  type="button"
                  className={styles["request-material"]}
                  aria-label="查看参考图片"
                  onClick={() => showImageModal(externalReference)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={externalReference} alt="参考图片" loading="lazy" />
                </button>
              )}
            </div>
          )}
          <div className={styles["request-copy"]}>
            {result.prompt || "使用参考素材生成视频"}
          </div>
        </div>
        <div className={styles["request-meta"]}>
          <RequestParameters result={result} />
          <span className={styles["message-time"]}>
            {formatMessageDate(new Date(result.createdAt))}
          </span>
        </div>
      </div>
      <div className={styles["response-message"]}>
        <div className={styles["response-heading"]}>
          <Clapperboard size={15} aria-hidden="true" />
          <span title={result.model || "视频生成"}>
            {result.model || "视频生成"}
          </span>
          <span className={styles["message-time"]}>
            {formatMessageDate(
              new Date(result.completedAt ?? result.createdAt),
            )}
          </span>
        </div>
        <SmoothPanelContent enabled className={styles["response-body"]}>
          {result.status === "pending" ? (
            <RequestStatus
              result={result}
              onReuse={onReuse}
              onDelete={onDelete}
            />
          ) : (
            <ResultCard
              result={result}
              onDelete={onDelete}
              onReuse={onReuse}
              onRetry={onRetry}
            />
          )}
        </SmoothPanelContent>
      </div>
    </article>
  );
}

// ─── 主组件 ────────────────────────────────────────────────────────

export function ChatVideoResult({ id }: { id: string }) {
  const result = useVideoStore((state) =>
    state.results.find((item) => item.id === id),
  );
  const [error, setError] = useState("");
  useEffect(() => {
    void useVideoStore
      .getState()
      .loadDraft()
      .catch(() => setError("视频记录加载失败，请刷新重试。"));
  }, []);
  if (!result)
    return (
      <p role="status">
        {error || "视频记录暂不可用，可在当前会话重新生成或查看作品库。"}
      </p>
    );
  return (
    <div className={styles["response-message"]} data-testid="chat-video-result">
      {result.status === "pending" ? (
        <RequestStatus result={result} />
      ) : (
        <ResultCard result={result} />
      )}
    </div>
  );
}

export function VideoWorkspace() {
  const {
    isGenerating,
    results,
    removeResult,
    draft,
    loadDraft,
    updateDraft,
    hasHydrated,
  } = useVideoStore();
  const resultAreaRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const following = useRef(true);
  const scrollIntent = useRef(false);
  const scrollTimeout = useRef<number>();
  const [newResults, setNewResults] = useState(false);
  const orderedResults = useMemo(
    () => [...results].sort((left, right) => left.createdAt - right.createdAt),
    [results],
  );
  const hasResults = orderedResults.length > 0;
  const scrollToLatest = useCallback(function toLatest(smooth = false) {
    const area = resultAreaRef.current;
    if (!area) return;
    following.current = true;
    scrollIntent.current = smooth && !prefersReducedMotion();
    window.clearTimeout(scrollTimeout.current);
    area.scrollTo({
      top: area.scrollHeight,
      behavior: scrollIntent.current ? "smooth" : "auto",
    });
    setNewResults(false);
    if (scrollIntent.current)
      scrollTimeout.current = window.setTimeout(() => {
        if (
          following.current &&
          area.scrollHeight - area.scrollTop - area.clientHeight > 2
        ) {
          toLatest(true);
          return;
        }
        scrollIntent.current = false;
      }, 500);
  }, []);
  useEffect(() => () => window.clearTimeout(scrollTimeout.current), []);
  useLayoutEffect(() => {
    if (following.current) {
      if (!scrollIntent.current) scrollToLatest();
    } else setNewResults(true);
  }, [results, scrollToLatest]);
  useEffect(() => {
    if (!threadRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (following.current && !scrollIntent.current) {
        const area = resultAreaRef.current;
        if (area) area.scrollTop = area.scrollHeight;
      }
    });
    observer.observe(threadRef.current);
    return () => observer.disconnect();
  }, [hasResults]);
  const stopFollowing = () => {
    following.current = false;
    scrollIntent.current = false;
  };

  const format = videoApiFormat(draft.apiFormat);
  const protocolOptions = draft.protocolOptions?.[format] ?? {};
  const updateProtocolOptions = (patch: typeof protocolOptions) =>
    updateDraft({
      protocolOptions: {
        ...draft.protocolOptions,
        [format]: { ...protocolOptions, ...patch },
      },
    });
  const customParams =
    draft.customParams?.[format] ??
    (draft.legacyCustomFormat
      ? draft.customParams?.[draft.legacyCustomFormat]
      : "") ??
    "";
  const customParamsError = useMemo(() => {
    try {
      const parsed = videoCustomParams(draft);
      videoBuiltinParameters(draft);
      if (
        videoParameterFormat(format, draft.model) !== "openai" &&
        parsed.metadata !== undefined &&
        (!parsed.metadata ||
          typeof parsed.metadata !== "object" ||
          Array.isArray(parsed.metadata))
      )
        return "当前兼容格式的 metadata 必须是 JSON 对象";
      return "";
    } catch (error) {
      return (error as Error).message;
    }
  }, [format, draft]);
  const customParamsErrorId = useId();
  const referenceError = useMemo(() => {
    try {
      const custom = parseVideoCustomParams(draft.customParams?.openai);
      if (!Object.hasOwn(custom, "input_reference"))
        openaiVideoReference(draft);
      return "";
    } catch (error) {
      if (format !== "openai" || customParamsError) return "";
      return (error as Error).message;
    }
  }, [draft, format, customParamsError]);
  const referenceErrorId = useId();
  const params = videoOptions(
    format,
    draft.model,
    draft.mode,
    draft.resolution,
  );
  const modeOptions = MODE_OPTIONS.filter((item) =>
    params.modes.includes(item.value),
  );
  const allModels = useAllModels();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const modelPickerId = useId();
  const switchingModelSource = useAccessStore((state) => state.switchingToken);
  const capabilitiesForModel = useModelCapabilitiesResolver();
  const settingsRef = useRef<HTMLDetailsElement>(null);
  const settingsTriggerRef = useRef<HTMLElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsPanelId = useId();
  const settingsPanelStyle = useAnchoredPanel(
    settingsOpen,
    settingsTriggerRef,
    settingsPanelRef,
    280,
    { align: "center", minimumTop: videoPanelMinimumTop },
  );
  const closeSettings = useCallback((restoreFocus = false) => {
    if (settingsRef.current) settingsRef.current.open = false;
    setSettingsOpen(false);
    if (restoreFocus)
      settingsTriggerRef.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (!settingsOpen || settingsPanelStyle.visibility !== "visible") return;
    Array.from(
      settingsPanelRef.current?.querySelectorAll<HTMLElement>(
        "[data-select-trigger], select",
      ) ?? [],
    )
      .find(
        (select) =>
          select.getClientRects().length > 0 &&
          getComputedStyle(select).visibility === "visible",
      )
      ?.focus({ preventScroll: true });
  }, [settingsOpen, settingsPanelStyle.visibility]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onOutsidePointer = (event: PointerEvent) => {
      const panel = settingsRef.current;
      if (
        panel?.open &&
        !panel.contains(event.target as Node) &&
        !settingsPanelRef.current?.contains(event.target as Node) &&
        !isSelectMenuWithin(event.target as Node, settingsPanelRef.current)
      )
        closeSettings();
    };
    document.addEventListener("pointerdown", onOutsidePointer);
    return () => document.removeEventListener("pointerdown", onOutsidePointer);
  }, [settingsOpen, closeSettings]);

  // 加载草稿
  useEffect(() => {
    void loadDraft().catch((error) =>
      showToast(error instanceof Error ? error.message : "视频记录加载失败"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 从模型列表中自动识别视频模型
  const videoModels = useMemo(
    () =>
      allModels.filter(
        (model) =>
          model.available !== false &&
          capabilitiesForModel(model.name, model.provider?.providerName)
            .category === "video",
      ),
    [allModels, capabilitiesForModel],
  );

  const remixModelStatus = useAccessStore((state) => state.modelListStatus);
  useCommunityRemix(
    "video",
    hasHydrated && remixModelStatus === "ready",
    async (work, check) => {
      const model = videoModels.find(
        (item) =>
          item.name === work.model &&
          item.provider?.providerName !== CUSTOM_MODEL_PROVIDER,
      );
      if (!model)
        throw new Error(
          `原作品模型 ${
            work.model || "未记录"
          } 当前不可用，请切换有权调用此模型的令牌后重试。`,
        );
      if (work.references.length > MAX_VIDEO_REFERENCES)
        throw new Error(
          `视频制作最多支持 ${MAX_VIDEO_REFERENCES} 张参考图，请减少选择后重试。`,
        );
      if (
        (draft.prompt || draft.materials.length) &&
        !(await showConfirm("填入同款会替换当前视频草稿，是否继续？"))
      )
        throw new Error("已保留当前草稿；准备好后可重试填入。");
      const revision = useVideoStore.getState().draftRevision;
      const unchanged = () => {
        check();
        if (useVideoStore.getState().draftRevision !== revision)
          throw new Error("视频草稿已变化，已保留当前内容，请重试填入。");
      };
      unchanged();
      const images = await remixImages(work, unchanged);
      unchanged();
      updateDraft({
        apiFormat: "openai",
        legacyCustomFormat: undefined,
        customParams: {},
        protocolOptions: {},
        negativePrompt: "",
        seed: "",
        prompt: work.prompt,
        model: `${model.name}@${model.provider?.providerName}`,
        sourceWorkId: work.sourceWorkId,
        materials: images.map((url, index) => ({
          id: nanoid(),
          type: "image",
          url,
          name: work.references[index].name,
        })),
        mode: images.length
          ? images.length > 1
            ? "reference-to-video"
            : "image-to-video"
          : "text-to-video",
        openaiReferenceSource: "upload",
        openaiImageUrl: "",
        openaiLastImageUrl: "",
        openaiFileId: "",
      });
      promptRef.current?.focus();
    },
  );

  // 初始化默认模型
  useEffect(() => {
    if (
      hasHydrated &&
      !useVideoStore.getState().draft.model &&
      videoModels.length > 0
    ) {
      const first = videoModels[0];
      updateDraft({
        model: `${first.name}@${first.provider?.providerName}`,
      });
    }
  }, [hasHydrated, videoModels, updateDraft]);

  // 当前选中模型显示名
  const selectedModelDisplay = useMemo(() => {
    if (!draft.model) return "选择模型";
    const [name, providerName] = getModelProvider(draft.model);
    const model = videoModels.find(
      (m) => `${m.name}@${m.provider?.providerName}` === draft.model,
    );
    const label = model?.displayName || name || "选择模型";
    return providerName === CUSTOM_MODEL_PROVIDER ? `自定义 · ${label}` : label;
  }, [draft.model, videoModels]);
  const parameterSummary = [
    draft.resolution === "auto" ? "自动" : draft.resolution,
    ["auto", "adaptive"].includes(draft.aspectRatio)
      ? "自动"
      : draft.aspectRatio,
    `${draft.duration}s`,
  ].join(" · ");

  const canGenerate =
    hasHydrated &&
    draft.prompt.trim().length > 0 &&
    !isGenerating &&
    !!draft.model &&
    !customParamsError &&
    !referenceError;

  const submitRequest = useCallback(async (request: VideoDraft) => {
    if (useVideoStore.getState().isGenerating) return;
    if (request.confirmBeforeGenerate && !(await showConfirm("确认生成视频？")))
      return;
    following.current = true;
    setNewResults(false);
    try {
      await generateVideoRequest(request);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "视频请求无法发送");
    }
  }, []);
  const handleGenerate = () => {
    if (canGenerate) void submitRequest(useVideoStore.getState().draft);
  };
  const handleReuse = async (result: VideoResult) => {
    try {
      if (await reuseVideoRequest(result.id)) {
        promptRef.current?.focus({ preventScroll: true });
        showToast("已载入本次请求，可修改后发送");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "无法复用这次请求");
    }
  };
  const handleRetry = (result: VideoResult) => {
    if (result.request) void submitRequest(result.request);
    else void handleReuse(result);
  };
  const handleDelete = async (result: VideoResult) => {
    if (
      !(await showConfirm(
        result.status === "pending"
          ? "删除这条本地记录并停止等待？服务端任务可能仍在运行。"
          : "删除这条视频创作记录？",
      ))
    )
      return;
    try {
      await removeResult(result.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "删除记录失败");
    }
  };

  const ModeIcon = MODE_ICONS[draft.mode] ?? Clapperboard;

  return (
    <div className={styles["video-workspace"]}>
      {/* ── 顶部标题栏 (共享 PageHeader) ── */}
      <PageHeader
        title="视频工作区"
        icon={<Clapperboard size={20} />}
        backType="back"
      />

      {/* ── 上层：结果展示区 ── */}
      <div
        ref={resultAreaRef}
        className={styles["result-area"]}
        aria-label="视频创作记录"
        onWheel={stopFollowing}
        onTouchMove={stopFollowing}
        onKeyDown={(event) => {
          if (["PageUp", "Home", "ArrowUp"].includes(event.key))
            stopFollowing();
        }}
        onScroll={(event) => {
          const area = event.currentTarget;
          const atBottom =
            area.scrollHeight - area.scrollTop - area.clientHeight < 72;
          if (atBottom) {
            following.current = true;
            setNewResults(false);
          } else if (!scrollIntent.current) following.current = false;
        }}
      >
        {results.length === 0 ? (
          <p className={styles["video-empty"]} role="status">
            暂无视频作品
          </p>
        ) : (
          <div ref={threadRef} className={styles.thread}>
            {orderedResults.map((result) => (
              <VideoRequestTurn
                key={result.id}
                result={result}
                onDelete={() => void handleDelete(result)}
                onReuse={() => void handleReuse(result)}
                onRetry={() => handleRetry(result)}
              />
            ))}
          </div>
        )}
        {newResults && (
          <button
            type="button"
            className={styles["new-results"]}
            aria-label="查看新结果"
            onClick={() => scrollToLatest(true)}
          >
            <ArrowDown size={14} aria-hidden="true" />
            查看新结果
          </button>
        )}
      </div>

      {/* ── 底部：工具栏与提示词输入 ── */}
      <div className={styles["input-card"]}>
        <div className={styles["composer"]}>
          <div className={styles["input-card-upper"]}>
            <div className={styles["prompt-area"]}>
              <MaterialThumbnails />
              <VideoPromptInput
                inputRef={promptRef}
                onSubmit={handleGenerate}
              />
            </div>
          </div>
          <div className={styles["composer-toolbar"]}>
            <div className={styles["composer-toolbar-start"]}>
              <MaterialUpload />
              <CapsuleDropdown
                className={`${styles["desktop-param"]} ${styles["mode-param"]}`}
                label=""
                value={draft.mode}
                ariaLabel={`生成模式：${MODE_LABELS[draft.mode]}`}
                trigger={<ModeIcon size={16} aria-hidden="true" />}
                options={modeOptions.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                onSelect={(v) => updateDraft({ mode: v as VideoGenMode })}
                width={140}
              />
            </div>

            <div className={styles["param-bar"]}>
              <div
                className={`${styles["capsule-wrapper"]} ${styles["model-param"]}`}
              >
                <button
                  type="button"
                  className={styles["capsule-btn"]}
                  aria-label={`模型：${selectedModelDisplay}`}
                  aria-haspopup="dialog"
                  aria-controls={modelPickerId}
                  aria-expanded={modelPickerOpen}
                  title={selectedModelDisplay}
                  onClick={() => setModelPickerOpen(true)}
                >
                  <span className={styles["capsule-value"]}>
                    {selectedModelDisplay}
                  </span>
                </button>
              </div>
              <SelectionDialog
                id={modelPickerId}
                open={modelPickerOpen}
                title="选择视频模型"
                onClose={() => setModelPickerOpen(false)}
                headerActions={
                  <button
                    type="button"
                    title="刷新模型"
                    aria-label="刷新模型"
                    disabled={refreshingModels || switchingModelSource}
                    onClick={async () => {
                      setRefreshingModels(true);
                      try {
                        await refetchModels();
                      } catch (error) {
                        showToast(
                          error instanceof Error
                            ? error.message
                            : "模型刷新失败，请重试",
                        );
                      } finally {
                        setRefreshingModels(false);
                      }
                    }}
                  >
                    <RefreshCw size={16} aria-hidden="true" />
                  </button>
                }
              >
                <ModelSelect
                  embedded
                  models={allModels.filter(
                    (model) => model.available !== false,
                  )}
                  value={draft.model}
                  onChange={(model) => {
                    updateDraft({ model });
                    setModelPickerOpen(false);
                  }}
                />
              </SelectionDialog>

              <CapsuleDropdown
                className={parameterStyles.trigger}
                label=""
                value=""
                ariaLabel={`视频参数：${parameterSummary}`}
                trigger={
                  <>
                    <RectangleHorizontal size={16} aria-hidden="true" />
                    <span className={parameterStyles.triggerSummary}>
                      {parameterSummary}
                    </span>
                  </>
                }
                options={[]}
                onSelect={() => {}}
                width={340}
                maxHeight={460}
                panelContent={
                  <VideoParameterControls
                    draft={draft}
                    onChange={updateDraft}
                  />
                }
              />

              <details
                ref={settingsRef}
                className={styles["settings"]}
                onToggle={(e) => setSettingsOpen(e.currentTarget.open)}
                onBlur={(e) => {
                  if (
                    !e.currentTarget.contains(e.relatedTarget) &&
                    !settingsPanelRef.current?.contains(e.relatedTarget) &&
                    !(
                      e.relatedTarget instanceof Node &&
                      isSelectMenuWithin(
                        e.relatedTarget,
                        settingsPanelRef.current,
                      )
                    )
                  )
                    closeSettings();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && !e.defaultPrevented) {
                    e.preventDefault();
                    e.stopPropagation();
                    closeSettings(true);
                  }
                }}
              >
                <summary
                  ref={settingsTriggerRef}
                  aria-label="视频设置"
                  aria-expanded={settingsOpen}
                  aria-controls={settingsPanelId}
                  title="视频设置"
                >
                  <SlidersHorizontal size={16} aria-hidden="true" />
                </summary>
                {settingsOpen &&
                  createPortal(
                    <div
                      ref={settingsPanelRef}
                      id={settingsPanelId}
                      className={styles["settings-panel"]}
                      style={settingsPanelStyle}
                    >
                      <div className={styles["settings-title"]}>视频设置</div>
                      <div className={styles["mobile-settings-params"]}>
                        <label>
                          <span>生成模式</span>
                          <Select
                            aria-label="生成模式"
                            value={draft.mode}
                            onChange={(e) =>
                              updateDraft({
                                mode: e.target.value as VideoGenMode,
                              })
                            }
                          >
                            {modeOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </Select>
                        </label>
                      </div>
                      {params.parameterFormat !== "gemini" && (
                        <>
                          <label>
                            <span>参考图来源</span>
                            <Select
                              aria-label="参考图来源"
                              value={draft.openaiReferenceSource ?? "upload"}
                              onChange={(e) =>
                                updateDraft({
                                  openaiReferenceSource: e.target.value as
                                    | "upload"
                                    | "image_url"
                                    | "file_id",
                                  mode:
                                    draft.mode === "first-last-frame"
                                      ? draft.mode
                                      : "image-to-video",
                                })
                              }
                            >
                              <option value="upload">本地上传</option>
                              <option value="image_url">图片 URL</option>
                              {params.usesSize && (
                                <option value="file_id">文件 ID</option>
                              )}
                            </Select>
                          </label>
                          {draft.openaiReferenceSource === "image_url" && (
                            <label className={styles["stacked-setting"]}>
                              <span>参考图片 URL</span>
                              <textarea
                                aria-label="参考图片 URL"
                                aria-invalid={!!referenceError}
                                aria-describedby={
                                  referenceError ? referenceErrorId : undefined
                                }
                                value={draft.openaiImageUrl ?? ""}
                                rows={2}
                                spellCheck={false}
                                onChange={(e) =>
                                  updateDraft({
                                    openaiImageUrl: e.target.value,
                                    mode:
                                      draft.mode === "first-last-frame"
                                        ? draft.mode
                                        : "image-to-video",
                                  })
                                }
                              />
                            </label>
                          )}
                          {draft.openaiReferenceSource === "image_url" &&
                            draft.mode === "first-last-frame" && (
                              <label className={styles["stacked-setting"]}>
                                <span>尾帧图片 URL</span>
                                <textarea
                                  aria-label="尾帧图片 URL"
                                  rows={2}
                                  value={draft.openaiLastImageUrl ?? ""}
                                  onChange={(e) =>
                                    updateDraft({
                                      openaiLastImageUrl: e.target.value,
                                    })
                                  }
                                />
                              </label>
                            )}
                          {draft.openaiReferenceSource === "file_id" && (
                            <label>
                              <span>参考文件 ID</span>
                              <input
                                aria-label="参考文件 ID"
                                aria-invalid={!!referenceError}
                                aria-describedby={
                                  referenceError ? referenceErrorId : undefined
                                }
                                value={draft.openaiFileId ?? ""}
                                spellCheck={false}
                                onChange={(e) =>
                                  updateDraft({
                                    openaiFileId: e.target.value,
                                    mode: "image-to-video",
                                  })
                                }
                              />
                            </label>
                          )}
                          {referenceError && (
                            <div
                              id={referenceErrorId}
                              className={styles["parameter-error"]}
                              role="alert"
                            >
                              {referenceError}
                            </div>
                          )}
                        </>
                      )}
                      {params.parameterFormat === "gemini" && (
                        <label className={styles["stacked-setting"]}>
                          <span>负面提示词</span>
                          <textarea
                            aria-label="负面提示词"
                            value={draft.negativePrompt}
                            onChange={(e) =>
                              updateDraft({ negativePrompt: e.target.value })
                            }
                            rows={3}
                          />
                        </label>
                      )}
                      {(params.parameterFormat === "xai" ||
                        params.parameterFormat === "seedance") && (
                        <label>
                          <span>生成声音</span>
                          <Select
                            aria-label="生成声音"
                            value={
                              protocolOptions.generateAudio === undefined
                                ? ""
                                : String(protocolOptions.generateAudio)
                            }
                            onChange={(e) =>
                              updateProtocolOptions({
                                generateAudio:
                                  e.target.value === ""
                                    ? undefined
                                    : e.target.value === "true",
                              })
                            }
                          >
                            <option value="">默认</option>
                            <option value="true">开启</option>
                            <option value="false">关闭</option>
                          </Select>
                        </label>
                      )}
                      {params.parameterFormat === "gemini" && (
                        <>
                          <label>
                            <span>随机种子</span>
                            <input
                              aria-label="随机种子"
                              type="number"
                              step="1"
                              min="0"
                              value={protocolOptions.seed ?? ""}
                              onChange={(e) =>
                                updateProtocolOptions({ seed: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            <span>人物生成</span>
                            <Select
                              aria-label="人物生成"
                              value={protocolOptions.personGeneration ?? ""}
                              onChange={(e) =>
                                updateProtocolOptions({
                                  personGeneration: e.target.value,
                                })
                              }
                            >
                              <option value="">默认</option>
                              <option value="allow_adult">仅成年人</option>
                              <option value="dont_allow">不生成人物</option>
                            </Select>
                          </label>
                        </>
                      )}
                      <details className={styles["advanced-params"]}>
                        <summary>高级参数</summary>
                        <label
                          className={`${styles["stacked-setting"]} ${styles["custom-params"]}`}
                        >
                          <span>自定义参数 JSON</span>
                          <textarea
                            aria-label="自定义参数 JSON"
                            aria-invalid={!!customParamsError}
                            aria-describedby={
                              customParamsError
                                ? customParamsErrorId
                                : undefined
                            }
                            value={customParams}
                            placeholder={
                              params.parameterFormat === "gemini"
                                ? '{"metadata":{"seed":42}}'
                                : '{"seed":42,"generate_audio":true}'
                            }
                            spellCheck={false}
                            rows={4}
                            onChange={(e) =>
                              updateDraft({
                                legacyCustomFormat: undefined,
                                customParams: {
                                  ...draft.customParams,
                                  [format]: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      </details>
                      {customParamsError && (
                        <div
                          id={customParamsErrorId}
                          className={styles["parameter-error"]}
                          role="alert"
                        >
                          {customParamsError}
                        </div>
                      )}
                    </div>,
                    document.body,
                  )}
              </details>
              <div className={styles["composer-actions"]}>
                <button
                  type="button"
                  className={`${styles["generate-btn"]} ${
                    !canGenerate ? styles.disabled : ""
                  } ${isGenerating ? styles.generating : ""}`}
                  disabled={!canGenerate}
                  onClick={handleGenerate}
                  title="生成视频"
                  aria-label="生成视频"
                >
                  {isGenerating ? (
                    <div className={styles["gen-btn-spinner"]} />
                  ) : (
                    <ArrowUp size={18} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
