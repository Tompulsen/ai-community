"use client";
import React from "react";
import styles from "./document-workspace.module.scss";

/** The preview shows verified text/cached cells, never untrusted document HTML. */
export function DocumentContentPreview({ structure }: { structure: any }) {
  if (structure.format === "docx") {
    const paragraphs = structure.paragraphs || [];
    return (
      <div className={styles.contentPreview} aria-label="Word 内容预览">
        {paragraphs.slice(0, 200).map((p: any) => (
          <p
            key={p.id}
            className={p.inTable ? styles.tableParagraph : undefined}
          >
            {p.inTable && <small>表格内容 · </small>}
            {p.text || "（空行）"}
          </p>
        ))}
        {paragraphs.length > 200 && (
          <p>预览展示前 200 段，下载可查看完整文件。</p>
        )}
      </div>
    );
  }
  return (
    <div className={styles.contentPreview} aria-label="Excel 内容预览">
      {(structure.sheets || []).map((sheet: any) => (
        <details key={sheet.id} open>
          <summary>
            {sheet.name}
            {sheet.hidden ? "（隐藏工作表）" : ""}
          </summary>
          <div
            className={styles.previewTable}
            tabIndex={0}
            aria-label={`${sheet.name} 单元格内容`}
          >
            <table>
              <thead>
                <tr>
                  <th>位置</th>
                  <th>内容 / 计算结果</th>
                  <th>公式</th>
                </tr>
              </thead>
              <tbody>
                {sheet.cells.slice(0, 200).map((c: any) => (
                  <tr key={c.address}>
                    <th scope="row">{c.address}</th>
                    <td>
                      {c.display ??
                        String((c.cachedValue ?? c.value)?.value ?? "")}
                    </td>
                    <td>{c.value.type === "formula" ? c.value.value : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sheet.cells.length > 200 && (
            <p>每张表预览前 200 个单元格，下载可查看完整文件。</p>
          )}
        </details>
      ))}
    </div>
  );
}
