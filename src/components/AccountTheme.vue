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
    <div class="settings-preference-group theme-mode-group">
      <h3 id="appearance-mode-heading" class="settings-preference-title">界面模式</h3>
      <div class="theme-mode-content">
        <fieldset class="theme-modes" aria-labelledby="appearance-mode-heading"><legend class="settings-group-legend">界面模式</legend>
          <label v-for="option in modes" :key="option.value" class="mode-option" :class="{ selected: themeState.mode === option.value }">
            <input type="radio" name="appearance-mode" :value="option.value" :checked="themeState.mode === option.value" @change="appearance.set({ mode: option.value })" />
            <component :is="option.icon" :size="16" aria-hidden="true" /><span>{{ option.label }}</span>
          </label>
        </fieldset>
        <p class="theme-current" role="status"><span>当前显示：{{ themeState.current === 'dark' ? '暗色模式' : '明亮模式' }}</span><span>{{ currentTheme.name }}</span></p>
        <div v-if="themeState.mode === 'schedule'" class="theme-schedule">
          <div class="schedule-times">
            <label class="field"><span>切换到明亮模式</span><input v-model="lightStart" class="control" type="time" step="60" required :aria-invalid="!valid" aria-describedby="schedule-help schedule-error" @input="updateTime" /></label>
            <label class="field"><span>切换到暗色模式</span><input v-model="darkStart" class="control" type="time" step="60" required :aria-invalid="!valid" aria-describedby="schedule-help schedule-error" @input="updateTime" /></label>
          </div>
          <p id="schedule-help" class="form-note">按此设备的本地时间自动切换，支持跨午夜。有效时间自动保存；手动选择明亮或暗色模式会停止自动切换。</p>
          <p v-if="!valid" id="schedule-error" class="error-message" role="alert">请输入两个不同的有效时间。当前仍按 {{ themeState.lightStart }} / {{ themeState.darkStart }} 切换。</p>
        </div>
      </div>
    </div>
    <p v-if="themeState.error" class="error-message settings-preference-footer" role="alert">{{ themeState.error }}</p>
    <div v-for="mode in (['light', 'dark'] as const)" :key="mode" class="theme-palette-group settings-preference-group">
      <h3 :id="`${mode}-theme-heading`" class="settings-preference-title"><component :is="mode === 'light' ? Sun : Moon" :size="16" aria-hidden="true" />{{ mode === 'light' ? '明亮模式主题' : '暗色模式主题' }}</h3>
      <fieldset class="theme-palettes" :aria-labelledby="`${mode}-theme-heading`"><legend class="settings-group-legend">{{ mode === 'light' ? '明亮模式使用的主题' : '暗色模式使用的主题' }}</legend>
        <label v-for="theme in appearance.themes.filter(item => item.mode === mode)" :key="theme.id" class="palette-option" :class="{ selected: themeState[mode] === theme.id }">
          <input type="radio" :name="`${mode}-palette`" :value="theme.id" :checked="themeState[mode] === theme.id" :aria-label="theme.name" @change="appearance.set({ [mode]: theme.id })" />
          <span class="theme-preview" :style="preview(theme)" aria-hidden="true"><span class="preview-paper" /><span class="preview-surface" /><span class="preview-soft" /><span class="preview-accent" /></span>
          <span class="palette-caption"><span>{{ theme.name }}<small v-if="theme.id === 'cloud' || theme.id === 'sage'">默认</small></span><Check v-if="themeState[mode] === theme.id" :size="16" aria-hidden="true" /></span>
        </label>
      </fieldset>
    </div>
    <p class="form-note theme-footnote settings-preference-footer">明暗主题分别记忆。自动模式会使用对应配色；同一浏览器的其他标签页也会同步更新。</p>
  </section>
</template>

