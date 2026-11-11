/** @jest-environment node */
import {
  documentPlan,
  parseDocumentPlan,
  parseDocumentClarification,
  cellAddress,
  cellValue,
} from "../app/utils/document-workspace";
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
