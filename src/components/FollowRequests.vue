<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { Check, X, UserPlus, RefreshCw } from '@lucide/vue'
import { api, errorMessage, queryString, session } from '../state'
import { rememberRelationship, type Relationship } from '../following'

interface RequestItem { id: string; user: { id: string; name: string; username: string; accountId?: string; avatarUrl?: string } }
const direction = ref<'received' | 'sent'>('received'), items = ref<RequestItem[]>([]), cursor = ref<string | null>(null)
const loading = ref(false), busy = ref(''), error = ref(''), total = ref(0), status = ref('')
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
    cursor.value = result.nextCursor; total.value = result.total
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
onBeforeUnmount(() => { generation++; controller?.abort(); mutation?.abort() })
</script>

<template>
  <section class="panel-section request-settings">
    <div class="section-heading"><div><h2>关注申请</h2><p class="form-note">管理收到的关注请求，也可以撤回仍在等待的申请。</p></div><button type="button" class="icon-button" aria-label="刷新关注申请" :disabled="loading || !!busy" @click="load()"><RefreshCw :size="18" /></button></div>
    <nav class="tabs" aria-label="关注申请分类"><button type="button" class="tab" :class="{ active: direction === 'received' }" :aria-pressed="direction === 'received'" :disabled="!!busy" @click="direction = 'received'">收到的申请</button><button type="button" class="tab" :class="{ active: direction === 'sent' }" :aria-pressed="direction === 'sent'" :disabled="!!busy" @click="direction = 'sent'">发出的申请</button></nav>
    <p v-if="!loading" class="form-note">{{ total }} 条待处理申请</p>
    <p v-if="error" class="error-message" role="alert">{{ error }} <button type="button" class="text-link" :disabled="!!busy" @click="load()">重新加载</button></p>
    <p v-if="status" role="status">{{ status }}</p>
    <p v-if="loading && !items.length" role="status">正在加载关注申请…</p>
    <div v-else-if="!items.length && !error" class="empty-state"><UserPlus :size="28" aria-hidden="true" /><h3>{{ direction === 'received' ? '暂无待处理的关注申请' : '暂无等待通过的申请' }}</h3><RouterLink to="/community?tab=creators" class="text-link">发现创作者</RouterLink></div>
    <div class="request-list"><article v-for="item in items" :key="item.id" class="request-row">
      <RouterLink :to="{ path: '/community', query: { creator: item.user.id } }" class="request-person"><span class="avatar blue"><img v-if="item.user.avatarUrl" :src="item.user.avatarUrl" :alt="item.user.name" /><span v-else>{{ (item.user.name || item.user.username).slice(0, 1) }}</span></span><span><strong>{{ item.user.name || item.user.username }}</strong><small>账号 ID：{{ item.user.accountId || item.user.id }}</small></span></RouterLink>
      <div class="request-actions"><template v-if="direction === 'received'"><button class="button btn primary" :disabled="!!busy || loading" @click="resolve(item, 'accept')"><Check :size="16" aria-hidden="true" />通过</button><button class="button btn subtle" :disabled="!!busy || loading" @click="resolve(item, 'reject')"><X :size="16" aria-hidden="true" />拒绝</button></template><button v-else class="button btn subtle" :disabled="!!busy || loading" @click="resolve(item, 'cancel')">撤回申请</button></div>
    </article></div>
    <button v-if="cursor" class="button btn" :disabled="loading || !!busy" @click="load(true)">{{ loading ? '正在加载…' : '加载更多申请' }}</button>
    <p class="form-note request-help">审批规则可在<RouterLink to="/account?tab=privacy" class="text-link">关注与隐私</RouterLink>中设置。</p>
  </section>
</template>

<style scoped>
.request-settings { max-width: 860px; }
.request-list { display: grid; }
.request-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 0; border-bottom: 1px solid var(--border); }
.request-person { display: flex; align-items: center; gap: 12px; min-width: 0; }
.request-person > span:last-child { display: grid; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.request-person small { font-size: 12px; color: var(--muted); }
.request-actions { display: flex; flex-wrap: wrap; gap: 8px; flex-shrink: 0; }
.request-actions button { min-height: 44px; }
.request-help { margin-top: 24px; }
@media (max-width: 520px) { .request-row { align-items: flex-start; flex-direction: column; } .request-actions { align-self: flex-end; } }
</style>
