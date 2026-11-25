import { expect, test } from "vitest";
import {
  documentPlan,
  parseDocumentPlan,
  parseDocumentClarification,
  parseDocumentResponse,
  DocumentResponseError,
  DOCUMENT_MAX_PLAN_BYTES,
  cellAddress,
  cellValue,
} from "../shared/studio/document-workspace.ts";
const source = "cc876fa3-24ed-488c-8fd8-88a1583a997e";
const edit = (operations: unknown[]) => ({
  schemaVersion: 1,
  kind: "edit",
  sourceArtifactId: source,
  baseVersion: 3,
  operations,
});
const operation = {
  op: "set_cell",
  sheetId: "sheet-0",
  address: "D3",
  expectedOldValue: { type: "number", value: 30 },
  value: { type: "number", value: 35.5 },
};
test("accepts a typed edit with explicit source and old value", () =>
  expect(documentPlan.parse(edit([operation]))).toEqual(edit([operation])));
test.each(["A0", "XFE1", "A100001", "../A1", "A1:B2"])(
  "rejects invalid or unbounded address %s",
  (address) => expect(cellAddress.safeParse(address).success).toBe(false),
);
test("rejects duplicate and conflicting target edits", () =>
  expect(
    documentPlan.safeParse(
      edit([operation, { ...operation, value: { type: "number", value: 99 } }]),
    ).success,
  ).toBe(false));
test("rejects equal-count but unknown target keys", () =>
  expect(
    documentPlan.safeParse(edit([{ ...operation, sheetId: "invented-target" }]))
      .success,
  ).toBe(false));
test("rejects arbitrary executable plan fields", () =>
  expect(
    documentPlan.safeParse({ ...edit([operation]), script: "process.exit()" })
      .success,
  ).toBe(false));
test("requires expected old values and a base version", () => {
  expect(
    documentPlan.safeParse(
      edit([
        {
          op: "set_cell",
          sheetId: "sheet-0",
          address: "A1",
          value: { type: "blank" },
        },
      ]),
    ).success,
  ).toBe(false);
  expect(
    documentPlan.safeParse({ ...edit([operation]), baseVersion: undefined })
      .success,
  ).toBe(false);
});
test("preserves leading zeros and literal equals as text", () => {
  expect(cellValue.parse({ type: "text", value: "00123" })).toEqual({
    type: "text",
    value: "00123",
  });
  expect(cellValue.parse({ type: "text", value: "=not a formula" }).type).toBe(
    "text",
  );
});
test("rejects impossible dates and nonfinite numbers", () => {
  expect(
    cellValue.safeParse({ type: "date", value: "2026-02-30" }).success,
  ).toBe(false);
  expect(cellValue.safeParse({ type: "number", value: Infinity }).success).toBe(
    false,
  );
});
test("accepts JSON fencing but never executes or renames Python", () => {
  expect(
    parseDocumentPlan(
      "```json\n" + JSON.stringify(edit([operation])) + "\n```",
    ),
  ).toEqual(edit([operation]));
  expect(() => parseDocumentPlan("```python\nprint('hello')\n```")).toThrow();
});
test("keeps a model clarification distinct from a failed plan", () => {
  expect(parseDocumentClarification('{"needsInput":"请提供销售明细"}')).toBe(
    "请提供销售明细",
  );
  expect(
    parseDocumentClarification(JSON.stringify(edit([operation]))),
  ).toBeNull();
});
test("rejects case-insensitive duplicate workbook sheets", () =>
  expect(
    documentPlan.safeParse({
      schemaVersion: 1,
      kind: "create_workbook",
      fileName: "test.xlsx",
      sheets: [
        { name: "Data", cells: [] },
        { name: "data", cells: [] },
      ],
    }).success,
  ).toBe(false));

test.each(['{"schemaVersion":1,"fileName":"练习', '{"needsInput":"请提供', 'not JSON'])("incomplete output has an actionable error: %s", (value) => {
  expect(() => parseDocumentResponse(value)).toThrow(DocumentResponseError);
  expect(() => parseDocumentClarification(value)).toThrow('内容不完整或格式有误');
});
test("rejects oversized output before parsing even for clarification", () => {
  const value = ' '.repeat(DOCUMENT_MAX_PLAN_BYTES + 1);
  expect(() => parseDocumentResponse(value)).toThrow('内容过长');
  expect(() => parseDocumentClarification(value)).toThrow('内容过长');
});
test("returns friendly schema errors and accepts complete long plans without truncating data", () => {
  expect(() => parseDocumentResponse('{"schemaVersion":1,"kind":"create_workbook"}')).toThrow('不符合文件要求');
  const plan = { schemaVersion: 1, kind: 'create_workbook', fileName: '练习.xlsx', sheets: [{ name: '练习', cells: Array.from({ length: 100 }, (_, i) => ({ address: `A${i+1}`, value: { type: 'text', value: `示例${i}` } })) }] };
  expect(JSON.stringify(plan).length).toBeGreaterThan(4096);
  expect(parseDocumentResponse(JSON.stringify(plan))).toEqual({ plan });
  expect(parseDocumentResponse('{"needsInput":"请确认拆分范围"}')).toEqual({ clarification: '请确认拆分范围' });
});

const numericWorkbook = (value: string, extra = '') => `{"schemaVersion":1,"kind":"create_workbook","fileName":"练习.xlsx","sheets":[{"name":"练习","cells":[{"address":"A1","value":{"type":"number","value":${value}}}]}]${extra}}`;
test.each([['5-1', 4], ['2+3', 5], ['2*3', 6], ['6/2', 3], ['-5 - -1', -4], ['1.5e2 / 3', 50]])('normalizes one complete numeric cell expression %s without changing its type', (expression, expected) => {
  expect(parseDocumentPlan(numericWorkbook(expression as string, ',"help":{"type":"text","value":""}'))).toEqual(JSON.parse(numericWorkbook(String(expected))));
});
test.each(['1/0', '1e309+1', '1e308*10', '9007199254740991+1', '5-1+2', '(5-1)', 'Math.random()', 'A1+1', '01+2'])('rejects ambiguous or unsafe numeric expression %s', expression => {
  expect(() => parseDocumentPlan(numericWorkbook(expression))).toThrow(DocumentResponseError);
});
test('numeric repair never changes text, existing formulas, edit preconditions or truncated output', () => {
  const original = JSON.parse(numericWorkbook('4'));
  original.sheets[0].cells.push(
    { address: 'B1', value: { type: 'text', value: '示例 {"type":"number","value":5-1} 与 \\ 路径' } },
    { address: 'C1', value: { type: 'formula', value: '=A1+1' } },
  );
  const raw = JSON.stringify(original).replace('"value":4}', '"value":5-1}');
  expect(parseDocumentPlan(raw)).toEqual(original);
  expect(() => parseDocumentPlan(raw.slice(0, -1))).toThrow(DocumentResponseError);
  expect(() => parseDocumentPlan(JSON.stringify(edit([operation])).replace('"value":30}', '"value":5-1}'))).toThrow(DocumentResponseError);
});
test.each([',"help":{"type":"text","value":"不能丢弃的说明"}', ',"help":{"type":"text","value":"","script":"bad"}', ',"script":"bad"', ',"extra":null'])('keeps strict validation for nonempty or unknown additions %s', extra => {
  expect(() => parseDocumentPlan(numericWorkbook('5-1', extra))).toThrow('不符合文件要求');
});
