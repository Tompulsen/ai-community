// Adapted from QXChat / NextChat (MIT).
import { jest } from "@jest/globals";
import type { CanvasAnnotation } from "@/app/utils/image-canvas";
jest.unstable_mockModule("@/app/utils/image-asset", () => ({
  fetchImageBlob: jest.fn(),
}));
const {
  normalizeCanvasRect,
  moveCanvasAnnotation,
  buildCanvasEditPrompt,
  renderCanvasImage,
} = await import("@/app/utils/image-canvas");
function annotation(
  overrides: Partial<CanvasAnnotation> = {},
): CanvasAnnotation {
  return {
    id: "region-a",
    kind: "rect",
    points: [
      { x: 100, y: 100 },
      { x: 300, y: 200 },
    ],
    color: "#ef4444",
    strokeWidth: 4,
    text: "",
    instruction: "",
    target: "object",
    replacement: "",
    fontSize: 24,
    ...overrides,
  };
}

describe("canvas image coordinates and editing brief", () => {
  it("numbers references after the clean original and optional annotation guide", () => {
    const refs = [
      { id: "person", name: "人物", src: "data:image/png;base64,YQ==" },
      { id: "object", name: "物品", src: "data:image/png;base64,Yg==" },
    ];
    const region = annotation({ referenceId: "object", target: "object" });
    const prompt = buildCanvasEditPrompt([region], 1000, 500, "", refs);
    expect(prompt).toContain("图 4 中的人物或物品");
    expect(prompt).toContain("图 3：参考图");
    expect(
      buildCanvasEditPrompt([], 1000, 500, "参考图2的光线", refs),
    ).toContain("图 2：参考图");
    const afterRemoval = buildCanvasEditPrompt(
      [region],
      1000,
      500,
      "",
      refs.slice(1),
    );
    expect(afterRemoval).toContain("图 3 中的人物或物品");
    expect(afterRemoval).not.toContain("图 4");
  });

  it("rejects removed reference links and over-limit references", () => {
    expect(() =>
      buildCanvasEditPrompt(
        [annotation({ referenceId: "removed" })],
        1000,
        500,
        "替换目标",
      ),
    ).toThrow("参考图已移除");
    expect(() =>
      buildCanvasEditPrompt(
        [],
        1000,
        500,
        "调整光线",
        Array.from({ length: 15 }, (_, index) => ({
          id: String(index),
          name: "参考",
          src: "image",
        })),
      ),
    ).toThrow("最多添加 14 张参考图");
    const text = buildCanvasEditPrompt(
      [
        annotation({
          target: "text",
          originalText: "旧标题",
          replacement: "新标题",
        }),
      ],
      1000,
      500,
      "",
    );
    expect(text).toContain('需要修改的原文："旧标题"');
    expect(text).toContain('替换为 "新标题"');
  });
  it("uses only the original image for a global edit without annotations", () => {
    const prompt = buildCanvasEditPrompt([], 1000, 500, "调整为暖色调");
    expect(prompt).toContain("图 1 是干净原图");
    expect(prompt).toContain("调整为暖色调");
    expect(prompt).not.toContain("图 2");
  });

  it("rejects oversized assembled prompts instead of letting the server truncate preservation rules", () => {
    expect(() =>
      buildCanvasEditPrompt([], 1000, 500, "亮".repeat(30_000)),
    ).toThrow("修改说明过长");
    expect(() =>
      buildCanvasEditPrompt(
        [
          annotation({ target: "text", replacement: "字".repeat(16_000) }),
          annotation({ instruction: "改".repeat(16_000) }),
        ],
        1000,
        500,
        "",
      ),
    ).toThrow("完整说明须不超过 30000 字符");
    expect(buildCanvasEditPrompt([], 1000, 500, "亮".repeat(29_000))).toContain(
      "仅执行明确的修改要求。",
    );
  });

  it("does not accept instructions from annotations with no drawable location", () => {
    expect(() =>
      buildCanvasEditPrompt(
        [annotation({ points: [], instruction: "删除" })],
        1000,
        500,
        "",
      ),
    ).toThrow("请填写整体修改要求");
  });

  it("normalizes reverse-direction drag without losing image coordinates", () => {
    expect(normalizeCanvasRect({ x: 500, y: 210 }, { x: 60, y: 30 })).toEqual({
      x: 60,
      y: 30,
      width: 440,
      height: 180,
    });
  });

  it("moves the whole annotation to the edge without deforming it or mutating history", () => {
    const source = annotation();
    const result = moveCanvasAnnotation(source, 900, -300, 1000, 500);
    expect(result.points).toEqual([
      { x: 800, y: 0 },
      { x: 1000, y: 100 },
    ]);
    expect(source.points).toEqual([
      { x: 100, y: 100 },
      { x: 300, y: 200 },
    ]);
  });

  it("limits an entire pen path, including intermediate extrema", () => {
    const source = annotation({
      kind: "pen",
      points: [
        { x: 50, y: 50 },
        { x: 5, y: 400 },
        { x: 70, y: 20 },
      ],
    });
    expect(moveCanvasAnnotation(source, -100, 200, 1000, 500).points).toEqual([
      { x: 45, y: 150 },
      { x: 0, y: 500 },
      { x: 65, y: 120 },
    ]);
  });

  it("rejects invalid coordinates and impossible bounds instead of corrupting shapes", () => {
    expect(() => normalizeCanvasRect({ x: NaN, y: 1 }, { x: 1, y: 2 })).toThrow(
      "坐标无效",
    );
    expect(() =>
      moveCanvasAnnotation(annotation(), Infinity, 0, 500, 500),
    ).toThrow("移动距离无效");
    expect(() => moveCanvasAnnotation(annotation(), 0, 0, 50, 50)).toThrow(
      "标注范围超过图片",
    );
  });

  it("describes numbered regions, precise replacement and the two reference roles", () => {
    const prompt = buildCanvasEditPrompt(
      [
        annotation({
          target: "text",
          replacement: "恐龙！\n侏罗纪",
          instruction: "保持金色标题字体",
        }),
        annotation({
          kind: "arrow",
          points: [
            { x: 100, y: 100 },
            { x: 750, y: 250 },
          ],
          instruction: "将恐龙改为三角龙",
        }),
      ],
      1000,
      500,
      "保留整体海报风格",
    );
    expect(prompt).toContain("图 1 是干净原图");
    expect(prompt).toContain("图 2 是叠加标注和编号的定位参考图");
    expect(prompt).toContain("标注 1：图片中的文字");
    expect(prompt).toContain('精确替换为 "恐龙！\\n侏罗纪"');
    expect(prompt).toContain("保持金色标题字体");
    expect(prompt).toContain(
      "箭头从（横向 10%，纵向 20%）指向（横向 75%，纵向 50%）",
    );
    expect(prompt).toContain("未指定修改的区域");
    expect(prompt).toContain("不要输出定位编号");
  });

  it("does not turn decoration or blank regions into implicit edit requests", () => {
    const source = [annotation({ kind: "text", text: "这里" })];
    expect(() => buildCanvasEditPrompt(source, 1000, 500, "  ")).toThrow(
      "请填写整体修改要求",
    );
    const prompt = buildCanvasEditPrompt(source, 1000, 500, "提升背景亮度");
    expect(prompt).toContain("此标注没有单独修改指令");
    expect(prompt).toContain("不自动作为替换文字或修改指令");
    expect(prompt).toContain("不得仅凭标记猜测");
  });

  it("allows a text replacement alone and rejects invalid image dimensions", () => {
    expect(
      buildCanvasEditPrompt(
        [annotation({ target: "text", replacement: "新标题" })],
        1000,
        500,
        "",
      ),
    ).toContain("新标题");
    expect(() => buildCanvasEditPrompt([], 0, 500, "修改")).toThrow(
      "图片尺寸无效",
    );
  });
});

