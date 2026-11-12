<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Check, Pencil, Plus, RefreshCw, Save, Trash2, X } from '@lucide/vue'
import { api, errorMessage, notify } from '../state'

const props = defineProps<{ view: 'settings' | 'tags' | 'ads' }>()
interface Config {
  communityPublicationMode: 'before' | 'after'; communityAutoBanEnabled: boolean; communityViolationThreshold: number
  communityFeedMode: 'shuffle' | 'latest'; communityFeedPoolSize: number; communityPullToRefresh: boolean
  uploadLimits: Record<'image' | 'video' | 'audio' | 'document' | 'other', number>
}
interface Tag { id: string; category: 'image' | 'video' | 'resource'; name: string }
interface Ad { id: string; enabled: boolean; title: string; imageUrl: string; linkUrl: string }
const config = ref<Config | null>(null), tags = ref<Tag[]>([]), ads = ref<Ad[]>([])
const loading = ref(true), busy = ref(false), error = ref('')
const category = ref<Tag['category']>('image'), newName = ref(''), editing = ref(''), editName = ref(''), deleting = ref('')
const categoryNames = { image: '图片', video: '视频', resource: '资源' }
const uploadNames = { image: '图片', video: '视频', audio: '音频', document: '文档', other: '其他文件' }
const filteredTags = computed(() => tags.value.filter(tag => tag.category === category.value))
const title = computed(() => ({ settings: '社区设置', tags: '内容标签', ads: '广告位' })[props.view])
async function load() {
  loading.value = true; error.value = ''
  try {
    if (props.view === 'settings') config.value = (await api<{ config: Config }>('/api/admin/community/config')).config
    else if (props.view === 'tags') tags.value = (await api<{ items: Tag[] }>('/api/admin/tags')).items
    else ads.value = (await api<{ items: Ad[] }>('/api/admin/community/ads')).items
  } catch (cause) { error.value = errorMessage(cause) }
  finally { loading.value = false }
}
async function save() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    if (props.view === 'settings' && config.value) config.value = (await api<{ config: Config }>('/api/admin/community/config', { method: 'PATCH', body: config.value })).config
    else if (props.view === 'ads') ads.value = (await api<{ items: Ad[] }>('/api/admin/community/ads', { method: 'PATCH', body: { items: ads.value } })).items
    notify(props.view === 'ads' ? '广告位已保存。' : '社区设置已保存。')
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}
async function changeTag(action: 'create' | 'rename' | 'delete', tag?: Tag) {
  if (busy.value) return
  const name = (action === 'create' ? newName.value : editName.value).normalize('NFC').trim()
  if (action !== 'delete' && (!name || Array.from(name).length > 24 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name))) { error.value = '标签需为 1 到 24 个字符，不能包含控制字符。'; return }
  busy.value = true; error.value = ''
  try {
    if (action === 'delete' && tag) {
      await api(`/api/admin/tags/${encodeURIComponent(tag.id)}`, { method: 'DELETE', body: {} })
      tags.value = tags.value.filter(item => item.id !== tag.id); deleting.value = ''; notify('标签已删除。')
    } else if (action === 'rename' && tag) {
      const value = (await api<{ tag: Tag }>(`/api/admin/tags/${encodeURIComponent(tag.id)}`, { method: 'PATCH', body: { name } })).tag
      tags.value = tags.value.map(item => item.id === value.id ? value : item); editing.value = ''; notify('标签已更新。')
    } else {
      const value = (await api<{ tag: Tag }>('/api/admin/tags', { method: 'POST', body: { category: category.value, name } })).tag
      tags.value.push(value); newName.value = ''; notify('标签已添加。')
    }
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}
onMounted(() => { void load() })
</script>

