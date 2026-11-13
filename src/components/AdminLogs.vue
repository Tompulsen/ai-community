<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowUpRight, ClipboardList, RefreshCw, Search } from '@lucide/vue'
import { api, errorMessage, queryString, session } from '../state'

interface LogEntry { id: string; type: string; label: string; date: string | null; actor: { id: string; name: string; username: string }; details: { label: string; value: string }[]; target?: { label: string; to: string } }
function localDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
const today = new Date(), monthAgo = new Date(today); monthAgo.setDate(today.getDate() - 29)
const actor = ref(''), type = ref(''), from = ref(localDate(monthAgo)), to = ref(localDate(today))
const items = ref<LogEntry[]>([]), types = ref<{ value: string; label: string }[]>([]), nextCursor = ref<string | null>(null)
const loading = ref(false), error = ref('')
let generation = 0, applied = { actor: '', type: '', from: '', to: '' }
async function search() {
  const start = new Date(`${from.value}T00:00:00`), end = new Date(`${to.value}T00:00:00`)
  end.setDate(end.getDate() + 1)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) { error.value = '请选择有效的起止日期。'; return }
  applied = { actor: actor.value.trim(), type: type.value, from: start.toISOString(), to: end.toISOString() }
  await load()
}
async function load(more = false) {
  const current = ++generation, owner = session.user?.id
  loading.value = true; error.value = ''
  if (!more) { items.value = []; nextCursor.value = null }
  try {
    const data = await api<{ items: LogEntry[]; types: typeof types.value; nextCursor: string | null }>('/api/admin/logs' + queryString({ ...applied, cursor: more ? nextCursor.value || undefined : undefined }))
    if (current !== generation || session.user?.id !== owner) return
    items.value = more ? [...items.value, ...data.items] : data.items; nextCursor.value = data.nextCursor; types.value = data.types
  } catch (cause) { if (current === generation) error.value = errorMessage(cause) }
  finally { if (current === generation) loading.value = false }
}
onMounted(search)
onBeforeUnmount(() => { generation++ })
</script>

<template>
  <section class="panel-section admin-logs" :aria-busy="loading">
    <div class="section-heading"><div><h2>操作日志</h2><p class="form-note">追溯审核、账号处理与设置变更。</p></div><button class="button subtle btn" :disabled="loading" @click="load()"><RefreshCw :size="16" aria-hidden="true" />刷新</button></div>
    <form class="log-filters" @submit.prevent="search"><label class="field"><span>操作类型</span><select v-model="type" class="control"><option value="">全部操作</option><option v-for="option in types" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label class="field"><span>操作人</span><input v-model="actor" class="control" type="search" maxlength="120" placeholder="账号、昵称或 ID" /></label><label class="field"><span>开始日期</span><input v-model="from" class="control" type="date" required /></label><label class="field"><span>结束日期</span><input v-model="to" class="control" type="date" required /></label><button class="button btn" :disabled="loading"><Search :size="16" aria-hidden="true" />筛选</button></form>
    <p class="form-note">日期和时间按当前设备时区显示，每次最多查询一年。</p>
    <p v-if="error" class="form-error" role="alert">{{ error }} <button class="text-link" :disabled="loading" @click="load(!!items.length)">重试</button></p>
    <p v-if="loading && !items.length" role="status" class="log-loading">正在加载操作日志…</p>
    <ol v-if="items.length" class="log-list"><li v-for="item in items" :key="item.id"><div class="log-meta"><time v-if="item.date" :datetime="item.date">{{ new Date(item.date).toLocaleString('zh-CN') }}</time><span v-else>时间不可用</span><strong>{{ item.actor.name }}</strong><span v-if="item.actor.username">@{{ item.actor.username }}</span></div><div class="log-content"><h3>{{ item.label }}</h3><dl v-if="item.details.length"><div v-for="detail in item.details" :key="detail.label"><dt>{{ detail.label }}</dt><dd>{{ detail.value }}</dd></div></dl><p v-else class="form-note">已记录此管理操作。</p><span class="log-id">记录编号 {{ item.id }}</span></div><RouterLink v-if="item.target" :to="item.target.to" class="text-link log-target">{{ item.target.label }}<ArrowUpRight :size="16" aria-hidden="true" /></RouterLink></li></ol>
    <div v-else-if="!loading && !error" class="empty-state"><ClipboardList :size="28" aria-hidden="true" /><h3>没有匹配的操作记录</h3><p>可以调整操作人、类型或日期范围。</p></div>
    <div v-if="nextCursor" class="log-pagination"><button class="button btn" :disabled="loading" @click="load(true)">{{ loading ? '正在加载…' : '加载更早记录' }}</button></div>
  </section>
</template>

<style scoped>
.admin-logs { padding-top: 0; }
.section-heading .form-note { margin-top: 8px; }
.log-filters { display: grid; grid-template-columns: 1fr 1.3fr 1fr 1fr auto; gap: 12px; align-items: end; margin-block: 24px 12px; }
.log-filters > * { min-width: 0; }
.log-list { list-style: none; margin: 24px 0 0; padding: 0; }
.log-list > li { display: grid; grid-template-columns: 180px minmax(0, 1fr) auto; gap: 24px; padding-block: 24px; border-top: 1px solid var(--border); }
.log-meta { display: grid; align-content: start; gap: 8px; overflow-wrap: anywhere; font-size: 12px; color: var(--muted); }
.log-meta strong { font-size: 14px; font-weight: 500; color: var(--ink); }
.log-content { min-width: 0; overflow-wrap: anywhere; }
.log-content h3 { font-size: 16px; font-weight: 500; margin-bottom: 12px; }
.log-content dl { display: grid; gap: 8px; margin: 0 0 12px; font-size: 14px; line-height: 24px; }
.log-content dl > div { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 12px; }
.log-content dt, .log-id { color: var(--muted); }
.log-content dd { margin: 0; white-space: pre-wrap; }
.log-id { font-size: 12px; }
.log-target { display: inline-flex; align-items: center; gap: 4px; align-self: start; min-height: 44px; }
.log-loading, .log-pagination { padding-block: 24px; text-align: center; }
@media (max-width: 1199px) { .log-filters { grid-template-columns: 1fr 1fr; } .log-filters > button { justify-self: start; } .log-list > li { grid-template-columns: 160px minmax(0, 1fr); } .log-target { grid-column: 2; } }
@media (max-width: 639px) { .log-list > li { grid-template-columns: minmax(0, 1fr); gap: 16px; } .log-target { grid-column: 1; } .log-meta { grid-template-columns: 1fr auto; } .log-meta time { grid-column: 1 / -1; } }
</style>
