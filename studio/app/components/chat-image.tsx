"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Image from "next/image";
import { RotateCw } from "lucide-react";
import {
  loadImageAsset,
  type ImageDownloadProgress,
} from "../utils/image-asset";
import { getImageDimensions } from "../store/gallery";
import { getLocalScope } from "../utils/local-workspace";
import {
  decodeImagePreview,
  getImagePreview,
  imagePreviewKey,
  retainImagePreview,
  type ImagePreview,
} from "../utils/image-preview";
import styles from "./message-ui.module.scss";
import { ImageRequestTime } from "./image-request-time";

export function ChatImage({
  src,
  alt = "",
  imageId,
  requestDurationMs,
  onImageClick,
}: {
  src: string;
  alt?: string;
  imageId?: string;
  requestDurationMs?: number;
  onImageClick?: (src: string) => void;
}) {
  const scope = getLocalScope();
  const previewKey = useMemo(
    () => imagePreviewKey(src, imageId, scope),
    [src, imageId, scope],
  );
  const cached = getImagePreview(previewKey);
  const [image, setImage] = useState<ImagePreview | undefined>(cached);
  const [reused, setReused] = useState(!!cached);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [download, setDownload] = useState<ImageDownloadProgress>();
  const [decoding, setDecoding] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const frame = useRef<HTMLSpanElement>(null);
  const [dimensions, setDimensions] = useState<
    | {
        source: string;
        width: number;
        height: number;
      }
    | undefined
  >(
    cached
      ? { source: src, width: cached.width, height: cached.height }
      : undefined,
  );
  useEffect(() => {
    let active = true;
    let decodedReady = false;
    let release: (() => void) | undefined;
    let timer: number | undefined;
    let observer: IntersectionObserver | undefined;
    let started = false;
    const reuseCachedImage = () => {
      const cached = attempt === 0 && getImagePreview(previewKey);
      if (!cached) return false;
      release = retainImagePreview(cached);
      decodedReady = true;
      setImage(cached);
      setReused(true);
      setDimensions({
        source: src,
        width: cached.width,
        height: cached.height,
      });
      return true;
    };
    setFailed(false);
    if (reuseCachedImage()) return release;
    setImage(undefined);
    setReused(false);
    setDownload(undefined);
    setDecoding(false);
    setElapsed(0);
    // Metadata keeps history placeholders sized before image data is needed.
    if (imageId) {
      void getImageDimensions(imageId)
        .then((size) => {
          if (active && !decodedReady && size)
            setDimensions({ source: src, ...size });
        })
        .catch(() => {
          // Histories without saved metadata use the decoded image dimensions.
        });
    }
    const startLoading = () => {
      if (!active || started) return;
      started = true;
      observer?.disconnect();
      if (reuseCachedImage()) return;
      const startedAt = performance.now();
      timer = window.setInterval(() => {
        setElapsed(Math.floor((performance.now() - startedAt) / 1000));
      }, 1000);
      loadImageAsset(src, imageId, attempt > 0, (progress) => {
        if (active) setDownload(progress);
      })
        .then(async (blob) => {
          if (!active) return;
          setDecoding(true);
          const result = await decodeImagePreview(previewKey, blob);
          release = result.release;
          if (active) {
            decodedReady = true;
            setDimensions({
              source: src,
              width: result.preview.width,
              height: result.preview.height,
            });
            setImage(result.preview);
          } else release();
        })
        .catch(() => {
          if (active) setFailed(true);
        })
        .finally(() => window.clearInterval(timer));
    };
    const element = frame.current;
    if (
      typeof IntersectionObserver === "undefined" ||
      !element ||
      attempt > 0
    ) {
      startLoading();
    } else {
      let root = element.parentElement;
      while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY))
        root = root.parentElement;
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) startLoading();
        },
        { root, rootMargin: "400px 0px" },
      );
      observer.observe(element);
    }
    return () => {
      active = false;
      observer?.disconnect();
      window.clearInterval(timer);
      release?.();
    };
  }, [src, imageId, previewKey, attempt]);
  const readyImage = image?.key === previewKey && !failed ? image : undefined;
  const ratio =
    dimensions?.source === src ? dimensions.width / dimensions.height : 1;
  const percent = download?.total
    ? Math.min(100, Math.floor((download.loaded / download.total) * 100))
    : undefined;
  return (
    <span className={styles["image-result"]}>
      <span
        ref={frame}
        className={styles["image-frame"]}
        style={{ "--image-ratio": ratio } as CSSProperties}
        aria-busy={!readyImage && !failed}
      >
        {readyImage ? (
          <Image
            className={styles["chat-image"]}
            src={readyImage.url}
            alt={alt}
            width={readyImage.width}
            height={readyImage.height}
            unoptimized
            loading="eager"
            role={onImageClick ? "button" : undefined}
            tabIndex={onImageClick ? 0 : undefined}
            aria-label={
              onImageClick ? `打开图片预览${alt ? `：${alt}` : ""}` : undefined
            }
            onClick={() => onImageClick?.(readyImage.url)}
            onKeyDown={(event) => {
              if (
                onImageClick &&
                (event.key === "Enter" || event.key === " ")
              ) {
                event.preventDefault();
                event.stopPropagation();
                onImageClick(readyImage.url);
              }
            }}
            style={{
              cursor: onImageClick ? "pointer" : "default",
              animation: reused ? "none" : undefined,
            }}
          />
        ) : (
          <span className={styles["image-placeholder"]} role="status">
            {failed ? (
              <button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
              >
                <RotateCw size={16} aria-hidden="true" />
                重新加载图片
              </button>
            ) : (
              <span className={styles["image-load"]}>
                <span className={styles["image-load-heading"]}>
                  <span>
                    {decoding
                      ? "正在显示图片"
                      : download
                      ? "正在下载图片"
                      : "正在加载图片"}
                  </span>
                  {!decoding && percent !== undefined && (
                    <span aria-hidden="true">{percent}%</span>
                  )}
                </span>
                {download && !decoding && (
                  <progress
                    className={styles["image-progress"]}
                    max={100}
                    value={percent}
                    aria-label="图片下载进度"
                  />
                )}
                <span className={styles["image-load-meta"]} aria-live="off">
                  <span>
                    {decoding
                      ? download
                        ? "下载完成，正在解码"
                        : "正在解码"
                      : download?.loaded
                      ? download.total
                        ? `${formatBytes(download.loaded)} / ${formatBytes(
                            download.total,
                          )}`
                        : `已下载 ${formatBytes(download.loaded)}`
                      : "等待图片数据"}
                  </span>
                  <span>下载耗时 {formatDuration(elapsed)}</span>
                </span>
              </span>
            )}
          </span>
        )}
      </span>
      <ImageRequestTime durationMs={requestDurationMs} />
    </span>
  );
}

function formatDuration(seconds: number) {
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)
    .toString()
    .padStart(2, "0")}:${(wholeSeconds % 60).toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
