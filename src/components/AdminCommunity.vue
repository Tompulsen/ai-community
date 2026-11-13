<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, Image, Pencil, Plus, RefreshCw, Save, Trash2, X } from '@lucide/vue'
import { api, errorMessage, notify, uploadFile } from '../state'
import { updateSite, type SiteBranding } from '../site'

const props = defineProps<{ view: 'site' | 'settings' | 'tags' | 'ads' }>()
interface Config {
  communityPublicationMode: 'before' | 'after'; communityAutoBanEnabled: boolean; communityViolationThreshold: number
  communityFeedMode: 'shuffle' | 'latest'; communityFeedPoolSize: number; communityPullToRefresh: boolean
  uploadLimits: Record<'image' | 'video' | 'audio' | 'document' | 'other', number>
}
interface Tag { id: string; category: 'image' | 'video' | 'resource'; name: string }
interface Ad { id: string; enabled: boolean; title: string; imageUrl: string; linkUrl: string }
const config = ref<Config | null>(null), tags = ref<Tag[]>([]), ads = ref<Ad[]>([])
const loading = ref(true), busy = ref(false), error = ref('')
const branding = ref<SiteBranding | null>(null), version = ref(''), loaded = ref(false), baseline = ref('')
const uploading = ref(false), logoFailed = ref(false), reloadPrompt = ref(false)
const saved = ref(false), failedAdImages = ref<Record<string, string>>({})
let active = true
let logoUpload: AbortController | undefined
const snapshot = () => JSON.stringify(props.view === 'site' ? branding.value : props.view === 'settings' ? config.value : ads.value)
const dirty = computed(() => loaded.value && props.view !== 'tags' && snapshot() !== baseline.value)
const previewLogo = computed(() => /^(?:https:\/\/|\/(?:assets|files|legacy-files)\/)/i.test(branding.value?.logoUrl || '') ? branding.value!.logoUrl : '')
const category = ref<Tag['category']>('image'), newName = ref(''), editing = ref(''), editName = ref(''), deleting = ref('')
const categoryNames = { image: '图片', video: '视频', resource: '资源' }
const uploadNames = { image: '图片', video: '视频', audio: '音频', document: '文档', other: '其他文件' }
const filteredTags = computed(() => tags.value.filter(tag => tag.category === category.value))
const title = computed(() => ({ site: '站点设置', settings: '社区设置', tags: '内容标签', ads: '广告位' })[props.view])
const description = computed(() => ({ site: '设置社区名称与标识，保存后应用于导航、登录页和页面标题。', settings: '设置发布规则、首页推荐、违规处理与文件上传限制。', tags: '按内容类型管理标签，帮助创作者分类与用户发现作品。', ads: '按固定位置配置广告。修改后统一保存，空广告位会保留原位置。' })[props.view])
const hasUnsavedChanges = computed(() => uploading.value || dirty.value || !!editing.value || !!newName.value.trim())
defineExpose({ hasUnsavedChanges })
function readVersion(value: { version: string }) {
  if (!value.version) throw new Error('未能读取配置版本，请刷新后重试。')
  version.value = value.version
}
async function load() {
  loading.value = true; error.value = ''; reloadPrompt.value = false; saved.value = false
  try {
    if (props.view === 'site') {
      const result = await api<{ settings: SiteBranding; version: string }>('/api/admin/settings')
      if (!active) return
      readVersion(result)
      branding.value = { brand: result.settings.brand, logoUrl: result.settings.logoUrl }
      updateSite(branding.value)
    } else if (props.view === 'settings') {
      const result = await api<{ config: Config; version: string }>('/api/admin/community/config')
      if (!active) return
      readVersion(result); config.value = result.config
    } else if (props.view === 'tags') {
      const result = await api<{ items: Tag[] }>('/api/admin/tags')
      if (!active) return
      tags.value = result.items; newName.value = ''; editing.value = ''; deleting.value = ''
    } else {
      const result = await api<{ items: Ad[]; version: string }>('/api/admin/community/ads')
      if (!active) return
      readVersion(result); ads.value = result.items
    }
    loaded.value = true; baseline.value = snapshot()
  } catch (cause) { error.value = errorMessage(cause) }
  finally { loading.value = false }
}
function refresh() {
  if (dirty.value || editing.value || newName.value.trim()) reloadPrompt.value = true
  else void load()
}
async function save() {
  if (busy.value || !loaded.value || !version.value) return
  busy.value = true; error.value = ''
  try {
    if (props.view === 'site' && branding.value) {
      const result = await api<{ settings: SiteBranding; version: string }>('/api/admin/settings', { method: 'PATCH', body: { settings: { brand: branding.value.brand.trim(), logoUrl: branding.value.logoUrl.trim() }, version: version.value } })
      if (!active) return
      updateSite(result.settings)
      readVersion(result); branding.value = { brand: result.settings.brand, logoUrl: result.settings.logoUrl }
    } else if (props.view === 'settings' && config.value) {
      const result = await api<{ config: Config; version: string }>('/api/admin/community/config', { method: 'PATCH', body: { ...config.value, version: version.value } })
      if (!active) return
      readVersion(result); config.value = result.config
    } else if (props.view === 'ads') {
      const result = await api<{ items: Ad[]; version: string }>('/api/admin/community/ads', { method: 'PATCH', body: { items: ads.value, version: version.value } })
      if (!active) return
      readVersion(result); ads.value = result.items
    }
    baseline.value = snapshot(); reloadPrompt.value = false; saved.value = true
    notify(`${title.value}已保存。`)
  } catch (cause) {
    error.value = (cause as { status?: number }).status === 409 ? '配置已被其他管理员修改，你的输入仍保留。请先复制需要的内容，再刷新核对最新配置。' : errorMessage(cause)
  }
  finally { busy.value = false }
}
async function uploadLogo(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  if (!file || busy.value || !branding.value) return
  busy.value = true; uploading.value = true; error.value = ''
  const controller = new AbortController(); logoUpload = controller
  try {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)) throw new Error('请选择 JPG、PNG、WebP、GIF 或 AVIF 图片。')
    const uploaded = await uploadFile(file, controller.signal)
    if (active && branding.value) branding.value.logoUrl = uploaded.url
  } catch (cause) { if (active) error.value = errorMessage(cause) }
  finally { logoUpload = undefined; busy.value = false; uploading.value = false; input.value = '' }
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
onBeforeUnmount(() => { active = false; logoUpload?.abort() })
watch(() => branding.value?.logoUrl, () => { logoFailed.value = false })
watch(dirty, value => { if (value) saved.value = false })
</script>

