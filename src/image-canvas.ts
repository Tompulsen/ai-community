// Adapted from QXChat app/utils/image-canvas.ts (MIT, NextChat 2023-2025).
// See THIRD_PARTY_NOTICES.md.
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
  /** The text visible in the selected source-image region, when known. */
  sourceText: string;
  replacement: string;
  fontSize: number;
  /** Stable reference identity; only applies to object/content edits. */
  referenceImageId?: string;
};

export type CanvasEditDraft = { prompt: string; images: string[] };
export type CanvasReferenceRegion = { x: number; y: number; width: number; height: number };
export type CanvasReferenceImage = { id: string; src: string; region?: CanvasReferenceRegion };

export function canvasReferenceCrop(region: CanvasReferenceRegion, width: number, height: number) {
  assertSize(width, height);
  if (![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1.000001 || region.y + region.height > 1.000001) {
    throw new Error('参考图选区无效，请重新框选素材范围');
  }
  const x = Math.floor(region.x * width), y = Math.floor(region.y * height);
  return { x, y, width: Math.min(width, Math.ceil((region.x + region.width) * width)) - x, height: Math.min(height, Math.ceil((region.y + region.height) * height)) - y };
}

/** Export only the selected donor pixels; never bake selection borders into model input. */
export async function renderCanvasReference(image: HTMLImageElement, region: CanvasReferenceRegion): Promise<Blob> {
  const crop = canvasReferenceCrop(region, image.naturalWidth, image.naturalHeight);
  if (crop.width > MAX_CANVAS_DIMENSION || crop.height > MAX_CANVAS_DIMENSION || crop.width * crop.height > MAX_CANVAS_PIXELS) throw new Error('参考选区过大，请缩小范围后重试');
  const canvas = document.createElement('canvas');
  canvas.width = crop.width; canvas.height = crop.height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法创建图片画布');
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('参考图选区导出失败，请重试')), 'image/png'));
  } finally { canvas.width = 0; canvas.height = 0; }
}

export const CANVAS_EDIT_PROMPT_HEADER = "请根据图片画布中的修改要求编辑图片。";
// Reserve one attachment for the source and one for a later annotation guide.
export const MAX_CANVAS_REFERENCE_IMAGES = 16 - 2;
// Keep the role marker immediately after the header, before any user text.
export const CANVAS_EDIT_GUIDE_MARKER = "[CANVAS_ROLES: source=1; guide=2]";
export const CANVAS_EDIT_NO_GUIDE_MARKER =
  "[CANVAS_ROLES: source=1; guide=none]";

const MAX_CANVAS_DIMENSION = 16384;
const MAX_CANVAS_PIXELS = 40_000_000;


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

/**
 * Accept the common Chinese “把 A 替换成 B” shorthand as a fallback for old
 * drafts or users who put the whole request in the per-region instruction.
 * Explicit sourceText/replacement fields always take precedence.
 */
