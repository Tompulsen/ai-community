<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronDown, Send, SlidersHorizontal, Upload, X } from '@lucide/vue'
import { api, errorMessage, notify, session } from '../state'
import type { Work, WorkTag } from '../data'
import PublicationTagPicker from './PublicationTagPicker.vue'
import { mediaSource, publishCreation, type PublicationDetails, type CreationDestination, type CreationTask } from '../native-studio'
import '../publication-controls.css'
const dialog = ref<HTMLDialogElement>(), extra = ref<HTMLDetailsElement>(), task = ref<CreationTask>(), destination = ref<CreationDestination>('community')
const title = ref(''), text = ref(''), content = ref<string>(), error = ref(''), busy = ref(false), result = ref<Work>()
const tags = ref<WorkTag[]>([]), tagIds = ref<string[]>([]), tagsLoading = ref(false), tagsError = ref('')
const tagField = ref<HTMLFieldSetElement>(), tagValidation = ref('')
const prompt = ref(''), sourceUrl = ref(''), license = ref(''), rights = ref(false), referenceIndices = ref<number[]>([])
const category = computed(() => task.value?.kind === 'text' ? 'resource' : task.value?.kind || 'image')
const direct = computed(() => destination.value === 'source-comment')
const locked = computed(() => Boolean(task.value?.publications?.[destination.value]))
const heading = computed(() => direct.value ? '发送到源作品评论区' : '发布作品')
const published = computed(() => result.value && ['published', 'approved'].includes(result.value.status))
const sourceCommentLink = computed(() => direct.value && published.value && Boolean(result.value?.noteId))
const resultLink = computed(() => sourceCommentLink.value ? `/work/${task.value?.sourceWorkId}#comment-${result.value?.noteId}` : `/work/${result.value?.id}`)
const resultMessage = computed(() => result.value?.status === 'pending' ? direct.value ? '评论已提交审核。' : '作品已提交审核。' : published.value ? direct.value ? '已发送到源作品评论区。' : '作品已公开。' : result.value?.status === 'rejected' ? '未通过审核或已撤回，请查看提交记录。' : '已保存提交记录。')
let revision = 0
onBeforeUnmount(() => revision++)
watch(() => session.user?.id, () => { revision++; dialog.value?.close(); task.value = undefined; result.value = undefined; error.value = ''; busy.value = false })
async function loadTags() {
  const current = revision
  tagsLoading.value = true; tagsError.value = ''
  try {
    const response = await api<{ items: WorkTag[] }>('/api/tags')
    if (current !== revision) return
    if (!Array.isArray(response.items)) throw new Error('标签数据暂时不可用。')
    tags.value = response.items
    if (!locked.value) {
      const valid = tagIds.value.filter(id => tags.value.some(tag => tag.id === id))
      if (valid.length !== tagIds.value.length) { tagIds.value = valid; error.value = '部分标签已失效，请重新选择。' }
    }
  } catch (cause) { if (current === revision) tagsError.value = errorMessage(cause) }
  finally { if (current === revision) tagsLoading.value = false }
}
function revealInvalid(event: Event) {
  const details = (event.target as HTMLInputElement).closest('details')
  if (details) details.open = true
}
async function open(value: CreationTask, target: CreationDestination = 'community', currentText?: string) {
  if (busy.value || value.phase !== 'complete' || value.owner !== session.user?.id) return
  const current = ++revision
  task.value = value; destination.value = target; content.value = currentText; error.value = ''; result.value = undefined
  const previous = value.publications?.[target]
  title.value = previous?.title || (target === 'source-comment' ? '我的同款作品' : value.prompt.slice(0, 50))
  text.value = previous?.text ?? (value.kind === 'text' ? currentText ?? value.text : target === 'source-comment' ? '我用同款提示词创作了新作品' : '').slice(0, 2500)
  prompt.value = previous?.details?.prompt ?? value.prompt
  sourceUrl.value = previous?.details?.sourceUrl ?? ''; license.value = previous?.details?.license ?? ''
  referenceIndices.value = [...(previous?.details?.referenceIndices ?? value.references.map((_, index) => index))]
  tagIds.value = [...(previous?.details?.tagIds ?? [])]; tags.value = []; tagsError.value = ''; tagValidation.value = ''; rights.value = Boolean(previous)
  if (target === 'community' && !previous?.work) void loadTags()
  await nextTick(); if (current !== revision) return
  if (extra.value) extra.value.open = false
  dialog.value?.showModal()
  if (previous?.work) {
    busy.value = true
    try { const response = await api<{ work: Work }>(`/api/works/${encodeURIComponent(previous.work.id)}`); if (current === revision) result.value = response.work }
    catch (cause) { if (current === revision) { result.value = previous.work; error.value = `已提交，暂时无法刷新最新状态：${errorMessage(cause)}` } }
    finally { if (current === revision) busy.value = false }
  }
}
async function submit() {
  if (!task.value || busy.value || result.value) return
  error.value = ''; tagValidation.value = ''
  if (!direct.value && !locked.value) {
    tagValidation.value = tagsLoading.value ? '标签正在加载，请稍后再提交。'
      : tagsError.value ? '请重新加载标签并选择后再发布。'
        : !tagIds.value.length ? '请至少选择 1 个作品标签后再发布。'
          : tagIds.value.length > 3 || tagIds.value.some(id => !tags.value.some(tag => tag.id === id)) ? '请选择 1–3 个有效标签。' : ''
    if (tagValidation.value) {
      await nextTick()
      const target = tagField.value?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? tagField.value
      target?.focus()
      return
    }
    if (!rights.value) { error.value = '请先确认作品发布权。'; return }
  }
  const details: PublicationDetails | undefined = direct.value ? undefined : { tagIds: [...tagIds.value], prompt: prompt.value, sourceUrl: sourceUrl.value.trim(), license: license.value.trim(), referenceIndices: [...referenceIndices.value].sort((a, b) => a - b) }
  const current = revision
  busy.value = true
  try {
    const response = await publishCreation(task.value, title.value, destination.value, text.value, content.value, details)
    if (current !== revision) return
    result.value = response.work
    notify(resultMessage.value)
  } catch (cause) { if (current === revision) { error.value = errorMessage(cause); if (!direct.value && !locked.value) { if (extra.value) extra.value.open = true; if ((cause as { status?: number }).status === 400) void loadTags() } } }
  finally { if (current === revision) busy.value = false }
}
defineExpose({ open })
</script>
<template>
  <Teleport to="body"><dialog ref="dialog" class="compact-dialog studio-publish-dialog" aria-labelledby="studio-publish-title" @cancel="busy && $event.preventDefault()">
    <div class="dialog-heading"><h2 id="studio-publish-title">{{ heading }}</h2><button class="icon-button" aria-label="关闭发布作品" :disabled="busy" @click="dialog?.close()"><X :size="18" /></button></div>
    <form v-if="task" class="dialog-body stack" @submit.prevent="submit" @invalid.capture="revealInvalid">
      <div v-if="task.urls.length" class="publish-preview"><template v-for="url in task.urls" :key="url"><video v-if="task.kind === 'video'" :src="mediaSource(url, false, 'video')" controls playsinline preload="metadata" /><img v-else :src="mediaSource(url)" :alt="task.prompt" /></template></div>
      <p v-if="direct" class="form-note">发送到<RouterLink :to="`/work/${task.sourceWorkId}`" @click="dialog?.close()">源作品评论区</RouterLink>，按社区审核设置公开。</p>
      <template v-if="!result">
        <label class="field"><span>作品标题</span><input v-model="title" class="control" maxlength="100" required :disabled="busy || locked" placeholder="给作品起一个清晰的名字" /></label>
        <label v-if="direct || category === 'resource'" class="field"><span>{{ direct ? '评论内容' : '资源内容' }}</span><textarea v-model="text" class="control" rows="3" maxlength="2500" :disabled="busy || locked" /></label>
        <template v-if="!direct">
          <fieldset ref="tagField" class="publish-tags" :disabled="busy || locked" tabindex="-1" :aria-invalid="Boolean(tagValidation)" :aria-describedby="tagValidation ? 'publish-tags-hint publish-tags-error' : 'publish-tags-hint'">
            <legend>作品标签（必选）<span>{{ tagIds.length }} / 3</span></legend>
            <p id="publish-tags-hint" class="form-note">选择 1–3 个标签，方便搜索和发现同类作品。</p>
            <p v-if="tagsLoading" role="status" class="form-note">正在加载标签…</p>
            <div v-else-if="tagsError" class="stack"><p class="form-error" role="alert">标签加载失败：{{ tagsError }}</p><button type="button" class="button subtle btn" @click="loadTags">重新加载标签</button></div>
            <PublicationTagPicker v-else-if="tags.length" :key="task.id" v-model="tagIds" :tags="tags" :kind="category" @update:model-value="tagValidation = ''" />
            <template v-else><p class="form-note">暂无可用标签，请联系管理员添加后再发布。</p><button type="button" class="button subtle btn" @click="loadTags">重新加载标签</button></template>
            <p v-if="tagValidation" id="publish-tags-error" class="form-error" role="alert">{{ tagValidation }}</p>
          </fieldset>
          <details ref="extra" class="publish-details publish-extras publication-extras"><summary><SlidersHorizontal :size="16" aria-hidden="true" /><span><span>补充信息（选填）</span><small v-if="prompt.trim() || referenceIndices.length">{{ prompt.trim() ? '含提示词' : '' }}{{ prompt.trim() && referenceIndices.length ? ' · ' : '' }}{{ referenceIndices.length ? `${referenceIndices.length} 张公开参考图` : '' }}</small></span><ChevronDown :size="16" aria-hidden="true" /></summary><div class="stack">
          <label v-if="category !== 'resource'" class="field"><span>作品简介</span><textarea v-model="text" class="control" rows="2" maxlength="2500" :disabled="busy || locked" /></label>
          <label class="field"><span>生成提示词（选填）</span><textarea v-model="prompt" class="control" rows="4" maxlength="100000" :disabled="busy || locked" aria-describedby="publish-prompt-hint" /></label>
          <p class="publish-context">{{ task.model }}</p>
          <p id="publish-prompt-hint" class="form-note">制作同款会使用这里的提示词和选中的参考图，作品简介不会作为提示词导入。</p>
          <fieldset v-if="task.references.length" class="publish-references" :disabled="busy || locked"><legend>公开参考图</legend><p class="form-note">仅勾选你希望随作品公开、供他人制作同款的参考图。</p><div class="publish-reference-options"><label v-for="(reference, index) in task.references" :key="index"><input v-model="referenceIndices" type="checkbox" :value="index" /><img :src="mediaSource(reference.url)" alt="" /><span>{{ reference.name || `参考图 ${index + 1}` }}</span></label></div></fieldset>
          <label class="field"><span>来源链接</span><input v-model="sourceUrl" class="control" type="url" maxlength="2000" placeholder="https://" :disabled="busy || locked" /></label><label class="field"><span>授权说明</span><input v-model="license" class="control" maxlength="200" :disabled="busy || locked" /></label>
          </div></details>
          <label class="publish-rights"><input v-model="rights" type="checkbox" :disabled="busy || locked" /><span>我确认拥有作品发布权，并已核实所填写的来源与授权说明。</span></label>
        </template>
        <p v-if="locked && !busy" class="form-note">将使用上次提交的内容重试，避免重复发布。</p>
        <button class="button primary btn" :disabled="busy || !title.trim()"><Send v-if="direct" :size="16" /><Upload v-else :size="16" />{{ busy ? '正在提交…' : direct ? '提交评论' : '提交作品' }}</button>
      </template>
      <div v-else class="stack"><p role="status">{{ resultMessage }}</p><RouterLink :to="resultLink" class="button primary btn" @click="dialog?.close()">{{ sourceCommentLink ? '查看源作品评论' : '查看提交' }}</RouterLink></div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </form>
  </dialog></Teleport>