<template>
  <section class="panel-section admin-community">
    <div class="section-heading"><h2>{{ title }}</h2><button class="icon-button" :aria-label="`刷新${title}`" :title="`刷新${title}`" :disabled="loading || busy" @click="load"><RefreshCw :size="17" /></button></div>
    <div v-if="loading" class="admin-loading" role="status" :aria-label="`正在加载${title}`"><div v-for="n in 3" :key="n" class="skeleton" /></div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <form v-if="view === 'settings' && config && !loading" class="stack" @submit.prevent="save">
      <fieldset class="fieldset stack" :disabled="busy">
        <h3 class="config-title">发布与推荐</h3>
        <div class="fields"><label class="field"><span>内容发布方式</span><select v-model="config.communityPublicationMode" class="control"><option value="before">先审核，再公开</option><option value="after">先公开，再审核</option></select></label><label class="field"><span>首页推荐排序</span><select v-model="config.communityFeedMode" class="control"><option value="shuffle">随机推荐</option><option value="latest">最新发布</option></select></label><label class="field"><span>推荐候选池</span><input v-model.number="config.communityFeedPoolSize" type="number" min="20" max="1000" step="1" required class="control" /></label><label class="check-label"><input v-model="config.communityPullToRefresh" type="checkbox" />手机下拉刷新</label></div>
        <h3 class="config-title">违规处理</h3><div class="fields"><label class="check-label"><input v-model="config.communityAutoBanEnabled" type="checkbox" />达到阈值自动封禁</label><label class="field"><span>违规次数阈值</span><input v-model.number="config.communityViolationThreshold" type="number" min="1" max="1000" step="1" required class="control" /></label></div>
        <h3 class="config-title">单文件上传限制</h3><div class="upload-fields"><label v-for="(label, kind) in uploadNames" :key="kind" class="field"><span>{{ label }}（MB）</span><input v-model.number="config.uploadLimits[kind]" class="control" type="number" min="1" max="10240" step="1" required /></label></div>
        <button class="button primary btn" :disabled="busy"><Save :size="16" />{{ busy ? '正在保存…' : '保存社区设置' }}</button>
      </fieldset>
    </form>
    <template v-if="view === 'tags' && !loading">
      <div class="tabs" aria-label="标签分类"><button v-for="(label, value) in categoryNames" :key="value" class="tab" :class="{ active: category === value }" :aria-pressed="category === value" :disabled="busy || !!editing" @click="category = value; deleting = ''">{{ label }} · {{ tags.filter(tag => tag.category === value).length }}</button></div>
      <form class="tag-form" @submit.prevent="changeTag('create')"><label class="field"><span>添加{{ categoryNames[category] }}标签</span><input v-model="newName" class="control" maxlength="48" required :disabled="busy || !!editing" /></label><button class="button btn" :disabled="busy || !newName.trim() || !!editing"><Plus :size="16" />添加标签</button></form>
      <div v-if="!filteredTags.length" class="empty-state"><h3>此分类暂无标签</h3></div>
      <ul v-else class="tag-list"><li v-for="tag in filteredTags" :key="tag.id">
        <form v-if="editing === tag.id" class="tag-form" @submit.prevent="changeTag('rename', tag)"><label class="field"><span class="sr-only">标签名称</span><input v-model="editName" class="control" maxlength="48" required :disabled="busy" /></label><button class="icon-button" :aria-label="`保存标签 ${tag.name}`" title="保存标签" :disabled="busy"><Check :size="17" /></button><button type="button" class="icon-button" aria-label="取消修改标签" title="取消修改" :disabled="busy" @click="editing = ''"><X :size="17" /></button></form>
        <template v-else><strong>{{ tag.name }}</strong><div v-if="deleting === tag.id" class="table-actions"><span class="caption-5">确认删除？</span><button class="button btn" :disabled="busy" @click="changeTag('delete', tag)">删除</button><button class="button subtle btn" :disabled="busy" @click="deleting = ''">取消</button></div><div v-else class="table-actions"><button class="icon-button" :aria-label="`修改标签 ${tag.name}`" title="修改标签" :disabled="busy || !!editing" @click="editing = tag.id; editName = tag.name"><Pencil :size="16" /></button><button class="icon-button" :aria-label="`删除标签 ${tag.name}`" title="删除标签" :disabled="busy || !!editing" @click="deleting = tag.id"><Trash2 :size="16" /></button></div></template>
      </li></ul>
    </template>
    <form v-if="view === 'ads' && !loading" class="stack" @submit.prevent="save">
      <fieldset :disabled="busy" class="fieldset stack">
        <article v-for="(ad, index) in ads" :key="ad.id" class="ad-editor">
          <div class="section-heading"><h3>广告位 {{ index + 1 }}</h3><label class="check-label"><input v-model="ad.enabled" type="checkbox" />启用</label></div>
          <div class="ad-layout"><div class="stack"><label class="field"><span>标题</span><input v-model="ad.title" class="control" maxlength="80" :required="ad.enabled" /></label><label class="field"><span>图片地址</span><input v-model="ad.imageUrl" class="control" type="url" maxlength="2048" :required="ad.enabled" placeholder="https://" /></label><label class="field"><span>跳转链接</span><input v-model="ad.linkUrl" class="control" type="url" maxlength="2048" :required="ad.enabled" placeholder="https://" /></label></div><div class="ad-preview"><img v-if="ad.imageUrl && /^https?:\/\//i.test(ad.imageUrl)" :src="ad.imageUrl" :alt="ad.title || `广告位 ${index + 1}`" referrerpolicy="no-referrer" loading="lazy" /><span v-else class="muted">暂无图片</span><p>{{ ad.title || `广告位 ${index + 1}` }}</p></div></div>
        </article>
        <button class="button primary btn" :disabled="busy"><Save :size="16" />{{ busy ? '正在保存…' : '保存广告位' }}</button>
      </fieldset>
    </form>
  </section>
