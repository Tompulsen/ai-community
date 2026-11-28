<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clearBrowserStorageFailure, clearOwnerThumbnailCache, formatStorageBytes, readMediaStorageInventory, refreshBrowserStorage, type BrowserStorageEstimate, type MediaStorageInventory } from '../browser-storage'

const props = defineProps<{ owner?: string; recovery?: boolean }>()
const estimate = ref<BrowserStorageEstimate>(), inventory = ref<MediaStorageInventory>()
const selectedOwner = ref(props.owner || ''), reading = ref(false), cleaning = ref(false), confirmation = ref(false)
const error = ref(''), notice = ref('')
const cleanupButton = ref<HTMLButtonElement>(), confirmButton = ref<HTMLButtonElement>(), resultMessage = ref<HTMLElement>()
let revision = 0, active = true
const isBusy = computed(() => reading.value || cleaning.value)
const canClean = computed(() => !!selectedOwner.value && !!inventory.value?.canClean && (inventory.value?.counts.previews || 0) > 0 && !isBusy.value)
const scopeLabel = computed(() => selectedOwner.value ? `账号 ${selectedOwner.value}` : '此浏览器全部本地账号')
function count(value: number | null | undefined) { return value === null || value === undefined ? '暂无法读取' : value.toLocaleString() }
function recheck() { clearBrowserStorageFailure(); void inspect() }
async function beginClean() { confirmation.value = true; await nextTick(); confirmButton.value?.focus() }
async function cancelClean() { confirmation.value = false; await nextTick(); cleanupButton.value?.focus() }
async function inspect() {
  const current = ++revision
  reading.value = true; error.value = ''; confirmation.value = false; inventory.value = undefined
  const results = await Promise.allSettled([refreshBrowserStorage(true), readMediaStorageInventory(selectedOwner.value || undefined)])
  if (!active || current !== revision) return
  const [capacity, media] = results
  if (capacity.status === 'fulfilled') estimate.value = capacity.value
  if (media.status === 'fulfilled') inventory.value = media.value
  else error.value = media.reason instanceof Error ? media.reason.message : '暂时无法读取本地媒体存储，请稍后重试。'
  reading.value = false
}
async function clean() {
  if (!canClean.value || !confirmation.value) return
  const owner = selectedOwner.value
  cleaning.value = true; error.value = ''; notice.value = ''
  try {
    const removed = await clearOwnerThumbnailCache(owner)
    if (!active) return
    notice.value = `已清理账号 ${owner} 的 ${removed} 条缩略图缓存。原图、聊天、草稿及其他账号数据均保留。`
    await inspect()
  } catch (cause) {
    if (active) error.value = cause instanceof Error ? cause.message : '缩略图清理未完成，请重新检测。'
  } finally {
    if (active) {
      cleaning.value = false; confirmation.value = false
      await nextTick(); resultMessage.value?.focus()
    }
  }
}
watch(() => props.owner, value => { selectedOwner.value = value || '' })
watch(selectedOwner, () => { notice.value = ''; void inspect() })
onMounted(() => void inspect())
onBeforeUnmount(() => { active = false; revision++ })
</script>

