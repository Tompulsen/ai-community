<script setup lang="ts">
import type { publicationFields } from '../publication-parameters'
const fields = defineModel<ReturnType<typeof publicationFields>>({ required: true })
defineProps<{ kind: 'image' | 'video' }>()
</script>

<template>
  <fieldset class="publication-parameters">
    <legend>{{ kind === 'image' ? '图片参数（选填）' : '视频参数（选填）' }}</legend>
    <p class="form-note">填写实际创作参数，方便查看和制作同款。</p>
    <div class="parameter-grid">
      <label class="field"><span>画面尺寸</span><input v-model="fields.size" class="control" maxlength="20" placeholder="例如 1024x1024" /></label>
      <label class="field"><span>画面比例</span><input v-model="fields.aspectRatio" class="control" maxlength="7" placeholder="例如 16:9" /></label>
      <template v-if="kind === 'video'">
        <label class="field"><span>视频时长（秒）</span><input v-model="fields.duration" class="control" type="number" min="0" max="3600" step="any" placeholder="例如 8" /></label>
        <label class="field"><span>视频分辨率</span><input v-model="fields.resolution" class="control" maxlength="20" placeholder="例如 1080p" /></label>
        <label class="field"><span>帧率（FPS）</span><input v-model="fields.fps" class="control" type="number" min="1" max="240" step="any" placeholder="例如 24" /></label>
      </template>
      <label class="field"><span>随机种子</span><input v-model="fields.seed" class="control" inputmode="numeric" maxlength="30" placeholder="未记录可留空" /></label>
    </div>
  </fieldset>
</template>

<style scoped>
.publication-parameters { border: 0; padding: 0; margin: 0; min-width: 0; }
legend { font-size: 14px; margin-bottom: 6px; }
.parameter-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
.control { min-width: 0; }
@media (max-width: 359px) { .parameter-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