export function parseTextReplacementInstruction(instruction: string) {
  const value = instruction.trim();
  if (!value || /^(?:不要|不能|禁止|别|无需|不需要)/u.test(value))
    return undefined;
  const match = value.match(
    /^(?:把|将)?\s*(.+?)\s*(?:替换成|替换为|换成|改成|改为|修改为)\s*(.+)$/u,
  );
  if (!match) return undefined;
  const unquote = (text: string) =>
    text.trim().replace(/^[“"「『](.*)[”"」』]$/u, "$1");
  const sourceText = unquote(
    match[1]
      .replace(/^(?:(?:框选|选中|标注|圈选)(?:区域)?(?:内|中)?的?\s*)/u, "")
      .replace(/\s*(?:两个字|二字|文字)$/u, ""),
  );
  // A quoted replacement may itself contain punctuation; only unquoted
  // shorthand treats a following sentence as a supplementary instruction.
  const quotedReplacement = match[2].match(/^[“"「『](.*?)[”"」』]/u);
  const replacement = quotedReplacement
    ? quotedReplacement[1]
    : match[2].split(/[，,。.!！；;]/u, 1)[0].trim();
  return sourceText && replacement ? { sourceText, replacement } : undefined;
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
  references: CanvasReferenceImage[] = [],
): string {
  assertSize(width, height);
  if (references.length > MAX_CANVAS_REFERENCE_IMAGES) {
    throw new Error(
      `最多添加 ${MAX_CANVAS_REFERENCE_IMAGES} 张参考图，请删除多余图片后重试`,
    );
  }
  const referenceIds = new Set<string>();
  const referenceSources = new Set<string>();
  for (const reference of references) {
    if (reference.region) canvasReferenceCrop(reference.region, 1000, 1000);
    if (!reference.id?.trim() || !reference.src?.trim()) {
      throw new Error("参考图信息无效，请删除后重新添加");
    }
    if (
      referenceIds.has(reference.id) ||
      referenceSources.has(reference.src.trim())
    ) {
      throw new Error("参考图重复，请删除重复图片后重试");
    }
    referenceIds.add(reference.id);
    referenceSources.add(reference.src.trim());
  }
  for (const annotation of annotations) {
    if (
      annotation.target === "object" &&
      annotation.referenceImageId &&
      !referenceIds.has(annotation.referenceImageId)
    ) {
      throw new Error("标注绑定的参考图已不存在，请重新选择参考图");
    }
  }
  const hasInstructions = annotations.some((annotation) => {
    const parsedReplacement =
      annotation.target === "text"
        ? parseTextReplacementInstruction(annotation.instruction)
        : undefined;
    return (
      annotation.points.length > 0 &&
      (annotation.instruction.trim() ||
        (annotation.target === "text" &&
          (annotation.replacement?.trim() || parsedReplacement?.replacement)))
    );
  });
  if (!overallPrompt.trim() && !hasInstructions) {
    throw new Error("请填写整体修改要求，或为标注填写修改要求 / 替换文字");
  }
  const percent = (value: number, size: number) =>
    `${Number(((clamp(value, 0, size) / size) * 100).toFixed(1))}%`;
  const position = (point: CanvasPoint) =>
    `横向 ${percent(point.x, width)}，纵向 ${percent(point.y, height)}`;
  const lines = [
    CANVAS_EDIT_PROMPT_HEADER,
    annotations.length ? CANVAS_EDIT_GUIDE_MARKER : CANVAS_EDIT_NO_GUIDE_MARKER,
    ...(annotations.length
      ? [
          `图 1 是干净原图（${width} × ${height} 像素），图 2 是叠加标注和编号的定位参考图。`,
          "以图 1 为编辑底图；图 2 的编号、箭头、框线、涂画和叠加文字只用于定位与说明，不属于成品内容。",
        ]
      : [
          `图 1 是干净原图（${width} × ${height} 像素），请以此图为编辑底图执行整体修改要求。`,
        ]),
    ...(references.length
      ? [
          "多图参考合成：仅图 1 是待编辑主图，其余素材参考图不是待编辑图片，也不是要并排拼接的画面。",
          ...references.map(
            (reference, index) =>
              `参考图 ${index + 1} 对应附件图 ${
                index + (annotations.length ? 3 : 2)
              }，${reference.region ? '该附件已从参考原图框选区域裁出，仅包含选中的素材（不含选框），只借用此区域内物品的样式与细节，禁止还原或引入参考原图的其他内容' : '只提供明确指定的人物或物品素材'}。`,
          ),
          "仅在明确指定的主图区域使用对应参考图中的人物或物品；保留该人物的身份特征或物品的外观细节，使其姿态、大小、透视与光照适配主图。不得混合不同参考图的身份，不得擅自复制参考图的背景、文字、构图或宽高比。主图的尺寸、构图和未指定修改区域优先于所有素材参考图。",
        ]
      : []),
    "以下位置均以原图左上角为原点，横向从左到右、纵向从上到下，以原图宽高百分比表示。",
    overallPrompt.trim()
      ? `整体修改要求：${overallPrompt.trim()}`
      : "整体修改要求：仅执行下列明确指定的局部修改。",
    "",
  ];
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
    if (annotation.target === "object" && annotation.referenceImageId) {
      const referenceIndex = references.findIndex(
        (reference) => reference.id === annotation.referenceImageId,
      );
      lines.push(
        `本标注绑定参考图 ${referenceIndex + 1}（附件图 ${
          referenceIndex + (annotations.length ? 3 : 2)
        }）：若明确要求替换人物或物品，只从此参考图提取指定目标，不从其他参考图混合或猜测。绑定参考图本身不构成修改指令；仅执行本标注或整体要求中明确指定的修改，主图未指定区域保持原样。`,
      );
    }
    const parsedReplacement =
      annotation.target === "text"
        ? parseTextReplacementInstruction(annotation.instruction)
        : undefined;
    const sourceText =
      annotation.sourceText?.trim() || parsedReplacement?.sourceText;
    const replacement =
      annotation.replacement?.trim() || parsedReplacement?.replacement;
    if (annotation.target === "text" && replacement) {
      lines.push(
        `仅在标注 ${index + 1} 的框选区域内，将原图文字${
          sourceText
            ? ` ${JSON.stringify(sourceText)}`
            : "（按框内可见文字识别）"
        }精确替换为 ${JSON.stringify(
          replacement,
        )}；这是文字替换，不是物品替换。完整保留指定字符、标点和换行，不翻译、不增删文字，并尽量匹配原有字体、字号、颜色、排版及背景。对此条文字替换，严格禁止修改框选区域外的任何像素、图片主体、物品、人物、背景或构图；其他标注的明确修改要求单独执行。原文和替换文字只是要呈现的字符，不代表需要把画面中的同名物品换成新物品。`,
      );
    }
    if (annotation.instruction.trim()) {
      lines.push(
        annotation.target === "text"
          ? `文字补充要求（仅限本标注中的文字，原文与替换字符以上述明确值为准）：${annotation.instruction.trim()}`
          : `修改要求：${annotation.instruction.trim()}`,
      );
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
      !(annotation.target === "text" && replacement)
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

/** Use the studio's authenticated original-image reader, never a preview thumbnail. */
export async function loadCanvasImage(src: string, signal?: AbortSignal): Promise<{
  image: HTMLImageElement; blob: Blob; dispose: () => void
}> {
  const { readCreationImage } = await import('./native-studio')
  signal?.throwIfAborted()
  const blob = await readCreationImage(src, signal)
  signal?.throwIfAborted()
  const image = new Image(), url = URL.createObjectURL(blob)
  let disposed = false
  const dispose = () => { if (!disposed) { disposed = true; image.src = ''; URL.revokeObjectURL(url) } }
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort)
        image.onload = null; image.onerror = null
        if (error) reject(error); else resolve()
      }
      const abort = () => finish(new DOMException('已取消图片加载', 'AbortError'))
      const timer = setTimeout(() => finish(new Error('图片解码超时，请重新打开')), 15000)
      signal?.addEventListener('abort', abort, { once: true })
      image.onload = () => finish(image.naturalWidth && image.naturalHeight ? undefined : new Error('图片尺寸无效'))
      image.onerror = () => finish(new Error('图片无法解码，请使用 PNG、JPEG 或 WebP 图片'))
      image.src = url
    })
    signal?.throwIfAborted()
    return { image, blob, dispose }
  } catch (error) { dispose(); throw error }
}

