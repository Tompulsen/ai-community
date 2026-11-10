// Adapted from QXChat / NextChat (MIT); see THIRD_PARTY_NOTICES.md.
import { fetchImageBlob } from "./image-asset";

export const MAX_CANVAS_REFERENCES = 14;
export type CanvasReference = { id: string; name: string; src: string };

export type CanvasPoint = { x: number; y: number };

export type CanvasAnnotation = {
  id: string;
  kind: "rect" | "ellipse" | "arrow" | "pen" | "text";
  points: CanvasPoint[];
  color: string;
  strokeWidth: number;
  text: string;
  instruction: string;
  target: "object" | "text";
  replacement: string;
  originalText?: string;
  referenceId?: string;
  fontSize: number;
};

export type CanvasEditDraft = { prompt: string; images: string[] };

const MAX_CANVAS_DIMENSION = 16384;
const MAX_CANVAS_PIXELS = 40_000_000;
const IMAGE_LOAD_TIMEOUT_MS = 30_000;

function assertSize(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("图片尺寸无效，请重新打开图片");
  }
}

function assertPoints(points: CanvasPoint[]) {
  if (
    !points.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    )
  ) {
    throw new Error("标注坐标无效，请删除该标注后重试");
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeCanvasRect(a: CanvasPoint, b: CanvasPoint) {
  assertPoints([a, b]);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function moveCanvasAnnotation(
  annotation: CanvasAnnotation,
  dx: number,
  dy: number,
  width: number,
  height: number,
): CanvasAnnotation {
  assertSize(width, height);
  assertPoints(annotation.points);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new Error("移动距离无效");
  }
  if (!annotation.points.length) return { ...annotation, points: [] };
  const bounds = annotationBounds(annotation);
  if (bounds.width > width || bounds.height > height) {
    throw new Error("标注范围超过图片，请重新绘制标注");
  }
  const offsetX = clamp(dx, -bounds.x, width - bounds.x - bounds.width);
  const offsetY = clamp(dy, -bounds.y, height - bounds.y - bounds.height);
  return {
    ...annotation,
    points: annotation.points.map((point) => ({
      x: point.x + offsetX,
      y: point.y + offsetY,
    })),
  };
}

function annotationBounds(annotation: CanvasAnnotation) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of annotation.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function buildCanvasEditPrompt(
  annotations: CanvasAnnotation[],
  width: number,
  height: number,
  overallPrompt: string,
  references: CanvasReference[] = [],
): string {
  assertSize(width, height);
  if (references.length > MAX_CANVAS_REFERENCES) {
    throw new Error(`最多添加 ${MAX_CANVAS_REFERENCES} 张参考图`);
  }
  const referenceNumber = (id?: string) => {
    const index = references.findIndex((reference) => reference.id === id);
    return index < 0 ? undefined : index + (annotations.length ? 3 : 2);
  };
  const hasInstructions = annotations.some(
    (annotation) =>
      annotation.points.length > 0 &&
      (annotation.instruction.trim() ||
        (annotation.target === "text" && annotation.replacement.trim()) ||
        (annotation.target === "object" &&
          referenceNumber(annotation.referenceId))),
  );
  if (!overallPrompt.trim() && !hasInstructions) {
    throw new Error("请填写整体修改要求，或为标注填写修改要求 / 替换文字");
  }
  const percent = (value: number, size: number) =>
    `${Number(((clamp(value, 0, size) / size) * 100).toFixed(1))}%`;
  const position = (point: CanvasPoint) =>
    `横向 ${percent(point.x, width)}，纵向 ${percent(point.y, height)}`;
  const lines = [
    "请根据图片画布中的修改要求编辑图片。",
    ...(annotations.length
      ? [
          `图 1 是干净原图（${width} × ${height} 像素），图 2 是叠加标注和编号的定位参考图。`,
          "以图 1 为编辑底图；图 2 的编号、箭头、框线、涂画和叠加文字只用于定位与说明，不属于成品内容。",
        ]
      : [
          `图 1 是干净原图（${width} × ${height} 像素），请以此图为编辑底图执行整体修改要求。`,
        ]),
    "以下位置均以原图左上角为原点，横向从左到右、纵向从上到下，以原图宽高百分比表示。",
    overallPrompt.trim()
      ? `整体修改要求：${overallPrompt.trim()}`
      : "整体修改要求：仅执行下列明确指定的局部修改。",
    "",
  ];
  if (references.length) {
    lines.push("参考图仅用于指定人物或物品的外观，不作为编辑底图：");
    references.forEach((reference) => {
      lines.push(
        `图 ${referenceNumber(reference.id)}：参考图 ${JSON.stringify(
          reference.name,
        )}。`,
      );
    });
  }
  annotations.forEach((annotation, index) => {
    assertPoints(annotation.points);
    if (!annotation.points.length) return;
    const bounds = annotationBounds(annotation);
    const first = annotation.points[0];
    const last = annotation.points[annotation.points.length - 1];
    const geometry =
      annotation.kind === "arrow"
        ? `箭头从（${position(first)}）指向（${position(
            last,
          )}），目标是箭头尖端附近的内容`
        : `范围左上角（${position(bounds)}），宽 ${percent(
            bounds.width,
            width,
          )}、高 ${percent(bounds.height, height)}`;
    lines.push(
      `标注 ${index + 1}：${
        annotation.target === "text" ? "图片中的文字" : "物品 / 画面内容"
      }；${geometry}。`,
    );
    if (annotation.target === "text" && annotation.originalText?.trim()) {
      lines.push(
        `需要修改的原文：${JSON.stringify(annotation.originalText)}。`,
      );
    }
    const reference =
      annotation.target === "object" && referenceNumber(annotation.referenceId);
    if (reference) {
      lines.push(
        `将该选区内的目标替换为图 ${reference} 中的人物或物品，匹配主图的姿态、透视、光线与比例，保留选区以外内容。`,
      );
    } else if (annotation.referenceId && annotation.target === "object") {
      throw new Error(`标注 ${index + 1} 的参考图已移除，请重新选择参考图`);
    }
    if (annotation.target === "text" && annotation.replacement.trim()) {
      lines.push(
        `将该区域的原图文字精确替换为 ${JSON.stringify(
          annotation.replacement,
        )}；完整保留指定字符、标点和换行，不翻译、不增删文字，并尽量匹配原有字体、排版及背景。`,
      );
    }
    if (annotation.instruction.trim()) {
      lines.push(`修改要求：${annotation.instruction.trim()}`);
    }
    if (annotation.kind === "text" && annotation.text.trim()) {
      lines.push(
        `画布说明文字：${JSON.stringify(
          annotation.text,
        )}（仅为定位参考，不自动作为替换文字或修改指令）。`,
      );
    }
    if (
      !annotation.instruction.trim() &&
      !(annotation.target === "text" && annotation.replacement.trim()) &&
      !reference
    ) {
      lines.push(
        "此标注没有单独修改指令，仅辅助理解整体要求；不得仅凭标记猜测、删除或改动画面内容。",
      );
    }
  });
  lines.push(
    "",
    "只输出一张修改后的干净图片。保持原图构图、宽高比和未指定修改的区域；不要输出定位编号、标注箭头、框线、涂画、说明文字、选框或工具栏。仅执行明确的修改要求。",
  );
  const prompt = lines.join("\n");
  if (prompt.length > 30_000) {
    throw new Error(
      "修改说明过长，请缩短整体要求、标注说明或替换文字后重试（完整说明须不超过 30000 字符）",
    );
  }
  return prompt;
}

/** Decode a private object URL so canvas export never borrows a tainted preview. */
export function loadCanvasImage(
  src: string,
  signal?: AbortSignal,
): Promise<{ image: HTMLImageElement; dispose: () => void }> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let objectUrl: string | undefined;
    let image: HTMLImageElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dispose = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = undefined;
      }
    };
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (image) {
        image.onload = null;
        image.onerror = null;
      }
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      controller.abort();
      cleanup();
      dispose();
      reject(
        error instanceof Error ? error : new Error("图片加载失败，请稍后重试"),
      );
    };
    const abort = () => fail(new DOMException("已取消图片加载", "AbortError"));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(
      () => fail(new Error("图片加载超时，请检查网络后重新打开")),
      IMAGE_LOAD_TIMEOUT_MS,
    );

    void (async () => {
      if (!src.trim()) throw new Error("图片地址为空");
      const url = new URL(src, window.location.href);
      if (
        !["http:", "https:", "blob:", "data:"].includes(url.protocol) ||
        (url.protocol === "data:" && !/^data:image\//i.test(src))
      ) {
        throw new Error("不支持此图片地址，请使用图片文件或 HTTP 图片链接");
      }
      // Reuse the account-scoped original image cache and same-origin proxy.
      const blob = await fetchImageBlob(src);
      if (settled) return;
      if (!blob.size) throw new Error("图片内容为空，请重新上传或生成");
      if (
        blob.type &&
        !blob.type.startsWith("image/") &&
        blob.type !== "application/octet-stream"
      ) {
        throw new Error("返回的内容不是有效图片");
      }
      objectUrl = URL.createObjectURL(blob);
      image = new Image();
      image.onload = () => {
        if (settled || !image) return;
        if (!image.naturalWidth || !image.naturalHeight) {
          fail(new Error("无法读取图片尺寸，请重新上传图片"));
          return;
        }
        settled = true;
        cleanup();
        resolve({ image, dispose });
      };
      image.onerror = () =>
        fail(new Error("图片无法解码，请使用 PNG、JPEG 或 WebP 图片"));
      image.src = objectUrl;
    })().catch(fail);
  });
}

