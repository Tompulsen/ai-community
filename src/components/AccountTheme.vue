<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Sun, Moon, Monitor, Clock3, Check, RotateCcw } from '@lucide/vue'
import { appearance, themeState, type AppearanceMode, type Theme } from '../appearance'

const modes: { value: AppearanceMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '明亮模式', icon: Sun }, { value: 'dark', label: '暗色模式', icon: Moon },
  { value: 'schedule', label: '定时切换', icon: Clock3 }, { value: 'system', label: '跟随系统', icon: Monitor },
]
const currentTheme = computed(() => appearance.themes.find(theme => theme.id === themeState.value[themeState.value.current])!)
const lightStart = ref(themeState.value.lightStart), darkStart = ref(themeState.value.darkStart)
const valid = computed(() => appearance.validTimes(lightStart.value, darkStart.value))
watch([() => themeState.value.lightStart, () => themeState.value.darkStart], () => {
  lightStart.value = themeState.value.lightStart; darkStart.value = themeState.value.darkStart
})
function updateTime() {
  if (valid.value) appearance.set({ lightStart: lightStart.value, darkStart: darkStart.value })
}
function reset() {
  appearance.reset(); lightStart.value = themeState.value.lightStart; darkStart.value = themeState.value.darkStart
}
function preview(theme: Theme) {
  return { '--preview-bg': theme.colors[0], '--preview-surface': theme.colors[1], '--preview-soft': theme.colors[2], '--preview-ink': theme.colors[4], '--preview-muted': theme.colors[5], '--preview-accent': theme.colors[6] }
}
</script>

<template>
  <section class="panel-section theme-settings" aria-labelledby="theme-title">
    <div class="section-heading"><div><h2 id="theme-title">主题与外观</h2><p class="form-note">选择后立即生效，偏好自动保存在当前浏览器。</p></div><button class="button btn subtle" type="button" @click="reset"><RotateCcw :size="16" aria-hidden="true" />恢复默认</button></div>
    <fieldset class="theme-modes"><legend>界面模式</legend>
      <label v-for="option in modes" :key="option.value" class="mode-option" :class="{ selected: themeState.mode === option.value }">
        <input type="radio" name="appearance-mode" :value="option.value" :checked="themeState.mode === option.value" @change="appearance.set({ mode: option.value })" />
        <component :is="option.icon" :size="20" aria-hidden="true" /><span>{{ option.label }}</span>
      </label>
    </fieldset>
    <p class="theme-current" role="status">当前显示：{{ themeState.current === 'dark' ? '暗色模式' : '明亮模式' }} · {{ currentTheme.name }}</p>
    <div v-if="themeState.mode === 'schedule'" class="theme-schedule">
      <div class="schedule-times">
        <label class="field"><span>切换到明亮模式</span><input v-model="lightStart" class="control" type="time" step="60" required :aria-invalid="!valid" aria-describedby="schedule-help schedule-error" @input="updateTime" /></label>
        <label class="field"><span>切换到暗色模式</span><input v-model="darkStart" class="control" type="time" step="60" required :aria-invalid="!valid" aria-describedby="schedule-help schedule-error" @input="updateTime" /></label>
      </div>
      <p id="schedule-help" class="form-note">按此设备的本地时间自动切换，支持跨午夜。有效时间自动保存；手动选择明亮或暗色模式会停止自动切换。</p>
      <p v-if="!valid" id="schedule-error" class="error-message" role="alert">请输入两个不同的有效时间。当前仍按 {{ themeState.lightStart }} / {{ themeState.darkStart }} 切换。</p>
    </div>
    <p v-if="themeState.error" class="error-message" role="alert">{{ themeState.error }}</p>
    <div v-for="mode in (['light', 'dark'] as const)" :key="mode" class="theme-palette-group">
      <fieldset class="theme-palettes"><legend><component :is="mode === 'light' ? Sun : Moon" :size="18" aria-hidden="true" />{{ mode === 'light' ? '明亮模式使用的主题' : '暗色模式使用的主题' }}</legend>
        <label v-for="theme in appearance.themes.filter(item => item.mode === mode)" :key="theme.id" class="palette-option" :class="{ selected: themeState[mode] === theme.id }">
          <input type="radio" :name="`${mode}-palette`" :value="theme.id" :checked="themeState[mode] === theme.id" :aria-label="theme.name" @change="appearance.set({ [mode]: theme.id })" />
          <span class="theme-preview" :style="preview(theme)" aria-hidden="true"><span class="preview-rail"><i /><b /><b /></span><span class="preview-content"><span class="preview-heading"><i /><i /><i /></span><span class="preview-post"><i /><b /><b /><em /></span></span></span>
          <span class="palette-caption"><span>{{ theme.name }}<small v-if="theme.id === 'sage'">默认</small></span><Check v-if="themeState[mode] === theme.id" :size="16" aria-hidden="true" /></span>
        </label>
      </fieldset>
    </div>
    <p class="form-note theme-footnote">明暗主题分别记忆。自动模式会使用对应配色；同一浏览器的其他标签页也会同步更新。</p>
  </section>