<template>
  <section class="panel-section admin-community">
    <div class="section-heading editor-heading"><div><h2>{{ title }}</h2><p class="form-note">{{ description }}</p></div><button class="button subtle btn" :aria-label="'刷新' + title" :disabled="loading || busy" @click="refresh"><RefreshCw :size="16" aria-hidden="true" />刷新</button></div>
    <div v-if="loading" class="admin-loading" role="status" :aria-label="'正在加载' + title"><div v-for="n in 3" :key="n" class="skeleton" /></div>
    <p v-if="error" class="form-error editor-error" role="alert">{{ error }}</p>
    <div v-if="reloadPrompt" class="reload-prompt" role="status"><p>重新读取会放弃当前未保存的修改。</p><div class="table-actions"><button class="button btn" :disabled="busy || loading" @click="load">放弃修改并刷新</button><button class="button subtle btn" @click="reloadPrompt = false">继续编辑</button></div></div>
    <form v-if="view === 'site' && branding && !loading" id="admin-site-form" class="site-form" @submit.prevent="save">
      <fieldset class="fieldset" :disabled="busy">
        <section class="editor-section"><div class="editor-section-title"><h3>基本信息</h3><p>让用户识别你的社区。</p></div><div class="editor-fields"><label class="field"><span>站点名称</span><input v-model="branding.brand" class="control" maxlength="80" required aria-describedby="site-name-help" /></label><p id="site-name-help" class="form-note">显示于社区导航、登录页和浏览器标题，最多 80 个字符。</p></div></section>
        <section class="editor-section"><div class="editor-section-title"><h3>品牌标识</h3><p>上传图片或使用已有图片地址。</p></div><div class="editor-fields">
          <div class="site-logo-layout"><div class="site-logo-preview"><img v-if="previewLogo && !logoFailed" :src="previewLogo" alt="站点 Logo 预览" referrerpolicy="no-referrer" @error="logoFailed = true" /><span v-else><Image :size="28" aria-hidden="true" /><span>{{ logoFailed ? '图片暂时无法加载' : '未设置 Logo' }}</span></span></div><div class="stack logo-actions"><label class="field"><span>上传 Logo</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" aria-describedby="site-logo-help" @change="uploadLogo" /></label><button v-if="branding.logoUrl" type="button" class="button subtle btn" @click="branding.logoUrl = ''"><Trash2 :size="15" aria-hidden="true" />移除 Logo</button><p class="form-note">上传后请保存；留空时仅显示站点名称。</p></div></div>
          <label class="field"><span>Logo 图片地址</span><input v-model="branding.logoUrl" class="control" maxlength="2048" placeholder="https:// 或本站图片路径" aria-describedby="site-logo-help" /></label><p id="site-logo-help" class="form-note">支持 HTTPS 图片地址，或上传 JPG、PNG、WebP、GIF、AVIF。</p>
          <div class="brand-preview" aria-label="导航展示预览"><span class="form-note">导航预览</span><div><img v-if="previewLogo && !logoFailed" :src="previewLogo" alt="" referrerpolicy="no-referrer" /><strong>{{ branding.brand || '站点名称' }}</strong></div></div>
        </div></section>
      </fieldset>
    </form>
    <form v-if="view === 'settings' && config && !loading" id="admin-settings-form" @submit.prevent="save">
      <fieldset class="fieldset" :disabled="busy">
        <section class="editor-section"><div class="editor-section-title"><h3>内容发布</h3><p>决定投稿何时出现在社区。</p></div><div class="editor-fields"><label class="field"><span>内容发布方式</span><select v-model="config.communityPublicationMode" class="control" aria-describedby="publication-help"><option value="before">先审核，再公开</option><option value="after">先公开，再审核</option></select></label><p id="publication-help" class="form-note">{{ config.communityPublicationMode === 'before' ? '新投稿通过管理员或审核员审核后公开展示。' : '新投稿直接公开，管理员可在审核列表中处理。' }}</p></div></section>
        <section class="editor-section"><div class="editor-section-title"><h3>首页推荐</h3><p>控制作品排序与浏览体验。</p></div><div class="editor-fields"><div class="fields"><label class="field"><span>首页推荐排序</span><select v-model="config.communityFeedMode" class="control"><option value="shuffle">随机推荐</option><option value="latest">最新发布</option></select></label><label class="field"><span>推荐候选池</span><input v-model.number="config.communityFeedPoolSize" type="number" min="20" max="1000" step="1" required class="control" aria-describedby="feed-pool-help" /></label></div><p id="feed-pool-help" class="form-note">随机推荐从最近 20–1000 条候选作品中选取；最新发布按时间排序。</p><label class="switch-row"><span><strong>手机下拉刷新</strong><small>允许用户下拉刷新社区作品。</small></span><input v-model="config.communityPullToRefresh" type="checkbox" role="switch" aria-label="手机下拉刷新" /></label></div></section>
        <section class="editor-section"><div class="editor-section-title"><h3>违规处理</h3><p>设置累计违规的处理规则。</p></div><div class="editor-fields"><label class="switch-row"><span><strong>达到阈值自动封禁</strong><small>根据已记录的内容违规执行。</small></span><input v-model="config.communityAutoBanEnabled" type="checkbox" role="switch" aria-label="达到阈值自动封禁" /></label><label class="field"><span>违规次数阈值</span><input v-model.number="config.communityViolationThreshold" type="number" min="1" max="1000" step="1" required class="control" aria-describedby="violation-help" /></label><p id="violation-help" class="form-note">可设置 1–1000 次。关闭自动封禁后保留阈值设置。</p></div></section>
        <section class="editor-section"><div class="editor-section-title"><h3>上传限制</h3><p>按文件类型设置单个文件的大小上限。</p></div><div class="editor-fields"><div class="upload-fields"><label v-for="(label, kind) in uploadNames" :key="kind" class="field"><span>{{ label }}（MB）</span><input v-model.number="config.uploadLimits[kind]" class="control" type="number" min="1" max="10240" step="1" required aria-describedby="upload-limit-help" /></label></div><p id="upload-limit-help" class="form-note">每类可设置 1–10240 MB，实际上传同时受账号权限约束。</p></div></section>
      </fieldset>
    </form>
    <template v-if="view === 'tags' && loaded && !loading">
      <div class="tabs" aria-label="标签分类"><button v-for="(label, value) in categoryNames" :key="value" class="tab" :class="{ active: category === value }" :aria-pressed="category === value" :disabled="busy || !!editing" @click="category = value; deleting = ''">{{ label }} · {{ tags.filter(tag => tag.category === value).length }}</button></div>
      <form class="tag-form tag-create" @submit.prevent="changeTag('create')"><label class="field"><span>添加{{ categoryNames[category] }}标签</span><input v-model="newName" class="control" maxlength="48" required :disabled="busy || !!editing" aria-describedby="tag-help" placeholder="输入标签名称" /></label><button class="button btn" :disabled="busy || !newName.trim() || !!editing"><Plus :size="16" aria-hidden="true" />添加标签</button></form><p id="tag-help" class="form-note tag-help">1–24 个字符，添加、重命名和删除操作即时保存。</p>
      <div v-if="!filteredTags.length" class="empty-state"><h3>此分类暂无标签</h3><p>添加一个标签，让作品更容易被发现。</p></div>
      <ul v-else class="tag-list"><li v-for="tag in filteredTags" :key="tag.id">
        <form v-if="editing === tag.id" class="tag-form" @submit.prevent="changeTag('rename', tag)"><label class="field"><span class="sr-only">标签名称</span><input v-model="editName" class="control" maxlength="48" required :disabled="busy" /></label><button class="icon-button" :aria-label="'保存标签 ' + tag.name" title="保存标签" :disabled="busy"><Check :size="17" /></button><button type="button" class="icon-button" aria-label="取消修改标签" title="取消修改" :disabled="busy" @click="editing = ''"><X :size="17" /></button></form>
        <template v-else><strong>{{ tag.name }}</strong><div v-if="deleting === tag.id" class="table-actions"><span class="caption-5">确认删除？</span><button class="button btn" :disabled="busy" @click="changeTag('delete', tag)">删除</button><button class="button subtle btn" :disabled="busy" @click="deleting = ''">取消</button></div><div v-else class="table-actions"><button class="icon-button" :aria-label="'修改标签 ' + tag.name" title="修改标签" :disabled="busy || !!editing" @click="editing = tag.id; editName = tag.name"><Pencil :size="16" /></button><button class="icon-button" :aria-label="'删除标签 ' + tag.name" title="删除标签" :disabled="busy || !!editing" @click="deleting = tag.id"><Trash2 :size="16" /></button></div></template>
      </li></ul>
    </template>
    <form v-if="view === 'ads' && loaded && !loading" id="admin-ads-form" @submit.prevent="save">
      <fieldset :disabled="busy" class="fieldset">
        <article v-for="(ad, index) in ads" :key="ad.id" class="ad-editor">
          <div class="section-heading"><div><h3>广告位 {{ index + 1 }}</h3><p class="form-note">{{ ad.enabled ? '已启用，保存后展示' : '未启用，内容可预先编辑' }}</p></div><label class="switch-row ad-switch"><span>启用</span><input v-model="ad.enabled" type="checkbox" role="switch" :aria-label="'启用广告位 ' + (index + 1)" /></label></div>
          <div class="ad-layout"><div class="editor-fields"><label class="field"><span>标题</span><input v-model="ad.title" class="control" maxlength="80" :required="ad.enabled" /></label><label class="field"><span>图片地址</span><input v-model="ad.imageUrl" class="control" type="url" maxlength="2048" :required="ad.enabled" placeholder="https://" /></label><label class="field"><span>跳转链接</span><input v-model="ad.linkUrl" class="control" type="url" maxlength="2048" :required="ad.enabled" placeholder="https://" /></label></div><div class="ad-preview"><img v-if="ad.imageUrl && /^https?:\/\//i.test(ad.imageUrl) && failedAdImages[ad.id] !== ad.imageUrl" :src="ad.imageUrl" :alt="ad.title || '广告位 ' + (index + 1)" referrerpolicy="no-referrer" loading="lazy" @error="failedAdImages[ad.id] = ad.imageUrl" /><span v-else><Image :size="24" aria-hidden="true" />{{ ad.imageUrl ? '图片无法加载，请检查地址' : '填写图片地址以预览' }}</span><p>{{ ad.title || '广告位 ' + (index + 1) }}</p></div></div>
        </article>
      </fieldset>
    </form>
    <footer v-if="view !== 'tags' && loaded && !loading" class="editor-savebar"><p role="status"><span class="save-dot" :class="{ dirty }" aria-hidden="true" />{{ uploading ? '正在上传 Logo…' : busy ? '正在保存修改…' : dirty ? '有未保存的修改' : saved ? '修改已保存' : '所有设置已同步' }}</p><button class="button primary btn" :form="'admin-' + view + '-form'" type="submit" :disabled="busy"><Save :size="16" aria-hidden="true" />{{ uploading ? '正在上传…' : busy ? '正在保存…' : '保存' + title }}</button></footer>
  </section>
