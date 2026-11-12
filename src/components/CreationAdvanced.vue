<script setup lang="ts">
import { computed } from 'vue'
import type { ImageOptions, VideoOptions } from '../../shared/studio/options'
import { IMAGE_QUALITIES, IMAGE_RESOLUTIONS } from '../../shared/studio/image-params'
import { videoCapabilities } from '../../shared/studio/video-capabilities'
const image = defineModel<ImageOptions>('image', { required: true })
const video = defineModel<VideoOptions>('video', { required: true })
const protocol = defineModel<string>('protocol', { required: true })
const props = defineProps<{ kind: 'image' | 'video' | 'text'; model: string }>()
const capabilities = computed(() => videoCapabilities(props.model, video.value.mode))
const modes = { 'text-to-video': '文生视频', 'image-to-video': '图生视频', 'first-last-frame': '首尾帧', 'reference-to-video': '多图参考' }
</script>
<template>
  <details class="advanced-options">
    <summary>高级参数</summary>
    <div class="advanced-fields">
      <label class="field"><span>请求方式</span><select v-model="protocol" class="control" @change="image.imageStream = false"><option value="openai">同步</option><option value="async">异步任务</option></select></label>
      <template v-if="kind === 'image'">
        <label class="field"><span>分辨率</span><select v-model="image.resolution" class="control"><option v-for="value in IMAGE_RESOLUTIONS" :key="value" :value="value">{{ value === 'auto' ? '自动' : value.toUpperCase() }}</option></select></label>
        <label class="field"><span>画质</span><select v-model="image.quality" class="control"><option v-for="value in IMAGE_QUALITIES" :key="value" :value="value">{{ value }}</option></select></label>
        <label class="field"><span>风格</span><select v-model="image.style" class="control"><option :value="undefined">默认</option><option value="natural">自然</option><option value="vivid">生动</option></select></label>
        <label class="field"><span>输出格式</span><select v-model="image.imageOutputFormat" class="control"><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label>
        <label class="field"><span>背景</span><select v-model="image.imageBackground" class="control"><option value="auto">自动</option><option value="opaque">不透明</option><option value="transparent">透明</option></select></label>
        <label v-if="image.imageOutputFormat !== 'png'" class="field"><span>压缩质量 {{ image.imageOutputCompression }}%</span><input v-model.number="image.imageOutputCompression" type="range" min="0" max="100" /></label>
        <label class="field"><span>返回方式</span><select v-model="image.imageResponseFormat" class="control"><option value="url">图片链接</option><option value="b64_json">Base64</option></select></label>
        <label class="check-field"><input v-model="image.imageStream" type="checkbox" :disabled="protocol === 'async'" />流式预览</label>
        <label v-if="image.imageStream" class="field"><span>中间预览次数</span><input v-model.number="image.imagePartialImages" class="control" type="number" min="0" max="3" /></label>
        <p v-if="image.imageBackground === 'transparent' && image.imageOutputFormat === 'jpeg'" class="muted">透明背景将输出为 PNG。</p>
      </template>
      <template v-if="kind === 'video'">
        <label class="field"><span>生成方式</span><select v-model="video.mode" class="control"><option v-for="(label, value) in modes" :key="value" :value="value">{{ label }}</option></select></label>
        <label class="field"><span>视频分辨率</span><select v-model="video.resolution" class="control"><option v-for="value in capabilities?.resolutions || []" :key="value" :value="value">{{ value }}</option><option value="auto">自动</option></select></label>
        <label class="field"><span>参考图来源</span><select v-model="video.openaiReferenceSource" class="control"><option value="upload">上传图片</option><option value="image_url">图片 URL</option><option value="file_id">文件 ID</option></select></label>
        <template v-if="video.openaiReferenceSource === 'image_url'"><label class="field"><span>首张图片 URL</span><input v-model="video.openaiImageUrl" class="control" type="url" /></label><label v-if="video.mode === 'first-last-frame'" class="field"><span>尾帧图片 URL</span><input v-model="video.openaiLastImageUrl" class="control" type="url" /></label></template>
        <label v-if="video.openaiReferenceSource === 'file_id'" class="field"><span>参考文件 ID</span><input v-model="video.openaiFileId" class="control" /></label>
        <label class="field"><span>负面提示词</span><textarea v-model="video.negativePrompt" class="control" rows="3" /></label>
        <label class="field"><span>随机种子</span><input v-model="video.seed" class="control" inputmode="numeric" placeholder="随机" /></label>
        <label class="check-field"><input v-model="video.generateAudio" type="checkbox" />生成音频</label>
        <label class="field"><span>人物生成</span><select v-model="video.personGeneration" class="control"><option value="">默认</option><option value="allow_all">允许人物</option><option value="allow_adult">仅成人</option><option value="dont_allow">禁止人物</option></select></label>
        <label class="field"><span>自定义参数 JSON</span><textarea v-model="video.customParameters" class="control" rows="4" placeholder="{}" spellcheck="false" /></label>
        <p v-if="!capabilities" class="form-error">当前模型尚未配置视频能力，提交前会停止校验，请联系管理员。</p>
      </template>
    </div>
  </details>
</template>
<style scoped>
.advanced-options { border-top: 1px solid var(--border); padding-top: 16px; }
summary { cursor: pointer; font-size: 14px; padding-block: 4px; }
.advanced-fields { display: grid; gap: 16px; padding-top: 16px; }
.control { width: 100%; min-width: 0; }
.check-field { display: flex; gap: 8px; align-items: center; font-size: 14px; min-height: 32px; }
.muted, .form-error { margin: 0; font-size: 12px; line-height: 20px; }
</style>