</template>

<style scoped>
.theme-settings { max-width: 960px; }
.theme-settings .section-heading { gap: 16px; margin-bottom: 28px; }
.theme-settings .form-note { display: block; }
.theme-modes, .theme-palettes { border: 0; margin: 0; padding: 0; min-width: 0; display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.theme-modes legend, .theme-palettes legend { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
.theme-palettes legend svg { margin-right: 8px; }
.mode-option { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; }
.mode-option:hover, .palette-option:hover { border-color: var(--muted); }
.mode-option.selected { background: var(--blue-soft); border-color: var(--blue); color: var(--ink); }
.mode-option input { width: 16px; height: 16px; margin: 0; accent-color: var(--blue); }
.mode-option:focus-within, .palette-option:focus-within { outline: 2px solid var(--blue); outline-offset: 3px; }
.theme-current { margin: 16px 0 24px; color: var(--muted); font-size: 13px; }
.theme-schedule { margin: 0 0 28px; padding: 20px; border: 1px solid var(--border); border-radius: 8px; }
.schedule-times { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.schedule-times input { font-variant-numeric: tabular-nums; font-size: 16px; }
.theme-palette-group { padding-top: 24px; margin-top: 24px; border-top: 1px solid var(--border); }
.theme-palettes { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.palette-option { position: relative; min-width: 0; border: 2px solid var(--border); border-radius: 10px; cursor: pointer; }
.palette-option.selected { border-color: var(--blue); }
.palette-option > input { position: absolute; width: 1px; height: 1px; margin: 0; opacity: 0; }
.palette-caption { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 48px; padding: 10px 12px; font-size: 13px; }
.palette-caption > span { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.palette-caption small { color: var(--muted); font-size: 11px; }
.palette-caption svg { color: var(--blue); }
.theme-preview { display: flex; height: 128px; background: var(--preview-bg); overflow: hidden; border-radius: 8px 8px 0 0; }
.preview-rail { width: 28%; background: var(--preview-surface); display: flex; align-items: center; flex-direction: column; gap: 14px; padding: 14px 0; }
.preview-rail i { width: 22px; height: 22px; border-radius: 50%; background: var(--preview-accent); }
.preview-rail b { width: 12px; height: 12px; border: 2px solid var(--preview-muted); border-radius: 4px; }
.preview-rail b:first-of-type { border-color: var(--preview-accent); }
.preview-content { flex: 1; padding: 14px 12px 0; min-width: 0; }
.preview-heading { display: flex; justify-content: flex-end; gap: 4px; margin-bottom: 20px; }
.preview-heading i { width: 6px; height: 6px; border-radius: 50%; background: var(--preview-accent); opacity: .7; }
.preview-post { position: relative; display: grid; gap: 9px; padding: 12px; border-radius: 8px 8px 0 0; background: var(--preview-surface); }
.preview-post i { width: 45%; height: 6px; background: var(--preview-accent); border-radius: 2px; }
.preview-post b { width: 90%; height: 4px; background: var(--preview-muted); border-radius: 2px; }
.preview-post b:first-of-type { width: 68%; background: var(--preview-ink); }
.preview-post em { width: 28%; height: 10px; border-radius: 3px; background: var(--preview-soft); }
.theme-footnote { margin-top: 24px; }
@media (max-width: 600px) {
  .mode-option { padding: 10px; gap: 8px; font-size: 13px; }
  .theme-palettes { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .schedule-times { grid-template-columns: 1fr; }
  .theme-schedule { padding: 16px; }
}
@media (forced-colors: active) { .palette-option.selected, .mode-option.selected { outline: 2px solid Highlight; } }
</style>
