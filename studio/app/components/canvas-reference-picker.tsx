/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState } from "react";
import {
  getImageBlob,
  getImagePage,
  releaseGalleryImages,
  type GalleryImage,
} from "../store/gallery";
import {
  getLocalScope,
  isLocalWorkspaceActive,
} from "../utils/local-workspace";
import styles from "./image-canvas-editor.module.scss";

export function CanvasReferencePicker({
  onSelect,
  onClose,
}: {
  onSelect: (blob: Blob, name: string) => Promise<void>;
  onClose: () => void;
}) {
  const owner = useRef(getLocalScope());
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [query, setQuery] = useState("");
  const [after, setAfter] = useState<IDBValidKey>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const mounted = useRef(true);
  const request = useRef(0);
  const heldImages = useRef<GalleryImage[]>([]);
  const valid = () =>
    mounted.current &&
    isLocalWorkspaceActive() &&
    getLocalScope() === owner.current;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
      releaseGalleryImages(heldImages.current);
      heldImages.current = [];
    };
  }, []);

  const loadPage = async (cursor?: IDBValidKey) => {
    const revision = ++request.current;
    setLoading(true);
    setError("");
    try {
      if (!valid()) throw new Error("账号已切换，请重新打开作品库");
      const result = await getImagePage(
        { query, after: cursor, limit: 24 },
        owner.current,
      );
      if (!valid() || revision !== request.current) {
        releaseGalleryImages(result.images);
        return;
      }
      if (cursor === undefined) {
        releaseGalleryImages(heldImages.current);
        heldImages.current = result.images;
      } else heldImages.current = [...heldImages.current, ...result.images];
      setImages(heldImages.current);
      setAfter(result.after);
    } catch (failure) {
      if (mounted.current && revision === request.current)
        setError(
          failure instanceof Error ? failure.message : "作品库读取失败，请重试",
        );
    } finally {
      if (mounted.current && revision === request.current) setLoading(false);
    }
  };

  useEffect(() => {
    // Invalidate an old query immediately, even while the new query is debounced.
    request.current++;
    setLoading(true);
    const timer = setTimeout(() => void loadPage(), 180);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
    // Query and explicit retry are the only reasons to reload the first page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, attempt]);

  return (
    <section className={styles.picker} aria-label="选择作品库参考图">
      <div className={styles.sectionTitle}>
        <strong>选择作品</strong>
        <button type="button" onClick={onClose} disabled={selecting}>
          收起
        </button>
      </div>
      <label className={styles.field}>
        搜索作品
        <input
          type="search"
          value={query}
          disabled={selecting}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="按提示词或模型搜索"
        />
      </label>
      <div className={styles.pickerGrid}>
        {images
          .filter((item) => item.status === "success")
          .map((item) => (
            <button
              type="button"
              key={item.id}
              disabled={selecting || loading}
              aria-label={`选择作品：${item.prompt || item.model}`}
              title={item.prompt}
              onClick={async () => {
                if (selecting || !valid()) return;
                setSelecting(true);
                setError("");
                try {
                  const blob = await getImageBlob(item.id, owner.current);
                  if (!valid()) return;
                  await onSelect(blob, item.prompt.slice(0, 80) || item.model);
                } catch (failure) {
                  if (valid())
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "原图读取失败，请重试",
                    );
                } finally {
                  if (mounted.current) setSelecting(false);
                }
              }}
            >
              <img
                src={item.imageData}
                alt={item.prompt || "作品图片"}
                loading="lazy"
              />
            </button>
          ))}
      </div>
      {(loading || selecting) && (
        <p className={styles.help} role="status">
          {selecting ? "正在读取作品原图…" : "正在加载作品…"}
        </p>
      )}
      {!loading && !images.length && !error && (
        <p className={styles.help}>暂无可用作品，可上传本地参考图。</p>
      )}
      {error && (
        <div role="alert">
          <p className={styles.error}>{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            重新加载作品
          </button>
        </div>
      )}
      {after !== undefined && (
        <button
          type="button"
          className={styles.addRegion}
          disabled={loading || selecting}
          onClick={() => void loadPage(after)}
        >
          加载更多作品
        </button>
      )}
    </section>
  );
}