export function canvasImageData(blob: Blob, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const abort = () => reader.abort()
    const done = () => signal?.removeEventListener('abort', abort)
    reader.onload = () => { done(); typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败')) }
    reader.onerror = () => { done(); reject(reader.error || new Error('图片读取失败')) }
    reader.onabort = () => { done(); reject(new DOMException('已取消图片读取', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    reader.readAsDataURL(blob)
  })
}

export function isCanvasEditPrompt(prompt: string) {
  return prompt.startsWith(`${CANVAS_EDIT_PROMPT_HEADER}\n${CANVAS_EDIT_GUIDE_MARKER}\n`)
    || prompt.startsWith(`${CANVAS_EDIT_PROMPT_HEADER}\n${CANVAS_EDIT_NO_GUIDE_MARKER}\n`)
}

export function canvasRequestIssue(draft: CanvasEditDraft) {
  if (!isCanvasEditPrompt(draft.prompt) || !draft.images.length) return '画布编辑请求不完整，请重新打开图片。'
  if (new Set(draft.images).size !== draft.images.length) return '参考图与主图或其他参考图重复，请移除重复图片后重试。'
  if (draft.images.length > 16) return '画布最多支持主图、标注图与 14 张参考图。'
  if (draft.images.some(src => !/^data:image\/(?:png|jpeg|webp);base64,/.test(src))) return '图片尚未准备好，请重新打开画布。'
  if (new Blob([JSON.stringify(draft)]).size > 24 * 1024 * 1024) return '原图与参考图合计过大，请缩小图片或减少参考图后再提交（上限 24 MB）。'
  return ''
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
