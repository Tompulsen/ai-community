<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowUpRight, Bookmark, Images, LayoutGrid, List, Pencil, Plus, Search, Trash2, X } from '@lucide/vue'
import WorkCard from '../components/WorkCard.vue'
import WorkEditor from '../components/WorkEditor.vue'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import { kindLabels, statusLabels, type Work } from '../data'
import { api, errorMessage, filterWorks, loadSession, notify, queryString, session } from '../state'

const route = useRoute()
const tabs = [{ value: 'all', label: '全部作品' }, { value: 'draft', label: '草稿' }, { value: 'pending', label: '待审核' }, { value: 'published', label: '已公开' }, { value: 'rejected', label: '未通过' }, { value: 'saved', label: '我的收藏' }]
const tab = computed(() => typeof route.query.tab === 'string' && tabs.some(item => item.value === route.query.tab) ? route.query.tab : 'all')
const query = ref('')
const view = ref<'grid' | 'list'>('grid')
const works = ref<Work[]>([])
const filtered = computed(() => filterWorks(works.value.filter(work => tab.value !== 'saved' || work.saved), 'all', query.value))
const publishLink = computed(() => ({ path: '/library', query: { ...route.query, publish: '1' } }))
const editing = ref(false)
const deleteDialog = ref<HTMLDialogElement>()
const selected = ref<Work | null>(null)
const error = ref('')
const formError = ref('')
const loading = ref(false)
const saving = ref(false)
let loadId = 0
const nextCursor = ref<string | null>(null)

async function load(append = false) {
  const current = ++loadId
  loading.value = true
  error.value = ''
  await loadSession()
  if (!session.user) { works.value = []; loading.value = false; return }
  try {
    const result = await api<{ items: Work[]; nextCursor?: string | null }>(`/api/library${queryString({ status: tab.value === 'all' ? undefined : tab.value, cursor: append ? nextCursor.value || undefined : undefined })}`)
    if (current === loadId) { works.value = append ? [...works.value, ...result.items] : result.items; nextCursor.value = result.nextCursor || null }
  } catch (cause) { if (current === loadId) error.value = errorMessage(cause) }
  finally { if (current === loadId) loading.value = false }
}
watch(tab, () => { void load() }, { immediate: true })
function edit(work: Work) { selected.value = work; formError.value = ''; editing.value = true }
function confirmDelete(work: Work) { selected.value = work; formError.value = ''; deleteDialog.value?.showModal() }
function saved(work: Work) { const existing = works.value.find(item => item.id === work.id); if (existing) Object.assign(existing, work); void load() }
async function deleteSelected() {
  if (!selected.value || saving.value) return
  saving.value = true
  try {
    await api(`/api/works/${encodeURIComponent(selected.value.id)}`, { method: 'DELETE', body: { version: selected.value.version } })
    works.value = works.value.filter(work => work.id !== selected.value!.id)
    deleteDialog.value?.close()
    notify('作品已删除。')
  } catch (cause) { formError.value = errorMessage(cause) }
  finally { saving.value = false }
}
</script>

