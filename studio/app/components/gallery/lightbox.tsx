"use client";

import React, { useEffect, useCallback, useState, useRef } from "react";
import styles from "./lightbox.module.scss";
import { IconButton } from "../button";
import CloseIcon from "../../icons/close.svg";
import DownloadIcon from "../../icons/download.svg";
import CopyIcon from "../../icons/copy.svg";
import { downloadImage } from "../../utils/image-download";
import { copyImageToClipboard } from "../../utils/image-clipboard";
import { fetchImageBlob } from "../../utils/image-asset";
import { showToast } from "../ui-lib";
import Locale from "../../locales";

interface LightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
  onDownload?: () => void | Promise<void>;
}

export function Lightbox(props: LightboxProps) {
  const { src, alt, onClose, onDownload } = props;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // 缩放与拖拽状态
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  // 重置缩放和位置
  const resetTransform = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // 滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    const delta = -e.deltaY * 0.001;
    setZoom((prev) => Math.min(Math.max(prev + delta, 0.5), 5));
  }, []);

  // 鼠标拖拽
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (zoom <= 1) return;
      e.stopPropagation();
      setIsDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        offsetX: offset.x,
        offsetY: offset.y,
      };
    },
    [zoom, offset],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      e.stopPropagation();
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setOffset({
        x: dragStart.current.offsetX + dx,
        y: dragStart.current.offsetY + dy,
      });
    },
    [isDragging],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 触摸拖拽（单指拖拽放大后的图）
  const touchStart = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (zoom <= 1 || e.touches.length !== 1) return;
      touchStart.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        offsetX: offset.x,
        offsetY: offset.y,
      };
    },
    [zoom, offset],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (zoom <= 1 || e.touches.length !== 1) return;
      // 阻止默认滚动行为，避免拖拽图片时触发页面滚动
      e.preventDefault();
      e.stopPropagation();
      const dx = e.touches[0].clientX - touchStart.current.x;
      const dy = e.touches[0].clientY - touchStart.current.y;
      setOffset({
        x: touchStart.current.offsetX + dx,
        y: touchStart.current.offsetY + dy,
      });
    },
    [zoom],
  );

  // 双击切换缩放
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (zoom > 1) {
        resetTransform();
      } else {
        setZoom(2.5);
      }
    },
    [zoom, resetTransform],
  );

  // 下载图片
  const handleDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      if (onDownload) {
        await onDownload();
      } else {
        await downloadImage(src, alt || "image");
        showToast(Locale.Download.Started);
      }
    } catch {
      showToast(Locale.Download.Failed);
    } finally {
      setDownloading(false);
    }
  }, [src, alt, onDownload, downloading]);

  // 复制图片到剪贴板
  const handleCopy = useCallback(async () => {
    await copyImageToClipboard(() => fetchImageBlob(src));
  }, [src]);

  return (
    <div className={styles.lightbox} onClick={onClose}>
      <div
        className={styles["lightbox-actions"]}
        onClick={(e) => e.stopPropagation()}
      >
        <IconButton
          icon={<DownloadIcon />}
          bordered
          onClick={handleDownload}
          disabled={downloading}
          busy={downloading}
          busyText={Locale.Download.Pending}
          title={downloading ? Locale.Download.Pending : "下载图片"}
          aria="下载图片"
        />
        <IconButton
          icon={<CopyIcon />}
          bordered
          onClick={handleCopy}
          title="复制图片"
          aria="复制图片"
        />
        <IconButton icon={<CloseIcon />} bordered onClick={onClose} />
      </div>

      {/* 缩放指示器 */}
      {zoom !== 1 && (
        <div
          className={styles["lightbox-zoom-indicator"]}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => setZoom((z) => Math.max(z - 0.5, 0.5))}>
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(z + 0.5, 5))}>
            +
          </button>
          <button onClick={resetTransform} title="重置">
            ↺
          </button>
        </div>
      )}

      <div
        className={styles["lightbox-content"]}
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onDoubleClick={handleDoubleClick}
        style={{
          cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "zoom-in",
        }}
      >
        {loading && (
          <div className={styles["lightbox-loading"]}>
            <div className={styles.spinner} />
          </div>
        )}
        {error ? (
          <div className={styles["lightbox-error"]}>
            <span>⚠️</span>
            <p>图片加载失败</p>
            <button
              onClick={() => {
                setError(false);
                setLoading(true);
              }}
            >
              重试
            </button>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- Unknown intrinsic dimensions must preserve native zoom bounds and backdrop hit areas.
          <img
            src={src}
            alt={alt || ""}
            className={styles["lightbox-image"]}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              transition: isDragging
                ? "none"
                : "transform 0.2s var(--ease-out, ease)",
            }}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
            draggable={false}
          />
        )}
      </div>
    </div>
  );
}