<template>
  <section class="browser-storage-panel" aria-labelledby="browser-storage-title" :aria-busy="isBusy">
    <div class="storage-heading"><div><h2 id="browser-storage-title">浏览器存储</h2><p>查看本站在当前浏览器中的存储使用情况。</p></div><button type="button" :disabled="isBusy" @click="recheck">{{ reading ? '正在检测…' : '重新检测' }}</button></div>
    <dl class="storage-metrics" aria-live="polite"><div><dt>本站已用空间（估算）</dt><dd>{{ formatStorageBytes(estimate?.usage ?? null) }}</dd></div><div><dt>浏览器提供的配额（估算）</dt><dd>{{ formatStorageBytes(estimate?.quota ?? null) }}</dd></div></dl>
    <p class="storage-note">容量为本站整个来源的浏览器估算，包含同源下不同账号的数据；不是运行内存或设备剩余磁盘空间。配额会变化，低于提醒阈值也不保证保存一定成功。</p>
    <p v-if="estimate?.pressure === 'strong'" class="storage-warning" role="status">已使用至少 1 GiB，或达到浏览器估算配额的 90%。建议先下载重要原图，再整理本地缓存。</p>
    <p v-else-if="estimate?.pressure === 'mild'" class="storage-warning" role="status">已使用至少 500 MiB，建议定期下载重要原图并检查存储。</p>
    <p v-else-if="estimate?.pressure === 'unknown'" class="storage-note" role="status">浏览器未提供有效容量数据，当前用量未知。仍可尝试查看下方记录数量。</p>
    <div class="storage-divider">
      <h3>本地媒体记录</h3>
      <label v-if="recovery" class="storage-owner">选择要整理的本地账号<select v-model="selectedOwner" :disabled="isBusy" aria-describedby="storage-owner-help"><option value="">请选择账号（当前显示全部记录）</option><option v-for="account in inventory?.owners || (selectedOwner ? [selectedOwner] : [])" :key="account" :value="account">账号 {{ account }}</option></select></label>
      <p v-if="recovery" id="storage-owner-help" class="storage-note">只显示这台设备保存的账号标识，不读取登录会话。清理前请确认账号；不会处理其他账号的数据。</p>
      <p class="storage-scope">统计范围：{{ scopeLabel }}</p>
      <dl class="storage-counts"><div><dt>创作记录</dt><dd>{{ count(inventory?.counts.tasks) }}</dd></div><div><dt>原图与媒体索引</dt><dd>{{ count(inventory?.counts.originals) }}</dd></div><div><dt>缩略图缓存</dt><dd>{{ count(inventory?.counts.previews) }}</dd></div></dl>
      <p v-if="inventory && !inventory.databaseExists" class="storage-note">此浏览器尚无本地媒体数据库。聊天、草稿等可能存储在其他位置，此处不读取。</p>
      <p class="storage-note">清理只删除所选账号的缩略图缓存，不删除原图、视频、创作记录、聊天或草稿。预览会在原图仍可读取时按需重建；原图丢失或远程链接失效时，预览可能无法重建。原图占用仍会保留，清理不保证页面完全恢复或立即释放运行内存。</p>
      <div v-if="confirmation" class="storage-confirmation" role="group" aria-label="确认清理缩略图"><p>确认清理账号 {{ selectedOwner }} 的 {{ count(inventory?.counts.previews) }} 条缩略图缓存？</p><div class="storage-actions"><button ref="confirmButton" type="button" :disabled="isBusy" @click="clean">{{ cleaning ? '正在清理…' : '确认清理缩略图' }}</button><button type="button" :disabled="isBusy" @click="cancelClean">取消</button></div></div>
      <button v-else ref="cleanupButton" type="button" :disabled="!canClean" @click="beginClean">清理所选账号的缩略图缓存</button>
      <p v-if="notice || error" ref="resultMessage" :class="error ? 'storage-error' : 'storage-success'" :role="error ? 'alert' : 'status'" tabindex="-1">{{ error || notice }}</p>
    </div>
    <nav class="storage-actions storage-divider" aria-label="存储管理入口"><a href="/library">进入作品库下载重要原图</a><a v-if="!recovery" href="/storage-recovery">打开独立恢复页</a><a v-else href="/">返回社区</a></nav>
    <p class="storage-note">作品库需要正常加载社区，可能需要登录。下载作品不等于备份聊天或草稿；请勿直接清空浏览器站点数据。</p>
  </section>
</template>

<style scoped>
.browser-storage-panel { max-width: 912px; width: 100%; color: var(--ink, #182332); font-size: 15px; line-height: 1.65; overflow-wrap: anywhere; }
.storage-heading { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px; justify-content: space-between; }
.storage-heading h2, .browser-storage-panel h3 { margin: 0; line-height: 1.4; }
.storage-heading h2 { font-size: 24px; }.browser-storage-panel h3 { font-size: 18px; margin-bottom: 16px; }
.browser-storage-panel p { margin: 8px 0 16px; }.storage-note { color: var(--muted, #566272); font-size: 14px; }
.storage-metrics, .storage-counts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 12px; margin: 20px 0; }
.storage-metrics > div, .storage-counts > div { min-width: 0; padding: 16px; border: 1px solid var(--border, #d5dce4); border-radius: 12px; background: var(--surface-soft, #f4f6f9); }
.storage-metrics dt, .storage-counts dt { color: var(--muted, #566272); font-size: 13px; }.storage-metrics dd, .storage-counts dd { font-size: 21px; font-weight: 600; margin: 8px 0 0; }
.storage-divider { margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--border, #d5dce4); }
.storage-owner { display: grid; gap: 8px; max-width: 100%; }.storage-owner select { width: 100%; }
.storage-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.browser-storage-panel button, .browser-storage-panel a, .browser-storage-panel select { min-height: 44px; max-width: 100%; border: 1px solid var(--border, #c7d0dc); border-radius: 8px; padding: 9px 14px; background: var(--surface, #fff); color: inherit; font: inherit; line-height: 1.5; }
.browser-storage-panel button, .browser-storage-panel a { display: inline-flex; align-items: center; justify-content: center; cursor: pointer; text-align: center; white-space: normal; text-decoration: none; }
.browser-storage-panel :focus-visible { outline: 2px solid var(--focus-ring, #3659b8); outline-offset: 3px; }
.browser-storage-panel button:disabled { opacity: .5; cursor: not-allowed; }
.storage-warning, .storage-confirmation { border-left: 3px solid currentColor; padding: 12px 16px; background: var(--surface-soft, #f4f6f9); }
.storage-confirmation p { margin-top: 0; }.storage-error { color: var(--danger, #a42628); }.storage-success { font-weight: 600; }
</style>
