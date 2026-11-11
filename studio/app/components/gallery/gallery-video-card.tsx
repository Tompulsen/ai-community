import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { CopyPlus, Download, Play, Trash2 } from "lucide-react";
import Locale from "../../locales";
import { useVideoStore, type VideoResult } from "../../store/video";
import { useAccessStore } from "../../store/access";
import { fetchVideoMedia } from "../../utils/video-media";
import {
  cachedVideoPoster,
  extractVideoPoster,
} from "../../utils/video-poster";
import {
  readMedia,
  videoGenerationMetadata,
} from "../../utils/community-share";
import {
  getLocalScope,
  isLocalWorkspaceActive,
} from "../../utils/local-workspace";
import { buildVideoRequest } from "../../utils/video-api";
import { getModelProvider } from "../../utils/model";
import { CommunityShareButton } from "../community-share-button";
import { SelectionDialog } from "../selection-dialog";
import { showToast } from "../ui-lib";
import styles from "./gallery.module.scss";

export async function galleryVideoBlob(
  result: VideoResult,
  signal: AbortSignal,
) {
  if (signal.aborted || !isLocalWorkspaceActive())
    throw new DOMException("Cancelled", "AbortError");
  const owner = getLocalScope();
  const blob = result.mediaPath
    ? await fetchVideoMedia(result, signal)
    : await readMedia(result.url, "video", 256 * 1024 * 1024, signal);
  if (signal.aborted || !isLocalWorkspaceActive() || getLocalScope() !== owner)
    throw new DOMException("Cancelled", "AbortError");
  return blob;
}

