import React, {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
  memo,
} from "react";
import Image from "next/image";
import { messageGeneration } from "../../utils/community-share";
import { CommunityShareButton } from "../community-share-button";
import { useNavigate } from "react-router-dom";
import styles from "./gallery.module.scss";
import Locale from "../../locales";
import { Path } from "../../constant";
import {
  getAllImages,
  deleteImages,
  getStorageSize,
  getGallerySettings,
  saveGallerySettings,
  GalleryImage,
  GallerySettings,
  getImagePage,
  getImageBlob,
  getGallerySummary,
  releaseGalleryImages,
} from "../../store/gallery";
import { Select, showConfirm, showToast } from "../ui-lib";
import {
  getLocalScope,
  isLocalWorkspaceActive,
} from "../../utils/local-workspace";
import { Lightbox } from "./lightbox";
import { GalleryVideoCard, galleryVideoBlob } from "./gallery-video-card";
import { useVideoStore, type VideoResult } from "../../store/video";
import { PageHeader, EmptyState, LoadingState } from "../page-header";
import {
  Image as ImageIcon,
  Search,
  Download,
  CopyPlus,
  Trash2,
  SquareMousePointer,
  X,
  AlertTriangle,
  SlidersHorizontal,
  ImagePlus,
} from "lucide-react";

