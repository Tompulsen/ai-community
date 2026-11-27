<script setup lang="ts">
import { ref } from 'vue'
import { ShieldX } from '@lucide/vue'

defineProps<{ reason: string; isEdit?: boolean }>()
const notice = ref<HTMLElement>()
defineExpose({ focus: () => notice.value?.focus() })
</script>

<template>
  <section ref="notice" class="work-moderation-notice" role="alert" tabindex="-1" aria-label="发布被拦截">
    <div class="moderation-heading">
      <span class="moderation-icon"><ShieldX :size="26" aria-hidden="true" /></span>
      <div><p class="moderation-label">内容审核未通过</p><h3>{{ isEdit ? '暂不能发布修改' : '暂不能发布作品' }}</h3></div>
    </div>
    <p class="moderation-outcome">{{ isEdit ? '本次修改未发布，原作品保持不变。' : '本次提交已被拦截，作品未公开。' }}</p>
    <div class="moderation-reason"><strong>审核原因</strong><p>{{ reason }}</p></div>
    <p class="moderation-guidance">请调整作品图片、文案或公开参考图后重新提交。</p>
    <div v-if="$slots.default" class="moderation-actions"><slot /></div>
  </section>
</template>

<style scoped>
.work-moderation-notice { padding: 24px; border: 1px solid color-mix(in srgb, var(--danger) 48%, var(--border)); border-radius: 16px; background: color-mix(in srgb, var(--danger-soft) 38%, var(--surface)); color: var(--ink); }
.work-moderation-notice:focus-visible { outline: 2px solid var(--danger); outline-offset: 3px; }
.moderation-heading { display: flex; align-items: center; gap: 14px; }
.moderation-icon { width: 48px; height: 48px; flex: none; display: grid; place-items: center; border-radius: 14px; color: var(--danger); background: var(--danger-soft); }
.moderation-label { margin: 0 0 4px; font-size: 12px; line-height: 18px; color: var(--danger); }
.moderation-heading h3 { margin: 0; font-size: 22px; line-height: 1.4; font-weight: 600; }
.moderation-outcome { margin: 16px 0; font-size: 15px; line-height: 1.7; }
.moderation-reason { padding: 14px 16px; border-radius: 10px; background: var(--surface); font-size: 14px; line-height: 1.7; overflow-wrap: anywhere; }
.moderation-reason strong { font-weight: 600; }
.moderation-reason p { margin: 6px 0 0; }
.moderation-guidance { margin: 14px 0 0; color: var(--muted); font-size: 13px; line-height: 1.8; }
.moderation-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
.moderation-actions :deep(button) { min-height: 44px; flex: 1; }
@media (max-width: 480px) {
  .work-moderation-notice { padding: 18px 16px; border-radius: 12px; }
  .moderation-heading { align-items: flex-start; gap: 10px; }
  .moderation-icon { width: 40px; height: 40px; border-radius: 12px; }
  .moderation-heading h3 { font-size: 19px; }
  .moderation-actions { flex-direction: column; }
}
</style>