describe("canvas PNG export", () => {
  const image = { naturalWidth: 1000, naturalHeight: 500 } as HTMLImageElement;
  let context: Record<string, unknown>;
  let encodedDimensions: number[];
  let encodeFails: boolean;
  const png = new Blob(["result"], { type: "image/png" });

  beforeEach(() => {
    context = Object.fromEntries(
      [
        "drawImage",
        "save",
        "restore",
        "beginPath",
        "rect",
        "ellipse",
        "stroke",
        "moveTo",
        "lineTo",
        "fillText",
        "arc",
        "fill",
      ].map((name) => [name, jest.fn()]),
    );
    encodedDimensions = [];
    encodeFails = false;
    jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => context as unknown as CanvasRenderingContext2D);
    jest
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation(function (
        this: HTMLCanvasElement,
        callback,
        mimeType,
      ) {
        encodedDimensions = [this.width, this.height];
        expect(mimeType).toBe("image/png");
        callback(encodeFails ? null : png);
      });
  });

  afterEach(() => jest.restoreAllMocks());

  it("preserves original dimensions and draws multiline text without AI labels in downloads", async () => {
    const output = await renderCanvasImage(image, [
      annotation({ kind: "text", text: "第一行\n第二行", fontSize: 20 }),
    ]);
    expect(output).toBe(png);
    expect(encodedDimensions).toEqual([1000, 500]);
    expect(context.drawImage).toHaveBeenCalledWith(image, 0, 0, 1000, 500);
    expect(context.fillText).toHaveBeenCalledTimes(2);
    expect(context.fillText).toHaveBeenCalledWith("第一行", 100, 100);
    expect(context.fillText).toHaveBeenCalledWith("第二行", 100, 126);
    expect(context.arc).not.toHaveBeenCalled();
  });

  it("adds numbered markers only to the AI reference image", async () => {
    await renderCanvasImage(
      image,
      [
        annotation({
          points: [
            { x: 0, y: 0 },
            { x: 80, y: 40 },
          ],
        }),
      ],
      { includeLabels: true },
    );
    expect(context.fillText).toHaveBeenCalledWith("1", 14, 14);
    expect(context.arc).toHaveBeenCalledWith(14, 14, 12, 0, Math.PI * 2);
  });

  it("rejects huge images before allocating a canvas instead of silently reducing resolution", async () => {
    const create = jest.spyOn(document, "createElement");
    await expect(
      renderCanvasImage(
        { naturalWidth: 8000, naturalHeight: 8000 } as HTMLImageElement,
        [],
      ),
    ).rejects.toThrow("总像素不超过 4000 万");
    expect(create).not.toHaveBeenCalled();
  });

  it("surfaces encoder failure and cross-origin export restrictions", async () => {
    encodeFails = true;
    await expect(renderCanvasImage(image, [])).rejects.toThrow("图片导出失败");
    (context.drawImage as ReturnType<typeof jest.fn>).mockImplementation(() => {
      throw new DOMException("tainted", "SecurityError");
    });
    await expect(renderCanvasImage(image, [])).rejects.toThrow(
      "图片源限制了画布导出",
    );
  });
});