<template>
  <div class="page-container">
    <div class="page-heading"><div><h1>我的作品</h1><p class="muted">从未完成的想法，到想分享的作品。</p></div><RouterLink v-if="session.user" :to="publishLink" class="button primary"><Plus :size="17" />发布作品</RouterLink></div>
    <div v-if="!session.user && session.ready" class="empty-state"><Images :size="30" /><h2>登录后查看我的作品</h2><RouterLink to="/account" class="button primary">登录</RouterLink></div>
    <template v-else>
      <div class="tabs" aria-label="作品分类"><RouterLink v-for="item in tabs" :key="item.value" :to="{ path: '/library', query: { ...route.query, tab: item.value } }" class="tab" :class="{ active: tab === item.value }" :aria-current="tab === item.value ? 'page' : undefined"><Bookmark v-if="item.value === 'saved'" :size="15" />{{ item.label }}</RouterLink></div>
      <div class="page-toolbar library-toolbar"><div class="search-control"><Search :size="17" /><input v-model="query" class="control" type="search" placeholder="搜索作品、标签或内容" aria-label="搜索我的作品" /><button v-if="query" class="icon-button" aria-label="清空搜索" @click="query = ''"><X :size="16" /></button></div><div class="library-view-controls"><span class="caption-5 muted" role="status">{{ filtered.length }} 件{{ tab === 'saved' ? '收藏' : '作品' }}</span><div class="view-switch" role="group" aria-label="显示方式"><button class="icon-button" :class="{ active: view === 'grid' }" :aria-pressed="view === 'grid'" aria-label="网格视图" title="网格视图" @click="view = 'grid'"><LayoutGrid :size="18" /></button><button class="icon-button" :class="{ active: view === 'list' }" :aria-pressed="view === 'list'" aria-label="列表视图" title="列表视图" @click="view = 'list'"><List :size="19" /></button></div></div></div>
      <p v-if="error" class="notice-inline" role="alert">{{ error }} <button class="text-link" @click="load()">重试</button></p>
      <ContentSkeleton v-if="loading" :layout="view === 'grid' ? 'works' : 'rows'" label="正在加载作品…" />
      <div v-else-if="filtered.length && view === 'grid'" class="works-grid library-grid"><div v-for="work in filtered" :key="work.id" class="work-management-item"><WorkCard :work="work" :management="work.owned" /><div v-if="work.owned" class="work-management-actions"><button class="button subtle" :aria-label="`编辑作品：${work.title}`" @click="edit(work)"><Pencil :size="14" />编辑</button><button class="icon-button" :aria-label="`删除作品：${work.title}`" title="删除作品" @click="confirmDelete(work)"><Trash2 :size="15" /></button></div></div></div>
      <div v-else-if="filtered.length" class="table-wrap"><table class="data-table"><thead><tr><th scope="col">作品</th><th scope="col">类型</th><th scope="col">状态</th><th scope="col">作者</th><th scope="col">操作</th></tr></thead><tbody><tr v-for="work in filtered" :key="work.id"><td><RouterLink :to="`/work/${work.id}`">{{ work.title }}</RouterLink></td><td>{{ kindLabels[work.kind] }}</td><td><span class="status" :class="work.status">{{ work.revisionPending ? '修改待审核' : statusLabels[work.status] }}</span></td><td>{{ work.author }}</td><td><div class="table-actions"><template v-if="work.owned"><button class="icon-button" :aria-label="`编辑作品：${work.title}`" title="编辑作品" @click="edit(work)"><Pencil :size="16" /></button><button class="icon-button" :aria-label="`删除作品：${work.title}`" title="删除作品" @click="confirmDelete(work)"><Trash2 :size="16" /></button></template><RouterLink :to="`/work/${work.id}`" class="icon-button" :aria-label="`查看作品：${work.title}`" title="查看作品"><ArrowUpRight :size="17" /></RouterLink></div></td></tr></tbody></table></div>
      <div v-else-if="!error" class="empty-state"><Images :size="30" /><h2>{{ query.trim() ? '没有匹配的作品' : tab === 'saved' ? '还没有收藏作品' : '这里还没有作品' }}</h2><button v-if="query" class="button" @click="query = ''">清空搜索</button><RouterLink v-else to="/discover" class="button">发现作品</RouterLink></div>
      <div v-if="nextCursor" class="feed-end"><button class="button" :disabled="loading" @click="load(true)">{{ loading ? '正在加载…' : '加载更多' }}</button></div>
    </template>
    <WorkEditor :open="editing" :work="selected" @close="editing = false" @saved="saved" />
    <dialog ref="deleteDialog" class="compact-dialog" aria-labelledby="delete-work-heading"><div class="dialog-heading"><h2 id="delete-work-heading">删除这件作品？</h2><button class="icon-button" aria-label="关闭删除确认" :disabled="saving" @click="deleteDialog?.close()"><X :size="20" /></button></div><form class="dialog-body stack" @submit.prevent="deleteSelected"><p>《{{ selected?.title }}》删除后将无法恢复。</p><p v-if="formError" class="form-error" role="alert">{{ formError }}</p><div class="dialog-footer"><span></span><div><button class="button subtle" type="button" :disabled="saving" @click="deleteDialog?.close()">取消</button><button class="button danger" :disabled="saving"><Trash2 :size="16" />确认删除</button></div></div></form></dialog>
  </div>
</template>
