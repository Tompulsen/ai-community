// Adapted from QXChat image-canvas.test.ts (MIT, NextChat 2023-2025).
import { describe, it, expect } from 'vitest'
import { normalizeCanvasRect, moveCanvasAnnotation, buildCanvasEditPrompt, parseTextReplacementInstruction, MAX_CANVAS_REFERENCE_IMAGES, CANVAS_EDIT_GUIDE_MARKER, CANVAS_EDIT_NO_GUIDE_MARKER, canvasRequestIssue, isCanvasEditPrompt, canvasReferenceCrop, type CanvasAnnotation, type CanvasReferenceImage } from './image-canvas'

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
    sourceText: "",
    replacement: "",
    fontSize: 24,
    ...overrides,
  };
}

describe("canvas image coordinates and editing brief", () => {
  it('maps donor region to original pixels and rejects invalid selections', () => {
    expect(canvasReferenceCrop({ x: .5, y: .1, width: .4, height: .6 }, 2500, 1000)).toEqual({ x: 1250, y: 100, width: 1000, height: 600 })
    expect(canvasReferenceCrop({ x: .3333, y: .25, width: .2, height: .5 }, 333, 200)).toEqual({ x: 110, y: 50, width: 68, height: 100 })
    for (const region of [{ x: -.1, y: 0, width: .5, height: 1 }, { x: .7, y: 0, width: .5, height: 1 }, { x: 0, y: 0, width: 0, height: 1 }, { x: NaN, y: 0, width: .5, height: 1 }]) expect(() => canvasReferenceCrop(region, 800, 600)).toThrow('选区无效')
  })
  it('identifies selected donor material without renumbering the original image or guide', () => {
    const prompt = buildCanvasEditPrompt([annotation({ referenceImageId: 'crop', instruction: '把主图盒子换成参考素材样式' })], 1200, 800, '', [{ id: 'crop', src: 'local-image://crop', region: { x: .5, y: .1, width: .4, height: .6 } }])
    expect(prompt).toContain(CANVAS_EDIT_GUIDE_MARKER)
    expect(prompt).toContain('参考图 1 对应附件图 3')
    expect(prompt).toContain('已从参考原图框选区域裁出')
    expect(prompt).toContain('本标注绑定参考图 1（附件图 3）')
    expect(() => buildCanvasEditPrompt([], 1200, 800, '替换', [{ id: 'crop', src: 'local-image://crop', region: { x: .8, y: 0, width: 1, height: 1 } }])).toThrow('选区无效')
  })
  const references: CanvasReferenceImage[] = [
    { id: "person", src: "local-image://person" },
    { id: "cat", src: "local-image://cat" },
  ];

  it("maps stable reference identities to attachment numbers after the source and guide", () => {
    const prompt = buildCanvasEditPrompt(
      [
        annotation({
          instruction: "将选中的狗替换为参考图中的小猫",
          referenceImageId: "cat",
        }),
      ],
      1000,
      500,
      "",
      references,
    );
    expect(prompt.split("\n")[1]).toBe(CANVAS_EDIT_GUIDE_MARKER);
    expect(prompt).toContain("参考图 1 对应附件图 3");
    expect(prompt).toContain("参考图 2 对应附件图 4");
    expect(prompt).toContain("本标注绑定参考图 2（附件图 4）");
    expect(prompt).toContain("只从此参考图提取指定目标");
    expect(prompt).toContain("主图的尺寸、构图和未指定修改区域优先");
    expect(prompt).toContain("只输出一张修改后的干净图片");
    expect(prompt).not.toContain("local-image://");
  });

  it("starts donor attachments at image two when there is no annotation guide", () => {
    const prompt = buildCanvasEditPrompt(
      [],
      1000,
      500,
      "将主图中的狗替换为参考图 2 中的小猫",
      references,
    );
    expect(prompt.split("\n")[1]).toBe(CANVAS_EDIT_NO_GUIDE_MARKER);
    expect(prompt).toContain("参考图 1 对应附件图 2");
    expect(prompt).toContain("参考图 2 对应附件图 3");
    expect(prompt).not.toContain("叠加标注和编号的定位参考图");
  });

  it("keeps reference bindings correct after references are reordered", () => {
    const prompt = buildCanvasEditPrompt(
      [annotation({ instruction: "替换为小猫", referenceImageId: "cat" })],
      1000,
      500,
      "",
      [...references].reverse(),
    );
    expect(prompt).toContain("本标注绑定参考图 1（附件图 3）");
  });

  it("rejects missing object references instead of silently choosing another donor", () => {
    expect(() =>
      buildCanvasEditPrompt(
        [
          annotation({
            instruction: "替换为小猫",
            referenceImageId: "removed",
          }),
        ],
        1000,
        500,
        "",
        references,
      ),
    ).toThrow("标注绑定的参考图已不存在");
  });

  it("requires an explicit instruction even when a reference is attached or bound", () => {
    expect(() => buildCanvasEditPrompt([], 1000, 500, "", references)).toThrow(
      "请填写整体修改要求",
    );
    expect(() =>
      buildCanvasEditPrompt(
        [annotation({ referenceImageId: "cat" })],
        1000,
        500,
        "",
        references,
      ),
    ).toThrow("请填写整体修改要求");
    const prompt = buildCanvasEditPrompt(
      [annotation({ referenceImageId: "cat" })],
      1000,
      500,
      "提升背景亮度",
      references,
    );
    expect(prompt).toContain("绑定参考图本身不构成修改指令");
    expect(prompt).toContain("此标注没有单独修改指令");
  });

  it("ignores stale object bindings on text edits and keeps literal replacement rules", () => {
    const prompt = buildCanvasEditPrompt(
      [
        annotation({
          target: "text",
          sourceText: "恐龙",
          replacement: "小猫",
          referenceImageId: "removed",
        }),
      ],
      1000,
      500,
      "",
      references,
    );
    expect(prompt).toContain('原图文字 "恐龙"精确替换为 "小猫"');
    expect(prompt).toContain("这是文字替换，不是物品替换");
    expect(prompt).not.toContain("本标注绑定参考图");
  });

  it("reserves two attachment slots and refuses to silently drop excess references", () => {
    expect(MAX_CANVAS_REFERENCE_IMAGES).toBe(14);
    const many = Array.from({ length: 15 }, (_, index) => ({
      id: `id-${index}`,
      src: `local-image://reference-${index}`,
    }));
    expect(() => buildCanvasEditPrompt([], 1000, 500, "修改", many)).toThrow(
      "最多添加 14 张参考图",
    );
    expect(
      buildCanvasEditPrompt(
        [annotation({ instruction: "替换物品", referenceImageId: "id-13" })],
        1000,
        500,
        "",
        many.slice(0, 14),
      ),
    ).toContain("本标注绑定参考图 14（附件图 16）");
  });

  it.each([
    [{ id: "", src: "a" }],
    [{ id: "a", src: " " }],
    [
      { id: "same", src: "a" },
      { id: "same", src: "b" },
    ],
    [
      { id: "a", src: "same" },
      { id: "b", src: "same" },
    ],
  ])("rejects invalid or duplicate reference data: %j", (...invalid) => {
    expect(() => buildCanvasEditPrompt([], 1000, 500, "修改", invalid)).toThrow(
      /参考图信息无效|参考图重复/,
    );
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
          sourceText: "恐龙",
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
    expect(prompt).toContain('原图文字 "恐龙"');
    expect(prompt).toContain('精确替换为 "恐龙！\\n侏罗纪"');
    expect(prompt).toContain("这是文字替换，不是物品替换");
    expect(prompt).toContain("严格禁止修改框选区域外的任何像素");
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

  it("parses the common Chinese replacement shorthand", () => {
    expect(
      parseTextReplacementInstruction("把恐龙替换成小猫，保留字体"),
    ).toEqual({
      sourceText: "恐龙",
      replacement: "小猫",
    });
    expect(parseTextReplacementInstruction("保持原样")).toBeUndefined();
    expect(
      parseTextReplacementInstruction("不要把恐龙替换成小猫"),
    ).toBeUndefined();
    expect(
      parseTextReplacementInstruction("把“恐龙”替换为“小猫！”，保留字体"),
    ).toEqual({ sourceText: "恐龙", replacement: "小猫！" });
    expect(parseTextReplacementInstruction("将框选的恐龙二字换成小猫")).toEqual(
      { sourceText: "恐龙", replacement: "小猫" },
    );
    expect(
      buildCanvasEditPrompt(
        [annotation({ target: "text", instruction: "把恐龙换成小猫" })],
        1000,
        500,
        "",
      ),
    ).toContain('原图文字 "恐龙"');
  });

  it("does not reinterpret object instructions as text replacement", () => {
    const prompt = buildCanvasEditPrompt(
      [annotation({ target: "object", instruction: "把恐龙换成小猫" })],
      1000,
      500,
      "",
    );
    expect(prompt).toContain("标注 1：物品 / 画面内容");
    expect(prompt).not.toContain("这是文字替换");
  });
});


it('accepts only complete portable canvas drafts within the request budget', () => {
  const prompt = buildCanvasEditPrompt([], 100, 100, '改变背景颜色')
  expect(isCanvasEditPrompt(prompt)).toBe(true)
  expect(isCanvasEditPrompt('普通提示词')).toBe(false)
  expect(canvasRequestIssue({ prompt, images: ['data:image/png;base64,abc'] })).toBe('')
  expect(canvasRequestIssue({ prompt, images: [] })).toContain('不完整')
  expect(canvasRequestIssue({ prompt, images: ['https://unprepared.example/image.jpg'] })).toContain('准备')
  expect(canvasRequestIssue({ prompt, images: Array.from({ length: 17 }, (_, i) => `data:image/png;base64,${i}`) })).toContain('14')
  expect(canvasRequestIssue({ prompt, images: ['data:image/png;base64,' + 'A'.repeat(24 * 1024 * 1024)] })).toContain('24 MB')
})
