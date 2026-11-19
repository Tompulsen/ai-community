<script setup lang="ts">
import { Keyboard } from '@lucide/vue'
import { studioPreferences, updateStudioPreferences } from '../studio-preferences'
import { SUBMIT_KEYS, type SubmitKey } from '../../shared/studio/submit-key'
import { errorMessage, notify } from '../state'
function change(event: Event) {
  const select = event.target as HTMLSelectElement
  try { updateStudioPreferences({ submitKey: select.value as SubmitKey }) }
  catch (cause) { select.value = studioPreferences.submitKey; notify(errorMessage(cause)) }
}
</script>
<template>
  <label class="submit-preference"><Keyboard :size="16" aria-hidden="true" /><span>发送方式</span><select :value="studioPreferences.submitKey" class="select-control" aria-label="发送方式" @change="change"><option v-for="key in SUBMIT_KEYS" :key="key" :value="key">{{ key.replace('+', ' + ') }}</option></select></label>
</template>
<style scoped>
.submit-preference { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 8px; font-size: 14px; }
svg { flex: none; color: var(--muted); }
span { white-space: nowrap; }
select { margin-left: auto; width: auto; min-width: 0; min-height: var(--control-size, var(--control-height)); padding: var(--control-padding, 8px 12px); border: 0; border-radius: 6px; color: var(--ink); background: var(--surface-soft); font-family: inherit; font-size: var(--control-font-size, var(--font-size-input)); line-height: var(--control-line-height, 24px); }
select:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
option { background: var(--surface); }
</style>
