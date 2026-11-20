<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, X, RefreshCw } from '@lucide/vue'
import { api, errorMessage, queryString, session } from '../state'
import { rememberRelationship, type Relationship } from '../following'

interface RequestItem { id: string; user: { id: string; name: string; username: string; accountId?: string; avatarUrl?: string } }
const direction = ref<'received' | 'sent'>('received'), items = ref<RequestItem[]>([]), cursor = ref<string | null>(null)
const loading = ref(false), busy = ref(''), error = ref(''), total = ref(0), status = ref('')
const element = ref<HTMLElement>()
let controller: AbortController | undefined, mutation: AbortController | undefined, generation = 0
async function load(append = false) {
  controller?.abort(); const active = new AbortController(); controller = active; const current = ++generation
  loading.value = true; error.value = ''
  if (!append) { items.value = []; cursor.value = null; total.value = 0 }
  if (!session.user) { loading.value = false; return }
  try {
    const result = await api<{ items: RequestItem[]; nextCursor: string | null; total: number }>(`/api/follow-requests${queryString({ direction: direction.value, cursor: append ? cursor.value || undefined : undefined })}`, { signal: active.signal })
    if (current !== generation) return
    items.value = append ? [...items.value, ...result.items.filter(item => !items.value.some(old => old.id === item.id))] : result.items
    cursor.value = result.nextCursor; total.value = result.total ?? result.items.length
  } catch (cause) { if (!active.signal.aborted) error.value = errorMessage(cause) }
  finally { if (current === generation) loading.value = false }
}
async function resolve(item: RequestItem, action: 'accept' | 'reject' | 'cancel') {
  if (busy.value || loading.value) return
  const current = generation, owner = session.user?.id, active = new AbortController(); mutation = active
  busy.value = item.id; error.value = ''; status.value = ''
  try {
    const result = await api<Relationship>(`/api/follow-requests/${encodeURIComponent(item.id)}`, { method: 'POST', body: { action }, signal: active.signal, expectedAccount: session.user?.accountId || owner })
    if (current !== generation || owner !== session.user?.id) return
    rememberRelationship(result); items.value = items.value.filter(row => row.id !== item.id); total.value = Math.max(0, total.value - 1)
    status.value = action === 'accept' ? '关注申请已通过。' : action === 'reject' ? '已拒绝这条关注申请。' : '关注申请已撤回。'
  } catch (cause) { if (!active.signal.aborted && current === generation) error.value = errorMessage(cause) }
  finally { if (mutation === active) { busy.value = ''; mutation = undefined } }
}
watch([direction, () => session.user?.id], () => { mutation?.abort(); mutation = undefined; busy.value = ''; status.value = ''; void load() }, { immediate: true })
async function showReceived() {
  if (!busy.value) {
    if (direction.value !== 'received') direction.value = 'received'
    else void load()
  }
  await nextTick()
  element.value?.focus({ preventScroll: true }); element.value?.scrollIntoView({ block: 'nearest' })
}
function refresh() { if (!busy.value) void load() }
defineExpose({ refresh, showReceived })
onBeforeUnmount(() => { generation++; controller?.abort(); mutation?.abort() })
</script>

<template>
  <section ref="element" class="panel-section request-settings" aria-label="关注申请" tabindex="-1">
    <div class="section-heading"><h2>关注申请</h2><button type="button" class="icon-button" aria-label="刷新关注申请" :disabled="loading || !!busy" @click="load()"><RefreshCw :size="18" /></button></div>
    <nav class="tabs" aria-label="关注申请分类"><button type="button" class="tab" :class="{ active: direction === 'received' }" :aria-pressed="direction === 'received'" :disabled="!!busy" @click="direction = 'received'">收到的申请</button><button type="button" class="tab" :class="{ active: direction === 'sent' }" :aria-pressed="direction === 'sent'" :disabled="!!busy" @click="direction = 'sent'">发出的申请</button></nav>
    <p v-if="!loading && total" class="form-note">{{ total }} 条待处理申请</p>
    <p v-if="error" class="error-message" role="alert">{{ error }} <button type="button" class="text-link" :disabled="!!busy" @click="load()">重新加载</button></p>
    <p v-if="status" role="status">{{ status }}</p>
    <p v-if="loading && !items.length" role="status">正在加载关注申请…</p>
    <div v-else-if="!items.length && !error" class="empty-state"><h3>{{ direction === 'received' ? '暂无待处理的关注申请' : '暂无等待通过的申请' }}</h3></div>
    <div class="request-list"><article v-for="item in items" :key="item.id" class="request-row">
      <RouterLink :to="{ path: '/community', query: { creator: item.user.id } }" class="request-person"><span class="avatar blue"><img v-if="item.user.avatarUrl" :src="item.user.avatarUrl" :alt="item.user.name" /><span v-else>{{ (item.user.name || item.user.username).slice(0, 1) }}</span></span><span><strong>{{ item.user.name || item.user.username }}</strong><small v-if="item.user.accountId">章鱼号：{{ item.user.accountId }}</small></span></RouterLink>
      <div class="request-actions"><template v-if="direction === 'received'"><button class="button btn primary" :disabled="!!busy || loading" @click="resolve(item, 'accept')"><Check :size="16" aria-hidden="true" />通过</button><button class="button btn subtle" :disabled="!!busy || loading" @click="resolve(item, 'reject')"><X :size="16" aria-hidden="true" />拒绝</button></template><button v-else class="button btn subtle" :disabled="!!busy || loading" @click="resolve(item, 'cancel')">撤回申请</button></div>
    </article></div>
    <button v-if="cursor" class="button btn" :disabled="loading || !!busy" @click="load(true)">{{ loading ? '正在加载…' : '加载更多申请' }}</button>
  </section>
</template>

<style scoped>
.request-settings { max-width: 100%; padding: 16px; }
.request-settings .section-heading { margin-bottom: 12px; }
.request-settings .tabs { margin-block: 0 12px; }
.request-settings .empty-state { min-height: 0; padding-block: 20px; gap: 8px; }
.request-settings .empty-state h3 { font-size: 14px; font-weight: 400; color: var(--muted); }
.request-list { display: grid; }
.request-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 0; border-bottom: 1px solid var(--border); }
.request-person { display: flex; align-items: center; gap: 12px; min-width: 0; }
.request-person > span:last-child { display: grid; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.request-person small { font-size: 12px; color: var(--muted); }
.request-actions { display: flex; flex-wrap: wrap; gap: 8px; flex-shrink: 0; }
.request-actions button { min-height: 44px; }
@media (max-width: 520px) { .request-row { align-items: flex-start; flex-direction: column; } .request-actions { align-self: flex-end; } }
</style>