const GalleryImageCard = memo(function GalleryImageCard(props: {
  img: GalleryImage;
  batchMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: (img: GalleryImage) => void;
  onDelete: (img: GalleryImage) => void;
  onReuse: (img: GalleryImage) => void;
  onDownload: (img: GalleryImage) => void;
}) {
  const {
    img,
    batchMode,
    selected,
    onToggleSelect,
    onOpen,
    onDelete,
    onReuse,
    onDownload,
  } = props;
  const [imgStatus, setImgStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const imgRef = useRef<HTMLImageElement>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    const image = imgRef.current;
    setImgStatus(
      image?.complete
        ? image.naturalWidth > 0
          ? "loaded"
          : "error"
        : "loading",
    );
  }, [img.imageData, retryAttempt]);

  const handleRetry = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setImgStatus("loading");
    setRetryAttempt((attempt) => attempt + 1);
  }, []);

  return (
    <div
      className={`${styles["gallery-card"]} ${
        selected ? styles.selected : ""
      } ${img.status === "failed" ? styles.failed : ""}`}
      onClick={() => batchMode && onToggleSelect(img.id)}
    >
      {batchMode && (
        <div className={styles["card-select"]}>
          <input
            type="checkbox"
            checked={selected}
            aria-label={Locale.Gallery.SelectImage(img.prompt)}
            onChange={() => onToggleSelect(img.id)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      <div className={styles["card-image-area"]}>
        {imgStatus === "loading" && (
          <div className={styles["card-image-loading"]}>
            <div className={styles["card-spinner"]} />
          </div>
        )}

        {imgStatus === "error" && (
          <div className={styles["card-image-error"]}>
            <AlertTriangle className={styles["card-error-icon"]} size={28} />
            <div className={styles["card-error-text"]}>
              {Locale.Gallery.ImageLoadFailed || "图片加载失败"}
            </div>
            <button className={styles["card-retry-btn"]} onClick={handleRetry}>
              {Locale.UI.Retry || "重试"}
            </button>
          </div>
        )}

        <Image
          key={retryAttempt}
          ref={imgRef}
          className={`${styles["card-image"]} ${
            img.status === "failed" ? styles["failed-img"] : ""
          } ${imgStatus === "loaded" ? "" : styles["hidden"]}`}
          src={img.imageData}
          alt={img.prompt}
          fill
          sizes="(max-width: 600px) calc((100vw - 42px) / 2), 360px"
          unoptimized
          loading="lazy"
          decoding="async"
          onLoad={() => setImgStatus("loaded")}
          onError={() => setImgStatus("error")}
          role={batchMode ? undefined : "button"}
          tabIndex={!batchMode && imgStatus === "loaded" ? 0 : -1}
          onKeyDown={(event) => {
            if (
              !batchMode &&
              imgStatus === "loaded" &&
              (event.key === "Enter" || event.key === " ")
            ) {
              event.preventDefault();
              onOpen(img);
            }
          }}
          onClick={() => {
            if (!batchMode && imgStatus === "loaded") {
              onOpen(img);
            }
          }}
        />
      </div>
      <div className={styles["card-info"]}>
        <div className={styles["card-prompt"]} title={img.prompt}>
          {img.prompt}
        </div>
        <div className={styles["card-model"]} title={img.model}>
          {img.model || "\u00a0"}
        </div>
        <div className={styles["card-meta"]}>
          <span className={styles["card-size"]}>
            {img.width > 0 ? `${img.width}×${img.height}` : "\u00a0"}
          </span>
          <span>{Locale.Gallery.Local}</span>
        </div>
      </div>
      {!batchMode && (
        <div className={styles["card-actions"]}>
          {img.status === "success" && (
            <CommunityShareButton
              kind="image"
              resultId={img.id}
              sourceWorkId={img.sourceWorkId}
              source={async () => {
                const original =
                  img.references === undefined
                    ? (await import("../../store/chat")).useChatStore
                        .getState()
                        .sessions.map((session) =>
                          messageGeneration(session.messages, img.id),
                        )
                        .find(Boolean)
                    : undefined;
                return {
                  kind: "image",
                  prompt: original?.prompt ?? img.prompt,
                  model: original?.model || img.model || "",
                  references: (img.references ?? original?.references)?.map(
                    (url) => ({ url }),
                  ),
                  sourceWorkId: img.sourceWorkId ?? original?.sourceWorkId,
                  media: [{ blob: () => getImageBlob(img.id) }],
                };
              }}
            />
          )}
          <button
            className={styles["card-action-btn"]}
            aria-label="下载图片"
            title="下载图片"
            onClick={(e) => {
              e.stopPropagation();
              onDownload(img);
            }}
          >
            <Download size={16} />
          </button>
          <button
            className={styles["card-action-btn"]}
            aria-label={Locale.Chat.Actions.Reuse}
            title={Locale.Chat.Actions.Reuse}
            onClick={(e) => {
              e.stopPropagation();
              onReuse(img);
            }}
          >
            <CopyPlus size={16} aria-hidden="true" />
          </button>
          <button
            className={`${styles["card-action-btn"]} ${styles.danger}`}
            aria-label="删除图片"
            title="删除图片"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(img);
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      )}
    </div>
  );
});

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function GalleryPage() {
  const navigate = useNavigate();
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [filterModel, setFilterModel] = useState("");
  const [filterTime, setFilterTime] = useState("");
  const [filterType, setFilterType] = useState("all");
  const videoResults = useVideoStore((state) => state.results);
  const videoLoads = useRef(0);
  const invalidateVideoLoads = useCallback(() => {
    videoLoads.current++;
  }, []);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [videoLoadError, setVideoLoadError] = useState("");
  const loadVideos = useCallback(() => {
    const id = ++videoLoads.current;
    setLoadingVideos(true);
    setVideoLoadError("");
    void useVideoStore
      .getState()
      .loadDraft()
      .catch(() => {
        if (id === videoLoads.current)
          setVideoLoadError("视频记录加载失败，请重试");
      })
      .finally(() => {
        if (id === videoLoads.current) setLoadingVideos(false);
      });
  }, []);
  useEffect(() => {
    loadVideos();
    return invalidateVideoLoads;
  }, [loadVideos, invalidateVideoLoads]);
  const [storageSize, setStorageSize] = useState("N/A");
  const [settings, setSettings] = useState<GallerySettings>({
    autoSave: true,
    maxCount: 500,
  });
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lightboxImage, setLightboxImage] = useState<GalleryImage | null>(null);
  const [exportProgress, setExportProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [displayCount, setDisplayCount] = useState(60); // 分页渲染，首次只渲染60张
  const [after, setAfter] = useState<IDBValidKey>();
  const [total, setTotal] = useState(0);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [models, setModels] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");
  const imageList = useRef<GalleryImage[]>([]);
  const requestId = useRef(0);
  const downloads = useRef(new Set<AbortController>());
  useEffect(() => {
    const cancel = () =>
      downloads.current.forEach((controller) => controller.abort());
    const events = [
      "local-workspace-switch",
      "local-data-maintenance",
      "model-source-changing",
    ];
    events.forEach((event) => window.addEventListener(event, cancel));
    return () => {
      cancel();
      events.forEach((event) => window.removeEventListener(event, cancel));
    };
  }, []);
  const invalidateRequests = useCallback(() => {
    requestId.current++;
  }, []);
  const settingsRef = useRef<HTMLDetailsElement>(null);
  const hasFilters = !!(
    searchText.trim() ||
    filterModel ||
    filterTime ||
    filterType !== "all"
  );
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(event.target as Node)
      )
        settingsRef.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const query = useMemo(
    () => ({
      query: searchText,
      model: filterModel,
      since: filterTime
        ? Date.now() -
          ({
            today: 86400000,
            week: 604800000,
            month: 2592000000,
            year: 31536000000,
          }[filterTime] ?? 0)
        : undefined,
    }),
    [searchText, filterModel, filterTime],
  );

  const loadImages = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setLoadError("");
    try {
      const [page, summary, librarySummary] = await Promise.all([
        getImagePage(query),
        getGallerySummary(query),
        hasFilters ? getGallerySummary() : undefined,
      ]);
      if (id !== requestId.current) {
        releaseGalleryImages(page.images);
        return;
      }
      releaseGalleryImages(imageList.current);
      imageList.current = page.images;
      setImages(page.images);
      setDisplayCount(60);
      setAfter(page.after);
      setTotal(summary.count);
      setLibraryTotal((librarySummary ?? summary).count);
      setModels(summary.models);
      setSelectedIds(new Set());
      const size = await getStorageSize();
      if (id !== requestId.current) return;
      setStorageSize(size);
      const s = await getGallerySettings();
      if (id !== requestId.current) return;
      setSettings(s);
    } catch (e) {
      console.error("[Gallery] load error:", e);
      if (id === requestId.current) setLoadError("作品加载失败，请重试");
    }
    if (id === requestId.current) setLoading(false);
  }, [query, hasFilters]);

  useEffect(() => {
    loadImages();
    window.addEventListener("gallery-changed", loadImages);
    return () => {
      invalidateRequests();
      window.removeEventListener("gallery-changed", loadImages);
    };
  }, [loadImages, invalidateRequests]);

  const filteredImages = images;
  const videos = videoResults.filter(
    (result) =>
      result.status === "success" &&
      result.url &&
      !result.galleryHidden &&
      result.request?.autoSaveGallery !== false,
  );
  const matchesQuery = (item: {
    prompt: string;
    model: string;
    createdAt: number;
  }) =>
    (!query.query.trim() ||
      `${item.prompt} ${item.model}`
        .toLowerCase()
        .includes(query.query.trim().toLowerCase())) &&
    (!query.model || item.model === query.model) &&
    (!query.since || item.createdAt >= query.since);
  const filteredVideos =
    filterType === "image" ? [] : videos.filter(matchesQuery);
  const works = [
    ...(filterType === "video"
      ? []
      : filteredImages.map((image) => ({
          kind: "image" as const,
          image,
          createdAt: image.createdAt,
        }))),
    ...filteredVideos.map((video) => ({
      kind: "video" as const,
      video,
      createdAt: video.createdAt,
    })),
  ].sort((left, right) => right.createdAt - left.createdAt);
  const workCount =
    (filterType === "video" ? 0 : total) + filteredVideos.length;
  const libraryCount = libraryTotal + videos.length;
  const workModels = [
    ...new Set([...models, ...videos.map((video) => video.model)]),
  ].filter(Boolean);
  const hasMore =
    (filterType !== "video" && after !== undefined) || workCount > displayCount;
  const clearFilters = () => {
    setSearchText("");
    setFilterModel("");
    setFilterTime("");
    setFilterType("all");
    setBatchMode(false);
    setSelectedIds(new Set());
  };
  useEffect(() => () => releaseGalleryImages(imageList.current), []);
  useEffect(
    () => () => {
      if (lightboxImage?.imageData.startsWith("blob:"))
        URL.revokeObjectURL(lightboxImage.imageData);
    },
    [lightboxImage],
  );

  const loadMore = async () => {
    if (loading) return;
    if (filterType === "video" || after === undefined) {
      setDisplayCount((count) => count + 60);
      return;
    }
    const id = requestId.current;
    setLoading(true);
    try {
      const page = await getImagePage({ ...query, after });
      if (id !== requestId.current) {
        releaseGalleryImages(page.images);
        return;
      }
      imageList.current = [...imageList.current, ...page.images];
      setImages(imageList.current);
      setAfter(page.after);
      setDisplayCount((count) => count + 60);
    } catch {
      if (id === requestId.current) setLoadError("作品加载失败，请重试");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  const openOriginal = async (img: GalleryImage) => {
    const id = requestId.current;
    try {
      const blob = await getImageBlob(img.id);
      if (id !== requestId.current) return;
      setLightboxImage({ ...img, imageData: URL.createObjectURL(blob) });
    } catch {
      if (id === requestId.current) showToast("原图读取失败，请重试");
    }
  };

  // 筛选条件变化时重置分页
  useEffect(() => {
    setDisplayCount(60);
  }, [searchText, filterModel, filterTime, filterType]);

  const handleSettingsChange = async (patch: Partial<GallerySettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveGallerySettings(next);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = async () => {
    const all = await getAllImages();
    setSelectedIds(
      new Set([
        ...(filterType === "video"
          ? []
          : all.filter(matchesQuery).map((img) => `image:${img.id}`)),
        ...filteredVideos.map((video) => `video:${video.id}`),
      ]),
    );
    releaseGalleryImages(all);
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!(await showConfirm(Locale.Gallery.ConfirmDelete))) return;
    await deleteImages(
      Array.from(selectedIds)
        .filter((id) => id.startsWith("image:"))
        .map((id) => id.slice(6)),
    );
    for (const video of videos)
      if (selectedIds.has(`video:${video.id}`))
        await useVideoStore
          .getState()
          .updateResult(video.id, { galleryHidden: true });
    setSelectedIds(new Set());
    setBatchMode(false);
    await loadImages();
    showToast(Locale.Gallery.Deleted);
  };

  const handleDeleteFailed = async () => {
    const all = await getAllImages();
    const failed = all.filter((img) => img.status === "failed");
    releaseGalleryImages(all);
    if (failed.length === 0) return;
    if (!(await showConfirm(Locale.Gallery.ConfirmDeleteFailed))) return;
    await deleteImages(failed.map((img) => img.id));
    await loadImages();
    showToast(Locale.Gallery.Deleted);
  };

  const handleDeleteOne = async (id: string) => {
    await deleteImages([id]);
    await loadImages();
  };

  const handleReuse = (kind: "image" | "video", id: string) => {
    if (!isLocalWorkspaceActive()) return;
    navigate(Path.Chat, {
      state: { reuseGalleryWork: { kind, id, scope: getLocalScope() } },
    });
  };

  const handleSaveImage = async (img: GalleryImage) => {
    const id = requestId.current;
    try {
      const blob = await getImageBlob(img.id);
      if (id !== requestId.current) return;
      const ext = blob.type.split("/")[1] || "png";
      downloadBlob(blob, `gallery-${img.id}.${ext}`);
      showToast(Locale.Gallery.Saved);
    } catch {
      if (id === requestId.current) showToast("图片下载失败，请重试");
    }
  };
  const handleSaveVideo = async (video: VideoResult) => {
    const id = requestId.current;
    if (!video.mediaPath) {
      const link = document.createElement("a");
      link.href = video.url;
      link.download = `video-${video.id}.mp4`;
      link.rel = "noopener";
      link.target = "_blank";
      link.click();
      return;
    }
    const controller = new AbortController();
    downloads.current.add(controller);
    try {
      const blob = await galleryVideoBlob(video, controller.signal);
      if (id !== requestId.current || controller.signal.aborted) return;
      downloadBlob(
        blob,
        `video-${video.id}.${blob.type.split("/")[1] || "mp4"}`,
      );
    } finally {
      downloads.current.delete(controller);
    }
  };
  const hideVideo = async (video: VideoResult) => {
    const id = requestId.current;
    if (!(await showConfirm("从作品库移除此视频？视频区的生成记录会保留。")))
      return;
    if (id !== requestId.current) return;
    try {
      await useVideoStore
        .getState()
        .updateResult(video.id, { galleryHidden: true });
    } catch {
      showToast("移除失败，请重试");
    }
  };

  const handleExportAll = async () => {
    const id = requestId.current;
    const all = await getAllImages();
    if (id !== requestId.current) {
      releaseGalleryImages(all);
      return;
    }
    const toExport =
      filterType === "video"
        ? []
        : all.filter((img) =>
            batchMode
              ? selectedIds.has(`image:${img.id}`)
              : (!filterModel || img.model === filterModel) &&
                (!query.query ||
                  `${img.prompt} ${img.model}`
                    .toLowerCase()
                    .includes(query.query.toLowerCase())) &&
                (!query.since || img.createdAt >= query.since),
          );
    const videosToExport = batchMode
      ? filteredVideos.filter((video) => selectedIds.has(`video:${video.id}`))
      : filteredVideos;
    const exportCount = toExport.length + videosToExport.length;
    if (exportCount === 0) {
      releaseGalleryImages(all);
      return;
    }

    setExportProgress({ current: 0, total: exportCount });

    for (let i = 0; i < toExport.length; i++) {
      if (id !== requestId.current) break;
      const img = toExport[i];
      await handleSaveImage(img);
      if (id !== requestId.current) break;
      setExportProgress({ current: i + 1, total: exportCount });
      await new Promise((r) => setTimeout(r, 200));
    }

    for (let index = 0; index < videosToExport.length; index++) {
      if (id !== requestId.current) break;
      try {
        await handleSaveVideo(videosToExport[index]);
      } catch {
        showToast("视频下载失败，请重试");
      }
      setExportProgress({
        current: toExport.length + index + 1,
        total: exportCount,
      });
    }
    setExportProgress(null);
    releaseGalleryImages(all);
    if (id === requestId.current)
      showToast(
        videosToExport.length
          ? `已处理 ${exportCount} 件作品`
          : Locale.Gallery.ExportComplete(toExport.length),
      );
  };

  return (
    <div className={styles["gallery-page"]}>
      <PageHeader title={Locale.Gallery.Title} icon={<ImageIcon size={20} />} />

      <div className={styles["gallery-controls"]}>
        <div className={styles["gallery-toolbar"]}>
          <label className={styles["search-field"]}>
            <Search size={17} aria-hidden="true" />
            <input
              className={styles["filter-search"]}
              type="text"
              placeholder={Locale.Gallery.Search}
              aria-label={Locale.Gallery.Search}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </label>
          <Select
            className={styles["filter-select"]}
            aria-label="作品类型"
            value={filterType}
            onChange={(event) => {
              setFilterType(event.target.value);
              setBatchMode(false);
              setSelectedIds(new Set());
            }}
          >
            <option value="all">全部作品</option>
            <option value="image">图片</option>
            <option value="video">视频</option>
          </Select>
          <Select
            className={styles["filter-select"]}
            aria-label={Locale.Gallery.AllModels}
            value={filterModel}
            onChange={(e) => setFilterModel(e.target.value)}
          >
            <option value="">{Locale.Gallery.AllModels}</option>
            {workModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Select
            className={styles["filter-select"]}
            aria-label={Locale.Gallery.TimeFilter.All}
            value={filterTime}
            onChange={(e) => setFilterTime(e.target.value)}
          >
            <option value="">{Locale.Gallery.TimeFilter.All}</option>
            <option value="today">{Locale.Gallery.TimeFilter.Today}</option>
            <option value="week">{Locale.Gallery.TimeFilter.Week}</option>
            <option value="month">{Locale.Gallery.TimeFilter.Month}</option>
            <option value="year">{Locale.Gallery.TimeFilter.Year}</option>
          </Select>
        </div>

        <div className={styles["gallery-info-bar"]}>
          <div className={styles["gallery-stats"]}>
            <span>{Locale.Gallery.StorageInfo(workCount)}</span>
            <span>{Locale.Gallery.StorageSize(storageSize)}</span>
          </div>
          <div className={styles["gallery-actions"]}>
            {works.length > 0 &&
              (batchMode ? (
                <>
                  <button
                    className={`${styles["action-btn"]} ${styles.active}`}
                    onClick={selectAll}
                  >
                    <SquareMousePointer size={15} aria-hidden="true" />
                    {Locale.Gallery.SelectAll}
                  </button>
                  <button
                    className={`${styles["action-btn"]} ${styles.danger}`}
                    disabled={selectedIds.size === 0}
                    onClick={handleDeleteSelected}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    {Locale.Gallery.DeleteSelected} ({selectedIds.size})
                  </button>
                  <button
                    className={styles["action-btn"]}
                    onClick={() => {
                      setBatchMode(false);
                      setSelectedIds(new Set());
                    }}
                  >
                    <X size={15} aria-hidden="true" />
                    {Locale.Gallery.CancelSelect}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className={styles["action-btn"]}
                    onClick={() => setBatchMode(true)}
                  >
                    <SquareMousePointer size={15} aria-hidden="true" />
                    {Locale.Gallery.BatchSelect}
                  </button>
                  <button
                    className={styles["action-btn"]}
                    onClick={handleExportAll}
                  >
                    <Download size={15} aria-hidden="true" />
                    {Locale.Gallery.ExportAll}
                  </button>
                </>
              ))}
            <details
              ref={settingsRef}
              className={styles["gallery-settings"]}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}
              onBlur={(event) => {
                // A label click focuses its input after briefly clearing focus.
                if (
                  event.relatedTarget &&
                  !event.currentTarget.contains(event.relatedTarget as Node)
                )
                  event.currentTarget.open = false;
              }}
            >
              <summary
                role="button"
                aria-label={Locale.Gallery.Settings}
                title={Locale.Gallery.Settings}
              >
                <SlidersHorizontal size={17} aria-hidden="true" />
              </summary>
              <div className={styles["settings-panel"]}>
                <label className={styles["auto-save-toggle"]}>
                  <span>{Locale.Gallery.AutoSave}</span>
                  <input
                    type="checkbox"
                    checked={settings.autoSave}
                    onChange={(event) =>
                      void handleSettingsChange({
                        autoSave: event.target.checked,
                      })
                    }
                  />
                </label>
                <label className={styles["max-count-input"]}>
                  <span>{Locale.Gallery.MaxCount}</span>
                  <input
                    type="number"
                    min={100}
                    max={1000}
                    value={settings.maxCount}
                    onChange={(event) => {
                      const value = Math.min(
                        1000,
                        Math.max(100, +event.target.value || 500),
                      );
                      void handleSettingsChange({ maxCount: value });
                    }}
                  />
                </label>
                <button
                  className={`${styles["action-btn"]} ${styles.danger}`}
                  onClick={() => {
                    if (settingsRef.current) settingsRef.current.open = false;
                    void handleDeleteFailed();
                  }}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  {Locale.Gallery.DeleteFailed}
                </button>
              </div>
            </details>
          </div>
        </div>
      </div>

      {(loadError || videoLoadError) && (
        <div role="alert" className={styles["gallery-error"]}>
          {loadError || videoLoadError}
          <button
            onClick={() => {
              void loadImages();
              loadVideos();
            }}
          >
            重试
          </button>
        </div>
      )}
      {(loading || loadingVideos) && works.length === 0 ? (
        <LoadingState />
      ) : works.length === 0 ? (
        !loadError &&
        !videoLoadError && (
          <div className={styles["gallery-empty"]} role="status">
            <EmptyState
              variant="plain"
              icon={<ImageIcon size={32} strokeWidth={1.5} />}
              text={
                libraryCount > 0 && hasFilters
                  ? "没有找到匹配的作品"
                  : Locale.Gallery.Empty
              }
              action={
                <button
                  type="button"
                  className={styles["empty-action"]}
                  onClick={
                    libraryCount > 0 && hasFilters
                      ? clearFilters
                      : () =>
                          navigate(Path.Chat, {
                            state: { selectImageModel: true },
                          })
                  }
                >
                  {libraryCount > 0 && hasFilters ? (
                    <X size={15} aria-hidden="true" />
                  ) : (
                    <ImagePlus size={15} aria-hidden="true" />
                  )}
                  {libraryCount > 0 && hasFilters ? "清除筛选" : "开始生图"}
                </button>
              }
            />
          </div>
        )
      ) : (
        <>
          <div
            className={`${styles["gallery-grid"]} ${
              batchMode ? styles.selecting : ""
            }`}
          >
            {works
              .slice(0, displayCount)
              .map((work) =>
                work.kind === "video" ? (
                  <GalleryVideoCard
                    key={`video:${work.video.id}`}
                    result={work.video}
                    batchMode={batchMode}
                    selected={selectedIds.has(`video:${work.video.id}`)}
                    onSelect={() => toggleSelect(`video:${work.video.id}`)}
                    onDelete={() => void hideVideo(work.video)}
                    onDownload={() => handleSaveVideo(work.video)}
                    onReuse={() => handleReuse("video", work.video.id)}
                  />
                ) : (
                  <GalleryImageCard
                    key={`image:${work.image.id}`}
                    img={work.image}
                    batchMode={batchMode}
                    selected={selectedIds.has(`image:${work.image.id}`)}
                    onToggleSelect={(id) => toggleSelect(`image:${id}`)}
                    onOpen={openOriginal}
                    onDelete={(img) => handleDeleteOne(img.id)}
                    onReuse={(img) => handleReuse("image", img.id)}
                    onDownload={(img) => handleSaveImage(img)}
                  />
                ),
              )}
          </div>
          {hasMore && (
            <div className={styles["load-more"]}>
              <button
                className={styles["load-more-btn"]}
                onClick={loadMore}
                disabled={loading}
              >
                加载更多（剩余 {Math.max(0, workCount - displayCount)} 件）
              </button>
            </div>
          )}
        </>
      )}

      {exportProgress && (
        <div className={styles["export-progress"]}>
          <div className={styles["progress-bar"]}>
            <div
              className={styles["progress-fill"]}
              style={{
                width: `${
                  (exportProgress.current / exportProgress.total) * 100
                }%`,
              }}
            />
          </div>
          <span>
            {exportProgress.current} / {exportProgress.total}
          </span>
        </div>
      )}

      {lightboxImage && (
        <Lightbox
          src={lightboxImage.imageData}
          alt={lightboxImage.prompt}
          onClose={() => setLightboxImage(null)}
          onDownload={() => handleSaveImage(lightboxImage)}
        />
      )}
    </div>
  );
}
