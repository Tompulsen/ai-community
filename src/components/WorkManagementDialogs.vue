<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Trash2, X } from '@lucide/vue'
import type { Work } from '../data'
import { api, canManageWork, errorMessage, notify, session } from '../state'
import WorkEditor from './WorkEditor.vue'

const props = defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ saved: [work: Work]; deleted: [work: Work] }>()
const route = useRoute(), router = useRouter()
const selected = ref<Work | null>(null), editing = ref(false), busy = ref(false), error = ref('')
const deleteDialog = ref<HTMLDialogElement>()
let generation = 0
function reset() { generation++; editing.value = false; selected.value = null; busy.value = false; error.value = ''; deleteDialog.value?.close() }
watch([() => session.user?.id, () => session.user?.isAdmin, () => route.fullPath], reset, { flush: 'sync' })
const removeGuard = router.beforeEach(() => !busy.value)
onBeforeUnmount(() => { generation++; removeGuard() })
function edit(work: Work) {
  if (props.disabled || busy.value || !canManageWork(work)) return
  selected.value = work; error.value = ''; editing.value = true
}
function remove(work: Work) {
  if (props.disabled || busy.value || !canManageWork(work)) return
  selected.value = work; error.value = ''; deleteDialog.value?.showModal()
}
async function deleteSelected() {
  const work = selected.value, owner = session.user?.id, current = generation
  if (!work || props.disabled || busy.value || !canManageWork(work)) return
  const active = () => current === generation && owner === session.user?.id && canManageWork(work)
  busy.value = true; error.value = ''
  try {
    await api(`/api/works/${encodeURIComponent(work.id)}`, { method: 'DELETE', expectedAccount: owner, body: { version: work.version } })
    if (!active()) return
    deleteDialog.value?.close(); emit('deleted', work); notify('作品已删除。')
  } catch (cause) { if (active()) error.value = errorMessage(cause) }
  finally { if (active()) busy.value = false }
}
defineExpose({ edit, remove, busy })
</script>
<template>
  <WorkEditor :open="editing" :work="selected" @close="editing = false" @saved="emit('saved', $event)" />
  <dialog ref="deleteDialog" class="compact-dialog" aria-labelledby="managed-work-delete-heading" @cancel="busy && $event.preventDefault()">
    <div class="dialog-heading"><h2 id="managed-work-delete-heading">删除这件作品？</h2><button type="button" class="icon-button" aria-label="关闭删除确认" :disabled="busy" @click="deleteDialog?.close()"><X :size="20" aria-hidden="true" /></button></div>
    <form class="dialog-body stack" @submit.prevent="deleteSelected">
      <p class="work-delete-title">《{{ selected?.title }}》删除后无法恢复。</p>
      <p v-if="selected && selected.authorId !== session.user?.id" class="form-note">你正在以管理员身份删除 {{ selected.author }} 的作品。</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="dialog-footer"><span></span><div><button type="button" class="button subtle btn" :disabled="busy" autofocus @click="deleteDialog?.close()">取消</button><button type="submit" class="button danger btn" :disabled="busy"><Trash2 :size="16" aria-hidden="true" />{{ busy ? '正在删除…' : '确认删除' }}</button></div></div>
    </form>
  </dialog>
</template>
<style scoped>
.work-delete-title { overflow-wrap: anywhere; }
.dialog-footer button { min-height: 44px; }
</style>
