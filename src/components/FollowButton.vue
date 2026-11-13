<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Check, Clock3, UserPlus, UsersRound } from '@lucide/vue'
import { errorMessage, session } from '../state'
import type { Creator } from '../data'
import { changeRelationship, followBusy, loadRelationship, relationships, seedRelationships, type Relationship } from '../following'

const props = defineProps<{ userId?: string; person?: Creator; author?: boolean }>()
const emit = defineEmits<{ changed: [value: Relationship] }>()
const route = useRoute(), error = ref(''), loading = ref(false), ready = ref(false)
const id = computed(() => props.person?.id || props.userId || '')
const relation = computed(() => relationships.get(id.value))
const busy = computed(() => loading.value || followBusy.size > 0)
const label = computed(() => relation.value?.followed ? '取消关注' : relation.value?.requested ? '撤回关注申请' : props.author ? '关注作者' : '关注')
let controller: AbortController | undefined
async function load() {
  controller?.abort(); error.value = ''; loading.value = false; ready.value = false
  if (!id.value || !session.user || id.value === session.user.id) return
  if (props.person) {
    if (!relationships.has(id.value)) seedRelationships([props.person])
    ready.value = true
    return
  }
  const active = new AbortController(); controller = active; loading.value = true
  try { await loadRelationship(id.value, active.signal); if (!active.signal.aborted) ready.value = true }
  catch (cause) { if (!active.signal.aborted) error.value = errorMessage(cause) }
  finally { if (controller === active) loading.value = false }
}
async function toggle() {
  if (busy.value) return
  if (!ready.value || !relation.value) { await load(); return }
  const owner = session.user?.id, target = id.value
  error.value = ''
  try {
    const result = await changeRelationship(target, !(relation.value.followed || relation.value.requested))
    if (result && owner === session.user?.id && target === id.value) emit('changed', result)
  } catch (cause) { if (owner === session.user?.id && target === id.value) error.value = errorMessage(cause) }
}
watch([id, () => session.user?.id], load, { immediate: true })
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <div v-if="id && id !== session.user?.id" class="follow-control">
    <RouterLink v-if="!session.user" :to="{ path: '/account', query: { returnTo: route.fullPath } }" class="button btn follow-button" :aria-label="author ? '关注作者' : '关注'"><UserPlus :size="16" aria-hidden="true" />{{ author ? '关注作者' : '关注' }}</RouterLink>
    <button v-else type="button" class="button btn follow-button" :class="{ subtle: relation?.followed || relation?.requested }" :disabled="busy" :aria-busy="busy" :aria-pressed="Boolean(relation?.followed)" :aria-label="!ready && error ? '重试关注状态' : label" @click="toggle">
      <component :is="relation?.requested ? Clock3 : relation?.followed ? relation?.followsYou ? UsersRound : Check : UserPlus" :size="16" aria-hidden="true" />
      {{ busy ? '请稍候…' : !ready && error ? '重试' : relation?.requested ? '等待通过' : relation?.followed ? relation?.followsYou ? '互相关注' : '已关注' : author ? '关注作者' : '关注' }}
    </button>
    <p v-if="error" class="follow-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.follow-control { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 8px; min-width: 0; }
.follow-button { min-height: 44px; white-space: nowrap; }
.follow-error { margin: 0; max-width: 24ch; color: var(--danger); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
</style>
