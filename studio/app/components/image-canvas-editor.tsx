/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import {
  buildCanvasEditPrompt,
  loadCanvasImage,
  moveCanvasAnnotation,
  normalizeCanvasRect,
  renderCanvasImage,
  canvasBlobDataUrl,
  MAX_CANVAS_REFERENCES,
  type CanvasReference,
  type CanvasAnnotation,
  type CanvasEditDraft,
  type CanvasPoint,
} from "../utils/image-canvas";
import { fetchImageBlob } from "../utils/image-asset";
import { uploadImage } from "../utils/chat";
import {
  getLocalScope,
  isLocalWorkspaceActive,
} from "../utils/local-workspace";
import { CanvasReferencePicker } from "./canvas-reference-picker";
import styles from "./image-canvas-editor.module.scss";

type Tool = CanvasAnnotation["kind"] | "select";
const tools: { id: Tool; label: string }[] = [
  { id: "select", label: "选择" },
  { id: "rect", label: "框选" },
  { id: "ellipse", label: "圈选" },
  { id: "arrow", label: "箭头" },
  { id: "pen", label: "画笔" },
  { id: "text", label: "文字" },
];

function ToolIcon({ kind }: { kind: Tool }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "select" && <path d="m5 3 14 9-7 1-3 7Z" />}
      {kind === "rect" && <rect x="4" y="5" width="16" height="14" rx="1" />}
      {kind === "ellipse" && <ellipse cx="12" cy="12" rx="9" ry="7" />}
      {kind === "arrow" && <path d="M4 20 20 4M9 4h11v11" />}
      {kind === "pen" && <path d="m4 17 12-12 3 3L7 20l-4 1ZM14 7l3 3" />}
      {kind === "text" && <path d="M5 5h14M12 5v15M8 20h8M5 5v3M19 5v3" />}
    </svg>
  );
}

function annotationBounds(a: CanvasAnnotation) {
  const xs = a.points.map((p) => p.x);
  const ys = a.points.map((p) => p.y);
  if (a.kind === "text") {
    const lines = a.text.split("\n");
    return {
      x: xs[0],
      y: ys[0],
      width: Math.max(
        a.fontSize,
        ...lines.map((line) => Array.from(line).length * a.fontSize),
      ),
      height: lines.length * a.fontSize * 1.3,
    };
  }
  return normalizeCanvasRect(
    { x: Math.min(...xs), y: Math.min(...ys) },
    { x: Math.max(...xs), y: Math.max(...ys) },
  );
}

