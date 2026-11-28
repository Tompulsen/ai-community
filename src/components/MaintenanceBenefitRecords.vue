<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { MaintenanceRecord } from '../../shared/maintenance-benefits'
import { api, errorMessage, session } from '../state'
const items = ref<MaintenanceRecord[]>([]), cursor = ref<string | null>(null), loading = ref(false), error = ref('')
let revision = 0, controller: AbortController | undefined
async function load(more = false) {
  const user = session.user
  if (!user) return
  const request = ++revision; controller?.abort(); controller = new AbortController()
  loading.value = true; error.value = ''
  try {
    const value = await api<{ items: MaintenanceRecord[]; nextCursor: string | null }>('/api/maintenance-benefit/records' + (more && cursor.value ? `?cursor=${cursor.value}` : ''), { expectedAccount: user.id, signal: controller.signal })
    if (request !== revision || session.user !== user) return
    if (!Array.isArray(value.items)) throw new Error('暂时无法读取维护福利记录，请稍后刷新。')
    items.value = more ? [...items.value, ...value.items] : value.items; cursor.value = value.nextCursor
  } catch (cause) { if (request === revision) error.value = errorMessage(cause) }
  finally { if (request === revision) loading.value = false }
}
watch(() => `${session.user?.id}:${session.user?.accountId}`, () => { revision++; controller?.abort(); items.value = []; cursor.value = null; void load() }, { immediate: true })
onBeforeUnmount(() => { revision++; controller?.abort() })
</script>
<template>
  <section v-if="session.user" class="maintenance-records" aria-labelledby="maintenance-records-title">
    <header><h3 id="maintenance-records-title">维护福利领取记录</h3><button class="button" :disabled="loading" @click="load()">刷新维护福利</button></header>
    <p v-if="loading" role="status">正在核对领取记录…</p><p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="!loading && !error && !items.length" class="muted">暂无维护福利领取记录。</p>
    <article v-for="item in items" :key="item.id"><h4>{{ item.title }}</h4><strong>{{ item.claim.credits }} 限时福利积分</strong>
      <p>{{ item.claim.status === 'fulfilled' ? '已到账' : item.claim.status === 'blocked' ? '等待管理员核对' : '发放中' }} · 到账后 {{ item.claim.rewardValidityDays }} 天有效</p>
      <p class="muted">领取时间：{{ new Date(item.claimedAt).toLocaleString('zh-CN') }}<br v-if="item.claim.expiresAt" /><span v-if="item.claim.expiresAt">有效至：{{ new Date(item.claim.expiresAt * 1000).toLocaleString('zh-CN') }}</span></p>
      <p v-if="item.claim.status !== 'fulfilled'" class="muted">领取记录已保存，无需重复领取。可刷新状态或联系管理员核对。</p>
    </article><button v-if="cursor" class="button" :disabled="loading" @click="load(true)">更多维护福利记录</button>
  </section>
</template>
<style scoped>
.maintenance-records { margin-block: 24px; padding: 20px; border: 1px solid var(--border); border-radius: var(--radius); min-width: 0; }.maintenance-records header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }.maintenance-records h3 { margin: 0; }.maintenance-records article { padding-block: 16px; border-top: 1px solid var(--border); margin-top: 16px; overflow-wrap: anywhere; }.maintenance-records h4 { margin: 0 0 10px; }.maintenance-records p { line-height: 1.7; }.maintenance-records button { min-height: 44px; }.maintenance-records button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
</style>
