<!-- Parameter layout adapted from octopus_chat image/video-parameter-controls (MIT). -->
<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown, Sparkles } from '@lucide/vue'
import type { ImageOptions, VideoOptions } from '../../shared/studio/options'
import { IMAGE_QUALITIES, IMAGE_RATIOS, IMAGE_RESOLUTIONS } from '../../shared/studio/image-params'
import { VIDEO_RATIOS } from '../../shared/studio/video-size'
import { videoCapabilities } from '../../shared/studio/video-capabilities'
import StudioChoiceGroup from './StudioChoiceGroup.vue'
import CreationAdvanced from './CreationAdvanced.vue'

const props = defineProps<{ kind: 'image' | 'video'; model: string }>()
const image = defineModel<ImageOptions>('image', { required: true })
const video = defineModel<VideoOptions>('video', { required: true })
const ratio = defineModel<string>('ratio', { required: true })
const count = defineModel<number>('count', { required: true })
const duration = defineModel<number>('duration', { required: true })
const size = defineModel<string>('size', { required: true })
const protocol = defineModel<string>('protocol', { required: true })
const options = (values: readonly string[]) => values.map(value => ({ value, label: value === 'auto' ? '自动' : value.toUpperCase() }))
const ratioOptions = computed(() => options(props.kind === 'image' ? IMAGE_RATIOS : VIDEO_RATIOS))
const limits = computed(() => videoCapabilities(props.model, video.value.mode))
const resolutions = computed(() => options([...new Set(['auto', ...(limits.value?.resolutions || [])])]))
const durationIndex = computed(() => Math.max(0, limits.value?.durations.indexOf(duration.value) ?? 0))
const qualityLabel: Record<string, string> = { auto: '自动', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高' }
function ratioShape(value: string) {
  const [width = 1, height = 1] = value.split(':').map(Number)
  return { width: `${Math.round(24 * Math.min(1, width / height))}px`, height: `${Math.round(24 * Math.min(1, height / width))}px` }
}
function revealInvalid(event: Event) {
  const field = event.target as HTMLElement
  for (let details = field.closest('details'); details; details = details.parentElement?.closest('details') || null) details.open = true
}
</script>
<template>
  <div class="media-parameters" @invalid.capture="revealInvalid">
    <section v-if="kind === 'video'" class="parameter-section" aria-label="视频生成方式">
      <h3>生成方式</h3>
      <StudioChoiceGroup v-model="video.mode" label="生成方式" :columns="2" :options="[{ value: 'text-to-video', label: '文生视频' }, { value: 'image-to-video', label: '图生视频' }, { value: 'first-last-frame', label: '首尾帧' }, { value: 'reference-to-video', label: '多图参考' }]" />
    </section>
    <section class="parameter-section" aria-label="画面比例">
      <h3>画面比例<span v-if="!ratioOptions.some(option => option.value === ratio)">{{ ratio }} · 自定义</span></h3>
      <StudioChoiceGroup v-model="ratio" label="画面比例" :options="ratioOptions" grid :columns="3">
        <template #visual="{ value }"><span class="ratio-figure"><Sparkles v-if="value === 'auto'" :size="20" /><span v-else class="ratio-shape" :style="ratioShape(value)" /></span></template>
      </StudioChoiceGroup>
    </section>
    <template v-if="kind === 'image'">
      <section class="parameter-section" aria-label="图片分辨率"><h3>分辨率</h3><StudioChoiceGroup v-model="image.resolution" label="分辨率" :options="options(IMAGE_RESOLUTIONS)" /></section>
      <section class="parameter-section" aria-label="图片画质"><h3>画质</h3><StudioChoiceGroup v-model="image.quality" label="画质" :columns="3" :options="IMAGE_QUALITIES.map(value => ({ value, label: qualityLabel[value] || value }))" /></section>
      <label class="parameter-inline"><span>图片数量</span><input v-model.number="count" class="control" type="number" min="1" max="16" step="1" required aria-label="图片数量" /></label>
    </template>
    <template v-else>
      <section class="parameter-section" aria-label="视频分辨率"><h3>分辨率<span v-if="!resolutions.some(option => option.value === video.resolution)">{{ video.resolution }} · 当前模型不支持</span></h3><StudioChoiceGroup v-model="video.resolution" label="视频分辨率" :options="resolutions" :columns="Math.min(4, resolutions.length)" /></section>
      <section class="parameter-section" aria-label="视频时长">
        <h3><span>时长</span><output>{{ duration }} 秒</output></h3>
        <template v-if="limits">
          <input class="duration-range" type="range" aria-label="视频时长" :aria-valuetext="`${duration} 秒`" min="0" :max="Math.max(0, limits.durations.length - 1)" step="1" :value="durationIndex" :disabled="limits.durations.length <= 1" @input="duration = limits.durations[Number(($event.target as HTMLInputElement).value)]!" />
          <div class="duration-labels"><span>{{ limits.durations[0] }} 秒</span><span>{{ limits.durations.at(-1) }} 秒</span></div>
          <StudioChoiceGroup v-if="limits.durations.length <= 6" :model-value="String(duration)" label="时长档位" :options="limits.durations.map(value => ({ value: String(value), label: `${value} 秒` }))" @update:model-value="duration = Number($event)" />
          <p v-if="!limits.durations.includes(duration)" class="parameter-warning" role="status">当前模型不支持 {{ duration }} 秒，请选择支持的时长。</p>
        </template>
        <input v-else v-model.number="duration" class="control" type="number" min="1" max="3600" step="1" aria-label="时长（秒）" required />
      </section>
    </template>
    <details class="parameter-advanced">
      <summary>自定义参数<ChevronDown :size="15" /></summary>
      <label class="parameter-inline"><span>尺寸</span><input v-model="size" class="control" pattern="auto|[1-9][0-9]{0,4}x[1-9][0-9]{0,4}|[124]K" required aria-label="尺寸" /></label>
      <CreationAdvanced v-model:image="image" v-model:video="video" v-model:protocol="protocol" :kind="kind" :model="model" embedded hide-primary />
    </details>
  </div>
</template>
<style scoped>
.media-parameters { display: grid; gap: 20px; min-width: 0; }.parameter-section { min-width: 0; }h3 { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 8px; color: var(--muted); font-size: 12px; line-height: 20px; font-weight: 400; }h3 > span:not(:first-child), output { font-variant-numeric: tabular-nums; color: var(--ink); }
.ratio-figure { display: grid; place-items: center; width: 28px; height: 28px; }.ratio-shape { display: block; border: 1px solid currentColor; border-radius: 2px; }
.parameter-inline { display: grid; grid-template-columns: minmax(64px, auto) minmax(0, 180px); align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; font-size: 13px; color: var(--muted); }.parameter-inline input { min-width: 0; width: 100%; }.duration-range { width: 100%; min-height: 32px; margin: 0; accent-color: var(--ink); }.duration-labels { display: flex; justify-content: space-between; margin: 0 0 8px; color: var(--muted); font-size: 11px; }.parameter-warning { color: var(--danger); font-size: 12px; line-height: 20px; margin-top: 8px; }.parameter-advanced { min-width: 0; }summary { display: flex; align-items: center; justify-content: space-between; min-height: 44px; list-style: none; cursor: pointer; color: var(--muted); font-size: 13px; }summary::-webkit-details-marker { display: none; }details[open] > summary svg { transform: rotate(180deg); }summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
</style>
