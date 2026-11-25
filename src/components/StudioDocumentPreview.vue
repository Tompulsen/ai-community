<script setup lang="ts">
import type { DocumentStructure } from '../studio-documents'
defineProps<{ structure: DocumentStructure }>()
</script>
<template>
  <div class="document-content-preview">
    <div v-if="structure.format === 'docx'" class="document-page" aria-label="Word 内容预览">
      <p v-for="paragraph in structure.paragraphs?.slice(0, 200)" :key="paragraph.id" :class="{ 'document-title': paragraph.style === 'Title', 'document-heading': /^heading/i.test(paragraph.style || ''), 'document-table-text': paragraph.inTable }">{{ paragraph.text || '（空行）' }}</p>
      <p v-if="(structure.paragraphs?.length || 0) > 200" class="muted">预览显示前 200 段，下载可查看完整文件。</p>
    </div>
    <details v-for="sheet in structure.sheets || []" :key="sheet.id" open>
      <summary>{{ sheet.name }}{{ sheet.hidden ? ' · 隐藏工作表' : '' }}</summary>
      <div class="document-table-scroll" tabindex="0" role="region" :aria-label="`${sheet.name} 单元格内容`"><table><thead><tr><th scope="col">位置</th><th scope="col">内容 / 计算结果</th><th scope="col">公式</th></tr></thead><tbody><tr v-for="cell in sheet.cells.slice(0, 200)" :key="cell.address"><th scope="row">{{ cell.address }}</th><td>{{ cell.display ?? (cell.cachedValue ?? cell.value).value ?? '' }}</td><td>{{ cell.value.type === 'formula' ? cell.value.value : '' }}</td></tr></tbody></table></div>
      <p v-if="sheet.cells.length > 200" class="muted">每张表预览前 200 个单元格，下载可查看完整文件。</p>
    </details>
  </div>
</template>
<style scoped>
.document-content-preview { min-width: 0; font-size: 14px; }.document-page { padding: 24px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }.document-page p { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; margin: 0 0 14px; }.document-title { font-size: 22px; font-weight: 700; }.document-heading { font-size: 18px; font-weight: 600; }.document-table-text { border-left: 3px solid var(--border); padding-left: 12px; }.document-table-scroll { max-width: 100%; max-height: 360px; overflow: auto; border: 1px solid var(--border); border-radius: 10px; margin-top: 10px; }table { border-collapse: collapse; min-width: 100%; }th,td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); white-space: pre-wrap; overflow-wrap: anywhere; max-width: 360px; min-width: 70px; }th { background: var(--surface-soft); }summary { padding: 12px 0; cursor: pointer; font-weight: 600; }@media(max-width:600px){ .document-page { padding: 16px; }th,td { padding: 8px; } }
</style>