</template>
<style scoped>
.studio-publish-dialog { width: 640px; }
.publish-preview { display: flex; gap: 8px; overflow-x: auto; max-height: 200px; }
.publish-preview img, .publish-preview video { width: min(220px, 70vw); max-height: 200px; object-fit: contain; border-radius: 8px; background: var(--surface); }
.form-note a { color: var(--blue); }
.publish-context { margin: 0; overflow-wrap: anywhere; font-weight: 500; }
.studio-publish-dialog .dialog-body > .button { position: sticky; bottom: 0; flex: none; }
.publish-tags, .publish-references { border: 0; padding: 0; margin: 0; min-width: 0; }
.publish-tags legend, .publish-references legend { padding: 0; margin-bottom: 8px; }
.publish-tags legend span { color: var(--muted); margin-left: 8px; font-size: 12px; }
.publish-reference-options { display: grid; gap: 8px; margin-top: 12px; }
.publish-reference-options label { display: flex; gap: 12px; align-items: center; min-height: 44px; overflow-wrap: anywhere; }
.publish-reference-options img { width: 48px; height: 48px; object-fit: cover; border-radius: 4px; }
.publish-reference-options span { min-width: 0; }
.publish-rights { display: flex; align-items: flex-start; gap: 12px; font-size: 14px; line-height: 22px; min-height: 44px; }
.publish-rights input { margin-top: 4px; flex-shrink: 0; }
@media (max-width: 639px) { .studio-publish-dialog { max-width: calc(100vw - 16px); } }

</style>