</template>

<style scoped>
.admin-community { padding-top: 0; border-bottom: 0; }
.editor-heading { align-items: start; gap: 16px; }
.editor-heading > div { flex: 1; min-width: 0; }
.editor-heading .form-note { margin-top: 8px; font-size: 14px; max-width: 65ch; }
.editor-error { margin-bottom: 20px; padding: 12px 16px; background: var(--danger-soft); border-radius: 6px; }
.fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.editor-section { display: grid; grid-template-columns: minmax(140px, .65fr) minmax(0, 2fr); gap: 32px; padding-block: 28px; border-top: 1px solid var(--border); }
.editor-section-title h3 { font-size: 16px; line-height: 24px; font-weight: 500; }
.editor-section-title p { margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 20px; max-width: 24ch; }
.editor-fields { display: grid; gap: 16px; min-width: 0; align-content: start; }
.site-logo-layout { display: grid; grid-template-columns: 112px minmax(0, 1fr); align-items: start; gap: 24px; }
.site-logo-layout .stack { min-width: 0; gap: 12px; }
.site-logo-layout input[type="file"] { max-width: 100%; min-width: 0; font: inherit; }
.logo-actions .button { align-self: start; }
.site-logo-preview { width: 112px; aspect-ratio: 1; display: grid; place-items: center; border-radius: 8px; background: var(--surface); overflow: hidden; }
.site-logo-preview img { width: 100%; height: 100%; object-fit: contain; }
.site-logo-preview > span { display: grid; justify-items: center; gap: 12px; color: var(--muted); font-size: 12px; }
.brand-preview { display: grid; gap: 12px; padding: 16px 20px; background: var(--surface); border-radius: 6px; }
.brand-preview > div { display: flex; align-items: center; gap: 12px; min-height: 40px; min-width: 0; }
.brand-preview img { width: 32px; height: 32px; object-fit: contain; flex-shrink: 0; }
.brand-preview strong { font-size: 18px; font-weight: 500; overflow-wrap: anywhere; min-width: 0; }
.reload-prompt { padding: 16px; margin-bottom: 24px; background: var(--amber-soft); border-radius: 6px; }
.reload-prompt .table-actions { flex-wrap: wrap; margin-top: 12px; }
.fields, .upload-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
.fields > *, .upload-fields > * { min-width: 0; }
.upload-fields { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.switch-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 56px; padding: 12px 16px; background: var(--surface); border-radius: 6px; cursor: pointer; }
.switch-row > span { display: grid; gap: 4px; }
.switch-row strong { font-size: 14px; font-weight: 500; }
.switch-row small { color: var(--muted); font-size: 12px; }
.switch-row input { appearance: none; position: relative; width: 40px; height: 24px; flex: 0 0 40px; margin: 0; border: 1px solid var(--muted); border-radius: 20px; background: var(--surface-soft); cursor: pointer; }
.switch-row input::before { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--muted); transition: transform 160ms ease; }
.switch-row input:checked { background: var(--blue); border-color: var(--blue); }
.switch-row input:checked::before { background: var(--action-ink); transform: translateX(16px); }
.switch-row input:disabled { cursor: wait; opacity: .5; }
.tag-form { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; }
.tag-create { max-width: 640px; }
.tag-form .field { flex: 1; min-width: 160px; }
.tag-help { margin-top: 12px; }
.tag-list { list-style: none; margin: 24px 0 0; padding: 0; border-top: 1px solid var(--border); }
.tag-list > li { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 64px; padding: 8px 0; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
.tag-list > li > strong { min-width: 0; font-size: 14px; font-weight: 500; }
.tag-list .table-actions { flex-wrap: wrap; justify-content: end; gap: 8px; }
.tag-list .icon-button { width: 44px; height: 44px; }
.tag-list .tag-form { width: 100%; }
.ad-editor { padding-block: 24px; border-top: 1px solid var(--border); }
.ad-editor h3 { font-size: 16px; font-weight: 500; line-height: 24px; }
.ad-editor .section-heading { margin-bottom: 20px; gap: 16px; }
.ad-editor .section-heading .form-note { margin-top: 6px; }
.ad-switch { padding: 0; background: transparent; }
.ad-layout { display: grid; grid-template-columns: minmax(0, 1fr) 200px; gap: 24px; align-items: start; }
.ad-preview { min-width: 0; overflow-wrap: anywhere; }
.ad-preview img, .ad-preview > span { width: 100%; aspect-ratio: 1; object-fit: contain; background: var(--surface); border-radius: 6px; }
.ad-preview > span { display: flex; flex-direction: column; gap: 12px; align-items: center; justify-content: center; padding: 12px; font-size: 12px; color: var(--muted); text-align: center; }
.ad-preview p { margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 20px; }
.editor-savebar { position: sticky; bottom: calc(var(--mobile-nav-height) + 12px); z-index: 5; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-top: 16px; padding: 14px 20px; background: var(--surface-soft); border-radius: 8px; }
.editor-savebar p { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }
.editor-savebar .button { min-height: 44px; }
.save-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
.save-dot.dirty { background: var(--amber); }
.admin-loading { display: grid; gap: 16px; padding-block: 24px; }
.admin-loading .skeleton { height: 44px; max-width: 640px; }
@media (max-width: 1100px) { .editor-section { grid-template-columns: 1fr; gap: 16px; } .editor-section-title p { max-width: none; } }
@media (max-width: 639px) {
  .editor-heading .form-note { font-size: 12px; }
  .fields, .ad-layout, .site-logo-layout { grid-template-columns: 1fr; }
  .upload-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .editor-section { padding-block: 24px; }
  .ad-preview { max-width: 200px; }
  .tag-form > .button { width: 100%; }
  .tag-list > li { flex-wrap: wrap; }
  .editor-savebar { padding: 12px; bottom: var(--mobile-nav-height); }
  .editor-savebar .button { margin-left: auto; }
}
@media (prefers-reduced-motion: reduce) { .switch-row input::before { transition: none; } }
</style>