export function GalleryVideoCard({
  result,
  batchMode,
  selected,
  onSelect,
  onDelete,
  onDownload,
  onReuse,
}: {
  result: VideoResult;
  batchMode: boolean;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDownload: () => Promise<void>;
  onReuse: () => void;
}) {
  const [src, setSrc] = useState("");
  const [poster, setPoster] = useState(() => cachedVideoPoster(result));
  const [posterError, setPosterError] = useState("");
  const failedPoster = useRef("");
  const loadedSource = useRef("");
  const resultRef = useRef(result);
  resultRef.current = result;
  const sourceIdentity = JSON.stringify([
    result.id,
    result.url,
    result.mediaPath,
    result.tokenId,
    result.customApiBase,
  ]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [posterRetry, setPosterRetry] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mediaDuration, setMediaDuration] = useState<number>();
  const duration = result.duration || mediaDuration;
  const card = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLVideoElement | null>(null);
  const setPlayer = useCallback(
    (element: HTMLVideoElement | null) => {
      if (!element) player.current?.pause();
      player.current = element;
      if (element && previewOpen) void element.play().catch(() => {});
    },
    [previewOpen],
  );
  const closePreview = useCallback(() => {
    player.current?.pause();
    setPreviewOpen(false);
  }, []);
  const customSource = useAccessStore((state) =>
    result.customApiBase
      ? JSON.stringify([
          state.openaiUrl,
          state.openaiApiKey,
          state.useCustomConfig,
        ])
      : "",
  );
  useEffect(() => closePreview(), [sourceIdentity, customSource, closePreview]);
  useEffect(() => {
    const result = resultRef.current;
    const controller = new AbortController();
    const owner = getLocalScope();
    let objectUrl = "";
    const cover = cachedVideoPoster(result);
    const usableCover = cover === failedPoster.current ? undefined : cover;
    loadedSource.current = "";
    setSrc("");
    setPoster(usableCover);
    setPosterError("");
    setError("");
    setMediaDuration(undefined);
    const isCurrent = () =>
      !controller.signal.aborted &&
      isLocalWorkspaceActive() &&
      getLocalScope() === owner;
    const pause = () => {
      controller.abort();
      closePreview();
      setSrc("");
      setPoster(undefined);
      setError("账号或接口已切换，请重新加载");
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    const events = [
      "local-workspace-switch",
      "local-data-maintenance",
      ...(result.customApiBase ? ["model-source-changing"] : []),
    ];
    events.forEach((event) => window.addEventListener(event, pause));
    const load = async () => {
      if (!isCurrent()) return;
      let source = result.url;
      try {
        if (result.mediaPath) {
          const blob = await galleryVideoBlob(result, controller.signal);
          if (!isCurrent()) return;
          objectUrl = URL.createObjectURL(blob);
          source = objectUrl;
        }
        if (!isCurrent()) return;
        loadedSource.current = JSON.stringify([sourceIdentity, customSource]);
        setSrc(source);
      } catch (failure) {
        if (isCurrent())
          setError(failure instanceof Error ? failure.message : "视频加载失败");
        return;
      }
    };
    // A known cover is enough to browse; fetch the full video only on activation.
    const needsMedia = !usableCover || retry > 0;
    const observer =
      !needsMedia || typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              observer?.disconnect();
              void load();
            }
          });
    if (needsMedia) {
      if (observer && card.current) observer.observe(card.current);
      else void load();
    }
    return () => {
      controller.abort();
      observer?.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      events.forEach((event) => window.removeEventListener(event, pause));
    };
  }, [sourceIdentity, retry, customSource, closePreview]);
  useEffect(() => {
    if (
      !src ||
      loadedSource.current !== JSON.stringify([sourceIdentity, customSource])
    )
      return;
    const result = resultRef.current;
    const cover = cachedVideoPoster(result);
    if (cover && cover !== failedPoster.current) return;
    const controller = new AbortController();
    const owner = getLocalScope();
    const isCurrent = () =>
      !controller.signal.aborted &&
      isLocalWorkspaceActive() &&
      getLocalScope() === owner;
    const abort = () => controller.abort();
    const events = [
      "local-workspace-switch",
      "local-data-maintenance",
      ...(result.customApiBase ? ["model-source-changing"] : []),
    ];
    events.forEach((event) => window.addEventListener(event, abort));
    setPosterError("");
    void extractVideoPoster(src, controller.signal)
      .then(async (captured) => {
        if (!isCurrent()) return;
        if (!captured) {
          setPosterError("暂无可用封面");
          return;
        }
        const current = useVideoStore
          .getState()
          .results.find((item) => item.id === result.id);
        if (
          !current ||
          current.url !== result.url ||
          current.mediaPath !== result.mediaPath ||
          current.tokenId !== result.tokenId ||
          current.customApiBase !== result.customApiBase
        )
          return;
        setPoster(captured.poster);
        setMediaDuration(captured.duration);
        if (!current.coverUrl || current.coverUrl === failedPoster.current) {
          // A thumbnail is optional; storage failure must never block playback.
          await useVideoStore
            .getState()
            .updateResult(result.id, { coverUrl: captured.poster })
            .catch(() => {});
        }
      })
      .catch(() => {
        if (isCurrent()) setPosterError("封面暂时无法生成");
      });
    return () => {
      controller.abort();
      events.forEach((event) => window.removeEventListener(event, abort));
    };
  }, [src, sourceIdentity, customSource, posterRetry]);
  useEffect(() => {
    if (batchMode) closePreview();
  }, [batchMode, closePreview]);
  return (
    <div
      ref={card}
      className={`${styles["gallery-card"]} ${selected ? styles.selected : ""}`}
      aria-label={`视频作品：${result.prompt}`}
      onClick={() => batchMode && onSelect()}
    >
      {batchMode && (
        <div className={styles["card-select"]}>
          <input
            type="checkbox"
            checked={selected}
            aria-label={`选择视频 ${result.prompt}`}
            onClick={(event) => event.stopPropagation()}
            onChange={onSelect}
          />
        </div>
      )}
      <div
        className={`${styles["card-image-area"]} ${styles["card-video-area"]}`}
      >
        {error ? (
          <div className={styles["card-image-error"]} role="status">
            <span>{error}</span>
            <button
              className={styles["card-retry-btn"]}
              onClick={(event) => {
                event.stopPropagation();
                setRetry((value) => value + 1);
                setPreviewOpen(true);
              }}
            >
              重新加载
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              className={`${styles["card-video-preview"]} ${
                poster ? "" : styles["card-video-placeholder"]
              }`}
              aria-label={`预览视频 ${result.prompt}`}
              onClick={(event) => {
                event.stopPropagation();
                if (batchMode) onSelect();
                else if (isLocalWorkspaceActive()) {
                  if (!src) setRetry((value) => value + 1);
                  setPreviewOpen(true);
                }
              }}
            >
              {poster && (
                <Image
                  src={poster}
                  alt={result.prompt}
                  width={480}
                  height={480}
                  unoptimized
                  className={styles["card-video-preview"]}
                  onError={() => {
                    setPoster(undefined);
                    setPosterError("封面暂时无法显示");
                    if (failedPoster.current !== poster) {
                      failedPoster.current = poster;
                      if (src) setPosterRetry((value) => value + 1);
                      else setRetry((value) => value + 1);
                    }
                  }}
                />
              )}
              <span className={styles["card-video-play"]} aria-hidden="true">
                <Play size={22} fill="currentColor" />
              </span>
              {!poster && (
                <span className={styles["card-video-status"]} role="status">
                  {posterError || "正在准备封面…"}
                </span>
              )}
              {duration ? (
                <span className={styles["card-video-duration"]}>
                  {Number(duration.toFixed(1))} 秒
                </span>
              ) : null}
            </button>
            {!poster && posterError && (
              <button
                type="button"
                className={styles["card-poster-retry"]}
                aria-label="重新提取封面"
                onClick={(event) => {
                  event.stopPropagation();
                  setPosterRetry((value) => value + 1);
                }}
              >
                重试封面
              </button>
            )}
          </>
        )}
      </div>
      <SelectionDialog
        title="视频预览"
        open={previewOpen && !error && !batchMode}
        onClose={closePreview}
      >
        {src && !error && !batchMode ? (
          <video
            ref={setPlayer}
            className={styles["video-preview"]}
            src={src}
            poster={poster}
            onLoadedMetadata={(event) => {
              const duration = event.currentTarget.duration;
              if (Number.isFinite(duration) && duration > 0)
                setMediaDuration(duration);
            }}
            autoPlay
            controls
            playsInline
            tabIndex={0}
            data-autofocus
            preload="metadata"
            aria-label={`播放视频 ${result.prompt}`}
            onError={() => setError("视频加载失败，请重试")}
            onPlay={(event) => {
              for (const video of card.current?.parentElement?.querySelectorAll(
                "video",
              ) ?? [])
                if (video !== event.currentTarget) video.pause();
            }}
          />
        ) : previewOpen && !error && !batchMode ? (
          <span role="status">正在加载视频…</span>
        ) : null}
      </SelectionDialog>
      <div className={styles["card-info"]}>
        <div className={styles["card-prompt"]} title={result.prompt}>
          {result.prompt}
        </div>
        <div className={styles["card-model"]} title={result.model}>
          {result.model}
        </div>
        <div className={styles["card-meta"]}>
          <span>
            {[result.resolution, result.duration ? `${result.duration} 秒` : ""]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span>视频</span>
        </div>
      </div>
      {!batchMode && (
        <div className={styles["card-actions"]}>
          <CommunityShareButton
            kind="video"
            resultId={result.id}
            sourceWorkId={result.request?.sourceWorkId}
            source={() => ({
              kind: "video",
              media: [
                {
                  blob: () =>
                    galleryVideoBlob(result, new AbortController().signal),
                },
              ],
              sourceWorkId: result.request?.sourceWorkId,
              ...(result.request
                ? videoGenerationMetadata(
                    buildVideoRequest(
                      result.request,
                      getModelProvider(result.request.model)[0],
                    ).body,
                    { prompt: result.prompt, model: result.model },
                  )
                : {
                    prompt: result.prompt,
                    model: result.model,
                    references: [],
                  }),
            })}
          />
          <button
            className={styles["card-action-btn"]}
            aria-label="下载视频"
            title="下载视频"
            disabled={downloading}
            onClick={async () => {
              setDownloading(true);
              try {
                await onDownload();
              } catch {
                showToast("视频下载失败，请重试");
              } finally {
                setDownloading(false);
              }
            }}
          >
            <Download size={16} aria-hidden="true" />
          </button>
          <button
            className={styles["card-action-btn"]}
            aria-label={Locale.Chat.Actions.Reuse}
            title={Locale.Chat.Actions.Reuse}
            onClick={(event) => {
              event.stopPropagation();
              onReuse();
            }}
          >
            <CopyPlus size={16} aria-hidden="true" />
          </button>
          <button
            className={`${styles["card-action-btn"]} ${styles.danger}`}
            aria-label="移出作品库"
            title="移出作品库"
            onClick={onDelete}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