function AnnotationShape({ annotation: a }: { annotation: CanvasAnnotation }) {
  const first = a.points[0];
  const last = a.points[a.points.length - 1];
  const bounds = normalizeCanvasRect(first, last);
  const common = {
    stroke: a.color,
    strokeWidth: a.strokeWidth,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (a.kind === "rect") return <rect {...common} {...bounds} />;
  if (a.kind === "ellipse")
    return (
      <ellipse
        {...common}
        cx={bounds.x + bounds.width / 2}
        cy={bounds.y + bounds.height / 2}
        rx={bounds.width / 2}
        ry={bounds.height / 2}
      />
    );
  if (a.kind === "text")
    return (
      <text
        x={first.x}
        y={first.y}
        fill={a.color}
        fontSize={a.fontSize}
        fontFamily="sans-serif"
        dominantBaseline="hanging"
      >
        {a.text.split("\n").map((line, i) => (
          <tspan key={i} x={first.x} dy={i ? a.fontSize * 1.3 : 0}>
            {line || " "}
          </tspan>
        ))}
      </text>
    );
  if (a.kind === "arrow") {
    const angle = Math.atan2(last.y - first.y, last.x - first.x);
    const head = Math.max(a.strokeWidth * 4, 12);
    return (
      <path
        {...common}
        d={`M ${first.x} ${first.y} L ${last.x} ${last.y} M ${
          last.x - head * Math.cos(angle - Math.PI / 6)
        } ${last.y - head * Math.sin(angle - Math.PI / 6)} L ${last.x} ${
          last.y
        } L ${last.x - head * Math.cos(angle + Math.PI / 6)} ${
          last.y - head * Math.sin(angle + Math.PI / 6)
        }`}
      />
    );
  }
  return (
    <polyline
      {...common}
      points={a.points.map((p) => `${p.x},${p.y}`).join(" ")}
    />
  );
}

export function ImageCanvasEditor({
  src,
  onBack,
  onSubmit,
  active = true,
  validateContext,
}: {
  src: string;
  onBack: () => void;
  onSubmit?: (draft: CanvasEditDraft) => void | Promise<void>;
  active?: boolean;
  validateContext?: () => void;
}) {
  const [annotations, setAnnotations] = useState<CanvasAnnotation[]>([]);
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<CanvasReference[]>([]);
  const [pickingReference, setPickingReference] = useState(false);
  const referenceInput = useRef<HTMLInputElement>(null);
  const owner = useRef(getLocalScope());
  const [tool, setTool] = useState<Tool>("rect");
  const [selectedId, setSelectedId] = useState<string>();
  const [color, setColor] = useState("#ef4444");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [image, setImage] = useState<HTMLImageElement>();
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState("");
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ width: 800, height: 600 });
  const [past, setPast] = useState<CanvasAnnotation[][]>([]);
  const [future, setFuture] = useState<CanvasAnnotation[][]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const annotationDetailsRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<{
    pointerId: number;
    start: CanvasPoint;
    before: CanvasAnnotation[];
    annotation: CanvasAnnotation;
    moving: boolean;
  }>();
  const mounted = useRef(true);
  const selected = annotations.find((a) => a.id === selectedId);
  const width = image?.naturalWidth ?? 1;
  const height = image?.naturalHeight ?? 1;
  const fit = Math.min(
    (viewport.width - 48) / width,
    (viewport.height - 48) / height,
    1,
  );
  const scale = Math.max(0.01, fit) * zoom;
  const ready = !!image && !loading && !busy;

  useEffect(() => {
    if (!selectedId || gesture.current) return;
    // Keep the image stationary during drawing; scrolling changes pointer
    // coordinates on mobile. Completed gestures reveal the form below.
    annotationDetailsRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  useEffect(() => {
    mounted.current = true;
    rootRef.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    let dispose: (() => void) | undefined;
    setLoading(true);
    setImage(undefined);
    setError("");
    loadCanvasImage(src, abort.signal)
      .then((loaded) => {
        if (abort.signal.aborted) {
          loaded.dispose();
          return;
        }
        dispose = loaded.dispose;
        setImage(loaded.image);
        setLoading(false);
      })
      .catch((failure) => {
        if (abort.signal.aborted) return;
        setError(
          failure instanceof Error ? failure.message : "图片读取失败，请重试",
        );
        setLoading(false);
      });
    return () => {
      abort.abort();
      dispose?.();
    };
  }, [src, loadAttempt]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setViewport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (active) rootRef.current?.focus({ preventScroll: true });
  }, [active]);

  const assertActive = () => {
    if (
      !mounted.current ||
      !isLocalWorkspaceActive() ||
      getLocalScope() !== owner.current
    ) {
      throw new Error("账号或工作台已切换，请重新打开图片");
    }
    validateContext?.();
  };

  const addReferences = async (files: { blob: Blob; name: string }[]) => {
    if (busyRef.current) return;
    if (references.length + files.length > MAX_CANVAS_REFERENCES) {
      throw new Error(
        `最多添加 ${MAX_CANVAS_REFERENCES} 张参考图，请减少所选图片`,
      );
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const added: CanvasReference[] = [];
      for (const { blob, name } of files) {
        assertActive();
        if (
          !blob.type.startsWith("image/") ||
          !blob.size ||
          blob.size > 20 * 1024 * 1024
        ) {
          throw new Error("请选择不超过 20 MB 的有效图片文件");
        }
        added.push({
          id: nanoid(),
          name,
          src: await uploadImage(blob),
        });
      }
      assertActive();
      setReferences((current) => [...current, ...added]);
      if (selected && added[0])
        updateSelected({ target: "object", referenceId: added[0].id });
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const commit = (next: CanvasAnnotation[], before = annotations) => {
    setPast((items) => [...items.slice(-49), before]);
    setFuture([]);
    setAnnotations(next);
    setNotice("");
  };
  const updateSelected = (patch: Partial<CanvasAnnotation>) => {
    if (selected)
      commit(
        annotations.map((a) => (a.id === selected.id ? { ...a, ...patch } : a)),
      );
  };
  const undo = () => {
    if (!past.length || busy || gesture.current) return;
    setFuture((items) => [annotations, ...items]);
    setAnnotations(past[past.length - 1]);
    setPast(past.slice(0, -1));
  };
  const redo = () => {
    if (!future.length || busy || gesture.current) return;
    setPast((items) => [...items, annotations]);
    setAnnotations(future[0]);
    setFuture(future.slice(1));
  };
  const removeSelected = () => {
    if (!selected || busy) return;
    commit(annotations.filter((a) => a.id !== selected.id));
    setSelectedId(undefined);
  };

  const cancelGesture = () => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = undefined;
    setAnnotations(current.before);
    if (svgRef.current?.hasPointerCapture(current.pointerId)) {
      svgRef.current.releasePointerCapture(current.pointerId);
    }
  };
  const chooseTool = (next: Tool) => {
    cancelGesture();
    setTool(next);
  };

  const pointFromEvent = (
    event: React.PointerEvent<SVGSVGElement>,
  ): CanvasPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(width, ((event.clientX - bounds.left) / bounds.width) * width),
      ),
      y: Math.max(
        0,
        Math.min(
          height,
          ((event.clientY - bounds.top) / bounds.height) * height,
        ),
      ),
    };
  };
  const createAnnotation = (
    point: CanvasPoint,
    kind: CanvasAnnotation["kind"],
  ): CanvasAnnotation => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind,
    points: kind === "text" ? [point] : [point, point],
    color,
    strokeWidth: strokeWidth * Math.max(1, Math.min(width, height) / 800),
    fontSize: Math.max(24, Math.round(Math.min(width, height) / 24)),
    text: kind === "text" ? "双击或在右侧修改文字" : "",
    instruction: "",
    target: kind === "rect" || kind === "ellipse" ? "text" : "object",
    replacement: "",
  });
  const startGesture = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!ready || event.button !== 0 || gesture.current) return;
    if (tool !== "select" && annotations.length >= 40) {
      setError("单张图片最多添加 40 个标注，请先删除不需要的标注。");
      return;
    }
    const start = pointFromEvent(event);
    if (tool === "text") {
      const annotation = createAnnotation(start, "text");
      commit([...annotations, annotation]);
      setSelectedId(annotation.id);
      setTool("select");
      return;
    }
    if (tool === "select") {
      const target = (event.target as Element).closest("[data-annotation-id]");
      const existing = annotations.find(
        (a) => a.id === target?.getAttribute("data-annotation-id"),
      );
      setSelectedId(existing?.id);
      if (!existing) return;
      gesture.current = {
        pointerId: event.pointerId,
        start,
        before: annotations,
        annotation: existing,
        moving: true,
      };
    } else {
      const annotation = createAnnotation(start, tool);
      gesture.current = {
        pointerId: event.pointerId,
        start,
        before: annotations,
        annotation,
        moving: false,
      };
      setAnnotations([...annotations, annotation]);
      setSelectedId(annotation.id);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const changeGesture = (event: React.PointerEvent<SVGSVGElement>) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const point = pointFromEvent(event);
    if (!current.moving && current.annotation.kind === "pen") {
      const last =
        current.annotation.points[current.annotation.points.length - 1];
      if (
        Math.hypot(point.x - last.x, point.y - last.y) * scale < 2 ||
        current.annotation.points.length >= 10000
      )
        return;
    }
    const next = current.moving
      ? moveCanvasAnnotation(
          current.annotation,
          point.x - current.start.x,
          point.y - current.start.y,
          width,
          height,
        )
      : {
          ...current.annotation,
          points:
            current.annotation.kind === "pen"
              ? [...current.annotation.points, point]
              : [current.start, point],
        };
    // Retain pen samples, but keep the original annotation as the move anchor.
    if (!current.moving) current.annotation = next;
    setAnnotations([...current.before.filter((a) => a.id !== next.id), next]);
  };
  const finishGesture = (
    event: React.PointerEvent<SVGSVGElement>,
    cancel = false,
  ) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    gesture.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    if (
      cancel ||
      (Math.hypot(point.x - current.start.x, point.y - current.start.y) *
        scale <
        3 &&
        current.annotation.kind !== "pen")
    ) {
      setAnnotations(current.before);
      return;
    }
    const finalAnnotation = current.moving
      ? moveCanvasAnnotation(
          current.annotation,
          point.x - current.start.x,
          point.y - current.start.y,
          width,
          height,
        )
      : {
          ...current.annotation,
          points:
            current.annotation.kind === "pen"
              ? [...current.annotation.points, point]
              : [current.start, point],
        };
    commit(
      [
        ...current.before.filter((a) => a.id !== finalAnnotation.id),
        finalAnnotation,
      ],
      current.before,
    );
    // Keep the completed stroke selected even if the pointer-up event caused
    // another render while the annotation was being committed.
    setSelectedId(finalAnnotation.id);
    requestAnimationFrame(() => {
      if (!gesture.current)
        annotationDetailsRef.current?.scrollIntoView?.({ block: "nearest" });
    });
  };

  const runExport = async (forAI: boolean) => {
    if (!image || loading || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      assertActive();
      if (forAI) {
        if (!onSubmit) return;
        const editPrompt = buildCanvasEditPrompt(
          annotations,
          width,
          height,
          prompt,
          references,
        );
        const images = [
          await canvasBlobDataUrl(await fetchImageBlob(image.src)),
        ];
        if (annotations.length) {
          const blob = await renderCanvasImage(image, annotations, {
            includeLabels: true,
          });
          if (!mounted.current) return;
          images.push(await canvasBlobDataUrl(blob));
        }
        images.push(...references.map((reference) => reference.src));
        assertActive();
        await onSubmit({ prompt: editPrompt, images });
      } else {
        const blob = await renderCanvasImage(image, annotations);
        if (!mounted.current) return;
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = `画布编辑-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        setNotice("已保存含标注的图片，原图保持不变。");
      }
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error ? failure.message : "操作失败，请重试",
        );
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <div
      className={styles.editor}
      hidden={!active}
      ref={rootRef}
      tabIndex={-1}
      aria-label="图片画布编辑器"
      onKeyDown={(event) => {
        // The surrounding viewer owns Escape. Editing shortcuts must never
        // change gallery images or fire while typing in a text field.
        if (event.key !== "Escape" && event.key !== "Tab")
          event.stopPropagation();
        const target = event.target as HTMLElement;
        if (
          target.matches("input, textarea, select") ||
          target.isContentEditable ||
          busy
        )
          return;
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "z"
        ) {
          event.preventDefault();
          event.shiftKey ? redo() : undo();
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "y"
        ) {
          event.preventDefault();
          redo();
        }
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          removeSelected();
        }
        if (
          selected &&
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          )
        ) {
          event.preventDefault();
          const step = event.shiftKey ? 10 : 1;
          const dx =
            event.key === "ArrowLeft"
              ? -step
              : event.key === "ArrowRight"
              ? step
              : 0;
          const dy =
            event.key === "ArrowUp"
              ? -step
              : event.key === "ArrowDown"
              ? step
              : 0;
          updateSelected(moveCanvasAnnotation(selected, dx, dy, width, height));
        }
      }}
    >
      <header className={styles.header}>
        <div className={styles.heading}>
          <button type="button" onClick={onBack} disabled={busy}>
            返回预览
          </button>
          <div>
            <strong>图片画布</strong>
            <span>圈出主图中的目标，可添加参考图替换人物或物品</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void runExport(false)}
          disabled={!ready}
        >
          {busy ? "处理中…" : "保存标注图片"}
        </button>
      </header>
      <div className={styles.workspace}>
        <div className={styles.tools} role="toolbar" aria-label="画布工具">
          {tools.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={tool === item.id}
              disabled={!ready}
              onClick={() => chooseTool(item.id)}
              title={item.label}
            >
              <ToolIcon kind={item.id} />
              <span>{item.label}</span>
            </button>
          ))}
          <span className={styles.divider} />
          <button
            type="button"
            aria-label="撤销"
            title="撤销 Ctrl+Z"
            disabled={!past.length || busy}
            onClick={undo}
          >
            撤销
          </button>
          <button
            type="button"
            aria-label="重做"
            title="重做 Ctrl+Shift+Z"
            disabled={!future.length || busy}
            onClick={redo}
          >
            重做
          </button>
        </div>
        <div className={styles.canvasColumn}>
          <div className={styles.canvasBar}>
            <span>{image ? `${width} × ${height}` : "载入图片"}</span>
            <div>
              <button
                type="button"
                aria-label="缩小画布"
                disabled={!ready || zoom <= 0.25}
                onClick={() => setZoom((v) => Math.max(0.25, v / 1.25))}
              >
                −
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                title="适合画布"
                disabled={!ready}
              >
                {Math.round(scale * 100)}%
              </button>
              <button
                type="button"
                aria-label="放大画布"
                disabled={!ready || zoom >= 8}
                onClick={() => setZoom((v) => Math.min(8, v * 1.25))}
              >
                +
              </button>
            </div>
          </div>
          <div className={styles.stage} ref={stageRef}>
            {loading && (
              <div className={styles.empty} role="status">
                正在加载可编辑图片…
              </div>
            )}
            {!loading && !image && (
              <div className={styles.empty}>
                <p>暂时无法打开这张图片</p>
                <button
                  type="button"
                  onClick={() => setLoadAttempt((n) => n + 1)}
                >
                  重新加载
                </button>
              </div>
            )}
            {image && (
              <div
                className={styles.sheetWrap}
                style={{
                  width: width * scale + 48,
                  height: height * scale + 48,
                }}
              >
                <svg
                  ref={svgRef}
                  className={styles.sheet}
                  style={{
                    width: width * scale,
                    height: height * scale,
                    cursor: tool === "select" ? "default" : "crosshair",
                  }}
                  viewBox={`0 0 ${width} ${height}`}
                  role="img"
                  aria-label="可编辑图片，使用工具拖动添加标注，也可在右侧添加中心选区"
                  onPointerDown={startGesture}
                  onPointerMove={changeGesture}
                  onPointerUp={(event) => finishGesture(event)}
                  onPointerCancel={(event) => finishGesture(event, true)}
                  onLostPointerCapture={cancelGesture}
                  onDoubleClick={() => {
                    if (selected?.kind === "text")
                      rootRef.current
                        ?.querySelector<HTMLTextAreaElement>(
                          "[data-overlay-text]",
                        )
                        ?.focus();
                  }}
                >
                  <image
                    href={image.src}
                    width={width}
                    height={height}
                    pointerEvents="none"
                  />
                  {annotations.map((annotation, index) => {
                    const bounds = annotationBounds(annotation);
                    const r = Math.max(12, Math.min(width, height) * 0.018);
                    const labelX =
                      width < r * 2 + 4
                        ? width / 2
                        : Math.min(
                            width - r - 2,
                            Math.max(r + 2, annotation.points[0].x),
                          );
                    const labelY =
                      height < r * 2 + 4
                        ? height / 2
                        : Math.min(
                            height - r - 2,
                            Math.max(r + 2, annotation.points[0].y),
                          );
                    return (
                      <g
                        key={annotation.id}
                        data-annotation-id={annotation.id}
                        style={{
                          pointerEvents: tool === "select" ? "all" : "none",
                        }}
                      >
                        {tool === "select" && (
                          <rect
                            x={bounds.x - 4 / scale}
                            y={bounds.y - 4 / scale}
                            width={
                              Math.max(bounds.width, 10 / scale) + 8 / scale
                            }
                            height={
                              Math.max(bounds.height, 10 / scale) + 8 / scale
                            }
                            fill="transparent"
                            stroke={
                              selectedId === annotation.id ? "#2563eb" : "none"
                            }
                            strokeWidth={1.5 / scale}
                            strokeDasharray={`${5 / scale} ${3 / scale}`}
                          />
                        )}
                        <AnnotationShape annotation={annotation} />
                        <circle
                          cx={labelX}
                          cy={labelY}
                          r={r}
                          fill="#facc15"
                          stroke="#ffffff"
                          strokeWidth={1}
                        />
                        <text
                          x={labelX}
                          y={labelY}
                          fill="#422006"
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontFamily="sans-serif"
                          fontSize={r}
                          fontWeight="600"
                        >
                          {index + 1}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </div>
          <div className={styles.hint}>
            {tool === "select"
              ? "点击标注选中，可拖动或用方向键微调位置；Delete 删除。"
              : tool === "text"
              ? "点击图片放置文字，再在右侧编辑内容。"
              : "在图片上拖动添加标注，然后在右侧填写修改要求。"}
          </div>
        </div>
        <aside className={styles.sidebar} aria-label="图片修改要求">
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              <strong>参考图合成</strong>
              <span>
                {references.length} / {MAX_CANVAS_REFERENCES}
              </span>
            </div>
            <p className={styles.help}>
              在主图上框选人物或物品，再为选区指定参考图。
            </p>
            <div className={styles.referenceRow}>
              {image && <img src={image.src} alt="主图" />}
              <div>
                <strong>主图</strong>
                <span>当前画布中的图片</span>
              </div>
            </div>
            {references.map((reference, index) => (
              <div className={styles.referenceRow} key={reference.id}>
                <img src={reference.src} alt={`参考图 ${index + 1}`} />
                <div>
                  <strong>参考图 {index + 1}</strong>
                  <span title={reference.name}>{reference.name}</span>
                </div>
                <button
                  type="button"
                  aria-label={`移除参考图 ${index + 1}`}
                  disabled={busy}
                  onClick={() => {
                    setReferences(
                      references.filter((item) => item.id !== reference.id),
                    );
                    const detach = (items: CanvasAnnotation[]) =>
                      items.map((item) =>
                        item.referenceId === reference.id
                          ? { ...item, referenceId: undefined }
                          : item,
                      );
                    setAnnotations(detach);
                    setPast((history) => history.map(detach));
                    setFuture((history) => history.map(detach));
                    setNotice("已移除参考图及其选区关联。");
                  }}
                >
                  移除
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.addRegion}
              disabled={!ready || references.length >= MAX_CANVAS_REFERENCES}
              onClick={() => setPickingReference((value) => !value)}
            >
              从作品库选择
            </button>
            <button
              type="button"
              className={styles.addRegion}
              disabled={!ready || references.length >= MAX_CANVAS_REFERENCES}
              onClick={() => referenceInput.current?.click()}
            >
              上传本地参考图
            </button>
            <input
              ref={referenceInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              aria-label="上传本地参考图"
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                void addReferences(
                  files.map((file) => ({ blob: file, name: file.name })),
                ).catch((failure) => {
                  if (mounted.current)
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "参考图读取失败，请重试",
                    );
                });
              }}
            />
            {pickingReference && (
              <CanvasReferencePicker
                onClose={() => setPickingReference(false)}
                onSelect={async (blob, name) => {
                  await addReferences([{ blob, name }]);
                  if (mounted.current) setPickingReference(false);
                }}
              />
            )}
          </div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              <strong>标注与选区</strong>
              <span>{annotations.length} / 40</span>
            </div>
            <p className={styles.help}>
              框选和圈选默认修改原图文字；替换人物或物品时切换“修改目标”。新增文字与画笔可直接保存。
            </p>
            <div className={styles.appearance}>
              <label>
                颜色
                <input
                  type="color"
                  value={selected?.color ?? color}
                  disabled={!ready}
                  onChange={(event) => {
                    setColor(event.target.value);
                    updateSelected({ color: event.target.value });
                  }}
                />
              </label>
              <label>
                线宽
                <select
                  aria-label="线宽"
                  value={
                    selected
                      ? selected.strokeWidth /
                        Math.max(1, Math.min(width, height) / 800)
                      : strokeWidth
                  }
                  disabled={!ready}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setStrokeWidth(value);
                    updateSelected({
                      strokeWidth:
                        value * Math.max(1, Math.min(width, height) / 800),
                    });
                  }}
                >
                  {[2, 4, 8, 12].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              className={styles.addRegion}
              disabled={!ready || annotations.length >= 40}
              onClick={() => {
                const before = gesture.current?.before ?? annotations;
                cancelGesture();
                const annotation = createAnnotation(
                  { x: width * 0.3, y: height * 0.3 },
                  "rect",
                );
                annotation.points[1] = { x: width * 0.7, y: height * 0.7 };
                commit([...before, annotation], before);
                setSelectedId(annotation.id);
                setTool("select");
              }}
            >
              添加中心选区
            </button>
            <div className={styles.annotationList} aria-label="标注列表">
              {annotations.map((annotation, index) => (
                <button
                  type="button"
                  key={annotation.id}
                  disabled={busy}
                  aria-pressed={selectedId === annotation.id}
                  onClick={() => {
                    cancelGesture();
                    setSelectedId(annotation.id);
                    setTool("select");
                  }}
                >
                  <span className={styles.number}>{index + 1}</span>
                  <span>
                    {annotation.target === "text" && annotation.replacement
                      ? `替换为：${annotation.replacement}`
                      : annotation.instruction ||
                        (annotation.kind === "text"
                          ? annotation.text
                          : "待填写修改要求")}
                  </span>
                </button>
              ))}
            </div>
          </div>
          {selected && (
            <div className={styles.section} ref={annotationDetailsRef}>
              <div className={styles.sectionTitle}>
                <strong>标注 {annotations.indexOf(selected) + 1}</strong>
                <button
                  type="button"
                  className={styles.delete}
                  disabled={busy}
                  onClick={removeSelected}
                >
                  删除标注
                </button>
              </div>
              {selected.kind === "text" && (
                <>
                  <label className={styles.field}>
                    叠加文字
                    <textarea
                      data-overlay-text
                      value={selected.text}
                      maxLength={500}
                      rows={2}
                      disabled={busy}
                      onChange={(event) =>
                        updateSelected({ text: event.target.value })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    字号
                    <input
                      type="number"
                      min={8}
                      max={400}
                      value={selected.fontSize}
                      disabled={busy}
                      onChange={(event) =>
                        updateSelected({
                          fontSize: Math.max(
                            8,
                            Math.min(400, Number(event.target.value) || 8),
                          ),
                        })
                      }
                    />
                  </label>
                </>
              )}
              <label className={styles.field}>
                修改目标
                <select
                  aria-label="修改目标"
                  value={selected.target}
                  disabled={busy}
                  onChange={(event) =>
                    updateSelected({
                      target: event.target.value as "object" | "text",
                    })
                  }
                >
                  <option value="object">物品 / 画面</option>
                  <option value="text">原图文字</option>
                </select>
              </label>
              {selected.target === "text" && (
                <>
                  <label className={styles.field}>
                    原图文字（可选）
                    <textarea
                      value={selected.originalText ?? ""}
                      maxLength={1000}
                      rows={2}
                      disabled={busy}
                      onChange={(event) =>
                        updateSelected({ originalText: event.target.value })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    替换成的文字
                    <textarea
                      value={selected.replacement}
                      maxLength={1000}
                      rows={2}
                      disabled={busy}
                      placeholder="例如：侏罗纪探险"
                      onChange={(event) =>
                        updateSelected({ replacement: event.target.value })
                      }
                    />
                  </label>
                </>
              )}
              {selected.target === "object" && (
                <label className={styles.field}>
                  替换参考图
                  <select
                    value={selected.referenceId ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      updateSelected({
                        referenceId: event.target.value || undefined,
                      })
                    }
                  >
                    <option value="">不使用参考图</option>
                    {references.map((reference, index) => (
                      <option key={reference.id} value={reference.id}>
                        参考图 {index + 1} · {reference.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className={styles.field}>
                {selected.target === "text" ? "补充要求" : "这个位置如何修改"}
                <textarea
                  value={selected.instruction}
                  maxLength={1000}
                  rows={3}
                  disabled={busy}
                  placeholder={
                    selected.target === "text"
                      ? "例如：保留原来的字体、颜色和排版"
                      : "例如：把恐龙替换为三角龙，保留背景"
                  }
                  onChange={(event) =>
                    updateSelected({ instruction: event.target.value })
                  }
                />
              </label>
            </div>
          )}
          <div className={styles.section}>
            <label className={styles.field}>
              整体修改要求
              <textarea
                aria-label="整体修改要求"
                value={prompt}
                maxLength={4000}
                rows={3}
                disabled={busy}
                placeholder="例如：仅修改标注区域，其余内容保持原样"
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
            {!onSubmit && (
              <p className={styles.help}>
                可在这里保存标注图片。从对话中的图片进入，可直接交给 AI 修改。
              </p>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className={styles.help} role="status">
                {notice}
              </p>
            )}
            {onSubmit && (
              <>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={!ready}
                  onClick={() => void runExport(true)}
                >
                  {busy ? "正在准备图片…" : "交给 AI 修改"}
                </button>
                <p className={styles.help}>
                  使用当前对话的改图模型，按现有规则计费。原图与标注会一同提交，生成结果返回对话。
                </p>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