</template>

<style scoped>
.admin-community { padding-top: 0; }
.fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.fieldset.stack { gap: 20px; }
.config-title { font-size: 14px; line-height: 20px; font-weight: 600; margin-top: 8px; padding-top: 24px; border-top: 1px solid var(--border); }
.config-title:first-child { margin: 0; padding: 0; border: 0; }
.fields, .upload-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: center; }
.fields > *, .upload-fields > * { min-width: 0; }
.upload-fields { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.check-label { display: flex; gap: 8px; align-items: center; min-height: 44px; }
.check-label input { width: 18px; height: 18px; accent-color: var(--blue); }
.fieldset > .button { justify-self: start; align-self: start; margin-top: 4px; }
.tag-form { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; }
.tag-form .field { flex: 1; min-width: 160px; }
.tag-list { list-style: none; margin: 24px 0 0; padding: 0; border-top: 1px solid var(--border); }
.tag-list > li { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 64px; padding: 8px 0; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
.tag-list > li > strong { min-width: 0; font-size: 14px; font-weight: 500; }
.tag-list .table-actions { flex-wrap: wrap; justify-content: end; gap: 8px; }
.tag-list .icon-button { width: 44px; height: 44px; }
.tag-list .tag-form { width: 100%; }
.ad-editor { padding-block: 24px; border-bottom: 1px solid var(--border); }
.ad-editor:first-child { padding-top: 0; }
.ad-editor h3 { font-size: 14px; font-weight: 600; line-height: 20px; }
.ad-editor .section-heading { margin-bottom: 20px; }
.ad-editor .stack { gap: 16px; }
.ad-layout { display: grid; grid-template-columns: minmax(0, 1fr) 160px; gap: 24px; align-items: start; }
.ad-preview { min-width: 0; overflow-wrap: anywhere; }
.ad-preview img, .ad-preview > span { width: 100%; aspect-ratio: 1; object-fit: contain; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }
.ad-preview > span { display: flex; align-items: center; justify-content: center; font-size: 12px; }
.ad-preview p { margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 20px; }
.admin-loading { display: grid; gap: 16px; padding-block: 24px; }
.admin-loading .skeleton { height: 40px; max-width: 640px; }
@media (max-width: 899px) { .upload-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 639px) {
  .fields, .upload-fields, .ad-layout { grid-template-columns: 1fr; }
  .ad-preview { max-width: 160px; }
  .tag-form > .button, .fieldset > .button { width: 100%; }
  .tag-list > li { flex-wrap: wrap; }
}
</style>
