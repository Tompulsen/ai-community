<script setup lang="ts">
import { computed } from 'vue'
import type { ImageOptions, VideoOptions } from '../../shared/studio/options'
import type { ModelApiFormat, VideoModelSetting } from '../../shared/studio/model-types'
import { IMAGE_QUALITIES, IMAGE_RESOLUTIONS, usesGeminiImageChat } from '../../shared/studio/image-params'
import { videoCapabilities } from '../../shared/studio/video-capabilities'
import { VIDEO_RESOLUTIONS } from '../../shared/studio/video-size'
const image = defineModel<ImageOptions>('image', { required: true })
const video = defineModel<VideoOptions>('video', { required: true })
const protocol = defineModel<string>('protocol', { required: true })
const apiFormat = defineModel<ModelApiFormat>('apiFormat', { required: true })
const props = defineProps<{ kind: 'image' | 'video' | 'text'; model: string; modelApiFormat?: ModelApiFormat; videoSetting?: VideoModelSetting; embedded?: boolean; hidePrimary?: boolean }>()
const capabilities = computed(() => videoCapabilities(props.model, video.value.mode, props.videoSetting))
const resolutions = computed(() => (capabilities.value?.resolutions.length ? capabilities.value.resolutions : VIDEO_RESOLUTIONS).filter(value => value !== 'auto'))
const geminiImage = computed(() => props.kind === 'image' && usesGeminiImageChat(props.model, apiFormat.value === 'auto' ? props.modelApiFormat : apiFormat.value))
const modes = { 'text-to-video': '文生视频', 'image-to-video': '图生视频', 'first-last-frame': '首尾帧', 'reference-to-video': '多图参考' }
function compression(event: Event) {
  const input = event.target as HTMLInputElement, value = input.valueAsNumber
  if (Number.isFinite(value)) image.value.imageOutputCompression = Math.max(0, Math.min(100, Math.round(value)))
  input.value = String(image.value.imageOutputCompression)
}
</script>
<template>
  <details class="advanced-options" :class="{ embedded }" :open="embedded">
    <summary v-show="!embedded">高级参数</summary>
    <div class="advanced-fields">
      <label v-if="kind === 'image'" class="field"><span>接口格式</span><select v-model="apiFormat" class="control"><option value="auto">自动</option><option value="images">Images</option><option value="chat-completions">Chat Completions</option></select></label>
      <label class="field"><span>请求方式</span><select v-model="protocol" class="control" @change="image.imageStream = false"><option value="auto">自动</option><option v-if="protocol === 'sync'" value="sync">同步</option><option value="openai">同步</option><option value="async" :disabled="geminiImage">异步任务</option></select></label>
      <template v-if="kind === 'image'">
        <label v-if="!hidePrimary" class="field"><span>分辨率</span><select v-model="image.resolution" class="control"><option v-for="value in IMAGE_RESOLUTIONS" :key="value" :value="value">{{ value === 'auto' ? '自动' : value.toUpperCase() }}</option></select></label>
        <label v-if="!hidePrimary" class="field"><span>画质</span><select v-model="image.quality" class="control"><option v-for="value in IMAGE_QUALITIES" :key="value" :value="value">{{ value }}</option></select></label>
        <label class="field"><span>风格</span><select v-model="image.style" class="control"><option :value="undefined">默认</option><option value="natural">自然</option><option value="vivid">生动</option></select></label>
        <label v-if="!geminiImage" class="field"><span>随机种子</span><input v-model="image.seed" class="control" inputmode="numeric" pattern="[0-9]*" placeholder="随机（模型需支持 seed）" /></label>
        <label class="field"><span>输出格式</span><select v-model="image.imageOutputFormat" class="control"><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label>
        <label class="field"><span>背景</span><select v-model="image.imageBackground" class="control"><option value="auto">自动</option><option value="opaque">不透明</option><option value="transparent">透明</option></select></label>
        <div v-if="image.imageOutputFormat !== 'png'" class="field compression-field"><span>压缩质量</span><div class="compression-control"><input :value="image.imageOutputCompression" aria-label="压缩质量" type="range" min="0" max="100" step="1" @input="compression" /><label class="compression-number"><input :value="image.imageOutputCompression" aria-label="压缩质量数值" class="control" type="number" min="0" max="100" step="1" @change="compression" /><span aria-hidden="true">%</span></label></div></div>
        <label class="field"><span>返回方式</span><select v-model="image.imageResponseFormat" class="control"><option value="url">图片链接</option><option value="b64_json">Base64</option></select></label>
        <label class="check-field"><input v-model="image.imageStream" type="checkbox" :disabled="protocol === 'async'" />流式预览</label>
        <label v-if="image.imageStream" class="field"><span>中间预览次数</span><input v-model.number="image.imagePartialImages" class="control" type="number" min="0" max="3" /></label>
        <p v-if="image.imageBackground === 'transparent' && image.imageOutputFormat === 'jpeg'" class="muted">透明背景将输出为 PNG。</p>
      </template>
      <template v-if="kind === 'video'">
        <label v-if="!hidePrimary" class="field"><span>生成方式</span><select v-model="video.mode" class="control"><option v-for="(label, value) in modes" :key="value" :value="value">{{ label }}</option></select></label>
        <label v-if="!hidePrimary" class="field"><span>视频分辨率</span><select v-model="video.resolution" class="control"><option v-if="video.resolution !== 'auto' && !resolutions.includes(video.resolution)" :value="video.resolution">{{ video.resolution }}（不在可选列表中）</option><option v-for="value in resolutions" :key="value" :value="value">{{ value }}</option><option value="auto">自动</option></select></label>
        <label class="field"><span>参考图来源</span><select v-model="video.openaiReferenceSource" class="control"><option value="upload">上传图片</option><option value="image_url">图片 URL</option><option value="file_id">文件 ID</option></select></label>
        <template v-if="video.openaiReferenceSource === 'image_url'"><label class="field"><span>首张图片 URL</span><input v-model="video.openaiImageUrl" class="control" type="url" /></label><label v-if="video.mode === 'first-last-frame'" class="field"><span>尾帧图片 URL</span><input v-model="video.openaiLastImageUrl" class="control" type="url" /></label></template>
        <label v-if="video.openaiReferenceSource === 'file_id'" class="field"><span>参考文件 ID</span><input v-model="video.openaiFileId" class="control" /></label>
        <label class="field"><span>负面提示词</span><textarea v-model="video.negativePrompt" class="control" rows="3" /></label>
        <label class="field"><span>随机种子</span><input v-model="video.seed" class="control" inputmode="numeric" placeholder="随机" /></label>
        <label class="check-field"><input v-model="video.generateAudio" type="checkbox" />生成音频</label>
        <label class="field"><span>人物生成</span><select v-model="video.personGeneration" class="control"><option value="">默认</option><option value="allow_all">允许人物</option><option value="allow_adult">仅成人</option><option value="dont_allow">禁止人物</option></select></label>
        <label class="field"><span>自定义参数 JSON</span><textarea v-model="video.customParameters" class="control" rows="4" placeholder="{}" spellcheck="false" /></label>
      </template>
    </div>
  </details>
</template>
<style scoped>
.advanced-options { border-top: 1px solid var(--border); padding-top: 16px; }
.advanced-options.embedded { border-top: 0; padding-top: 0; }
.embedded .advanced-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.embedded .field:has(textarea), .embedded .muted, .embedded .form-error { grid-column: 1 / -1; }
@media (max-width: 399px) { .embedded .advanced-fields { grid-template-columns: minmax(0, 1fr); } }
summary { cursor: pointer; font-size: 14px; padding-block: 4px; }
.advanced-fields { display: grid; gap: 16px; padding-top: 16px; }
.control { width: 100%; min-width: 0; }
.compression-control { display: flex; align-items: center; gap: 12px; min-height: 44px; }.compression-control > input { flex: 1; min-width: 0; accent-color: var(--ink); }.compression-number { display: flex; align-items: center; gap: 4px; flex: none; font-size: 12px; color: var(--muted); }.compression-number .control { width: 72px; min-height: 36px; font-variant-numeric: tabular-nums; }
.check-field { display: flex; gap: 8px; align-items: center; font-size: 14px; min-height: 32px; }
.muted, .form-error { margin: 0; font-size: 12px; line-height: 20px; }
</style>