export async function renderCanvasImage(
  image: HTMLImageElement,
  annotations: CanvasAnnotation[],
  { includeLabels = false }: { includeLabels?: boolean } = {},
): Promise<Blob> {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  assertSize(width, height);
  if (
    width > MAX_CANVAS_DIMENSION ||
    height > MAX_CANVAS_DIMENSION ||
    width * height > MAX_CANVAS_PIXELS
  ) {
    throw new Error(
      "图片过大，暂时无法按原尺寸导出：长边须不超过 16384 像素，总像素不超过 4000 万。请先缩小图片再编辑。",
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法创建图片画布");
    context.drawImage(image, 0, 0, width, height);
    for (const [index, annotation] of annotations.entries()) {
      assertPoints(annotation.points);
      if (!annotation.points.length) continue;
      if (
        !Number.isFinite(annotation.strokeWidth) ||
        annotation.strokeWidth <= 0 ||
        !Number.isFinite(annotation.fontSize) ||
        annotation.fontSize <= 0
      ) {
        throw new Error("标注线宽或字号无效，请重新设置");
      }
      const first = annotation.points[0];
      const last = annotation.points[annotation.points.length - 1];
      context.save();
      context.strokeStyle = annotation.color;
      context.fillStyle = annotation.color;
      context.lineWidth = annotation.strokeWidth;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      if (annotation.kind === "text") {
        context.font = `${annotation.fontSize}px sans-serif`;
        context.textBaseline = "hanging";
        annotation.text.split(/\r?\n/).forEach((line, lineIndex) => {
          context.fillText(
            line,
            first.x,
            first.y + lineIndex * annotation.fontSize * 1.3,
          );
        });
      } else if (annotation.kind === "rect" || annotation.kind === "ellipse") {
        const rect = normalizeCanvasRect(first, last);
        if (annotation.kind === "rect") {
          context.rect(rect.x, rect.y, rect.width, rect.height);
        } else {
          context.ellipse(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
            rect.width / 2,
            rect.height / 2,
            0,
            0,
            Math.PI * 2,
          );
        }
        context.stroke();
      } else {
        context.moveTo(first.x, first.y);
        if (annotation.kind === "pen") {
          annotation.points
            .slice(1)
            .forEach((point) => context.lineTo(point.x, point.y));
          if (annotation.points.length === 1)
            context.lineTo(first.x + 0.01, first.y);
        } else {
          context.lineTo(last.x, last.y);
          const angle = Math.atan2(last.y - first.y, last.x - first.x);
          const length = Math.max(annotation.strokeWidth * 4, 12);
          for (const offset of [-Math.PI / 6, Math.PI / 6]) {
            context.moveTo(last.x, last.y);
            context.lineTo(
              last.x - length * Math.cos(angle + offset),
              last.y - length * Math.sin(angle + offset),
            );
          }
        }
        context.stroke();
      }
      context.restore();
      if (includeLabels) {
        const radius = Math.max(12, Math.min(width, height) * 0.018);
        const labelX =
          width < radius * 2 + 4
            ? width / 2
            : clamp(first.x, radius + 2, width - radius - 2);
        const labelY =
          height < radius * 2 + 4
            ? height / 2
            : clamp(first.y, radius + 2, height - radius - 2);
        context.save();
        context.beginPath();
        context.arc(labelX, labelY, radius, 0, Math.PI * 2);
        context.fillStyle = "#facc15";
        context.fill();
        context.strokeStyle = "#ffffff";
        context.lineWidth = 1;
        context.stroke();
        context.fillStyle = "#422006";
        context.font = `600 ${radius}px sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(index + 1), labelX, labelY);
        context.restore();
      }
    }
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else
          reject(
            new Error(
              "图片导出失败，可能是浏览器内存不足，请关闭其他标签页后重试",
            ),
          );
      }, "image/png");
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") {
      throw new Error("图片源限制了画布导出，请下载原图后重新上传再编辑");
    }
    throw error;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Convert only at submission: the generation API accepts base64 image data. */
export function canvasBlobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("图片内容读取失败，请重试"));
    };
    reader.onerror = () => reject(new Error("图片内容读取失败，请重试"));
    reader.onabort = () => reject(new Error("图片读取已取消"));
    reader.readAsDataURL(blob);
  });
}