<style scoped>
/* Hallmark · shape: app screen · genre: modern-minimal · theme: brand · redesign: full · signature: actual palette swatches · v2.0.0 */
/* Hallmark · pre-emit critique: P4 H4 E4 S3 R5 V3 · weakest: S, show the existing six community palettes instead of generic window drawings */
.theme-settings { width: 100%; max-width: var(--settings-form-width); container: settings-preferences / inline-size; border-bottom: 0; padding-bottom: 0; }
.theme-settings .section-heading { gap: var(--settings-space-group); margin-bottom: var(--settings-space-section); flex-wrap: wrap; }
.theme-settings .section-heading h2 { min-width: 0; overflow-wrap: break-word; text-wrap: balance; }
.theme-settings .section-heading .button { white-space: nowrap; }
.theme-settings .form-note { display: block; }
.theme-modes, .theme-palettes { border: 0; margin: 0; padding: 0; min-width: 0; display: grid; gap: var(--settings-space-row); grid-template-columns: repeat(2, minmax(0, 1fr)); }
.theme-modes { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--settings-space-related); }
.theme-mode-content { min-width: 0; }
.mode-option { position: relative; display: flex; align-items: center; justify-content: center; gap: var(--settings-space-related); min-height: var(--settings-control-height); padding: var(--settings-space-related); border: 1px solid transparent; border-radius: 6px; background: var(--surface); font-size: var(--font-size-field); white-space: nowrap; cursor: pointer; }
.mode-option:hover { background: var(--state-hover); }
.palette-option:hover { border-color: var(--state-selected-border); }
.mode-option.selected { background: var(--state-selected); border-color: var(--state-selected-border); color: var(--ink); }
.mode-option.selected:hover { background: var(--state-pressed); }
.mode-option input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.mode-option:has(:focus-visible), .palette-option:has(:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.mode-option input:focus-visible, .palette-option input:focus-visible { outline: none; }
.mode-option:active, .palette-option:active { background: var(--state-pressed); }
.theme-settings button:disabled, .theme-settings input:disabled { cursor: not-allowed; opacity: .55; }
.theme-current { display: flex; align-items: center; flex-wrap: wrap; gap: var(--settings-space-related); margin-block: var(--settings-space-related) 0; color: var(--muted); font-size: 12px; }
.theme-current > span + span { padding-inline-start: var(--settings-space-related); border-inline-start: 1px solid var(--border); }
.theme-schedule { margin-top: var(--settings-space-group); padding: var(--settings-space-group); background: var(--surface); border-radius: 6px; }
.schedule-times { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--settings-space-group); }
.schedule-times input { font-variant-numeric: tabular-nums; font-size: 16px; }
.theme-palette-group { margin-block-start: var(--settings-space-section); }
.theme-palettes { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--settings-space-group); }
.palette-option { position: relative; min-width: 0; border: 2px solid var(--border); border-radius: 8px; cursor: pointer; }
.palette-option.selected { color: var(--ink); border-color: var(--blue); }
.palette-option > input { position: absolute; width: 1px; height: 1px; margin: 0; opacity: 0; }
.palette-caption { display: flex; justify-content: space-between; align-items: center; gap: var(--settings-space-related); min-height: var(--settings-control-height); padding: var(--settings-space-related) var(--settings-space-row); font-size: 14px; white-space: nowrap; }
.palette-caption > span { display: flex; align-items: center; flex-wrap: wrap; gap: var(--settings-space-related); }
.palette-caption small { color: var(--muted); font-size: 12px; }
.palette-caption svg { color: var(--blue); }
.theme-preview { display: grid; grid-template-columns: minmax(0, 2fr) repeat(2, minmax(0, 1fr)) minmax(0, .65fr); height: 48px; background: var(--preview-bg); overflow: clip; border-radius: 6px 6px 0 0; }
.preview-paper { background: var(--preview-bg); }
.preview-surface { background: var(--preview-surface); }
.preview-soft { background: var(--preview-soft); }
.preview-accent { background: var(--preview-accent); }
.theme-footnote { margin-top: var(--settings-space-group); font-size: 12px; line-height: 20px; }
@container settings-preferences (max-width: 560px) {
  .theme-modes { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mode-option { justify-content: flex-start; padding-inline: var(--settings-space-row); }
  .theme-palettes { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--settings-space-row); }
  .schedule-times { grid-template-columns: 1fr; }
  .theme-schedule { padding: var(--settings-space-group); }
}
@media (forced-colors: active) { .palette-option.selected, .mode-option.selected { outline: 2px solid Highlight; } }
</style>
