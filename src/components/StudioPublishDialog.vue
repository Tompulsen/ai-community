<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Send, Upload, X } from '@lucide/vue'
import { api, errorMessage, notify, session } from '../state'
import type { Work } from '../data'
import { mediaSource, publishCreation, type CreationDestination, type CreationTask } from '../native-studio'
const dialog = ref<HTMLDialogElement>(), task = ref<CreationTask>(), destination = ref<CreationDestination>('community')
const title = ref(''), text = ref(''), error = ref(''), busy = ref(false), result = ref<Work>()
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
async function open(value: CreationTask, target: CreationDestination = 'community') {
  if (busy.value || value.phase !== 'complete' || value.owner !== session.user?.id) return
  const current = ++revision
  task.value = value; destination.value = target; error.value = ''; result.value = undefined
  const previous = value.publications?.[target]
  title.value = previous?.title || (target === 'source-comment' ? '我的同款作品' : value.prompt.slice(0, 50))
  text.value = previous?.text ?? (value.kind === 'text' ? value.text : target === 'source-comment' ? '我用同款提示词创作了新作品' : value.prompt).slice(0, 2500)
  await nextTick(); if (current !== revision) return
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
  const current = revision
  busy.value = true; error.value = ''
  try {
    const response = await publishCreation(task.value, title.value, destination.value, text.value)
    if (current !== revision) return
    result.value = response.work
    notify(resultMessage.value)
  } catch (cause) { if (current === revision) error.value = errorMessage(cause) }
  finally { if (current === revision) busy.value = false }
}
defineExpose({ open })
</script>
<template>
  <Teleport to="body"><dialog ref="dialog" class="compact-dialog studio-publish-dialog" aria-labelledby="studio-publish-title" @cancel="busy && $event.preventDefault()">
    <div class="dialog-heading"><h2 id="studio-publish-title">{{ heading }}</h2><button class="icon-button" aria-label="关闭发布作品" :disabled="busy" @click="dialog?.close()"><X :size="18" /></button></div>
    <form v-if="task" class="dialog-body stack" @submit.prevent="submit">
      <div v-if="task.urls.length" class="publish-preview"><template v-for="url in task.urls" :key="url"><video v-if="task.kind === 'video'" :src="mediaSource(url, false, 'video')" controls playsinline preload="metadata" /><img v-else :src="mediaSource(url)" :alt="task.prompt" /></template></div>
      <p v-if="direct" class="form-note">发送到<RouterLink :to="`/work/${task.sourceWorkId}`" @click="dialog?.close()">源作品评论区</RouterLink>，按社区审核设置公开。</p>
      <template v-if="!result"><label class="field"><span>作品标题</span><input v-model="title" class="control" maxlength="100" required :disabled="busy || locked" /></label><label class="field"><span>{{ direct ? '评论内容' : '创作说明' }}</span><textarea v-model="text" class="control" rows="3" maxlength="2500" :disabled="busy || locked" /></label><p v-if="locked && !busy" class="form-note">将使用上次提交的内容重试，避免重复发布。</p><button class="button primary btn" :disabled="busy || !title.trim()"><Send v-if="direct" :size="16" /><Upload v-else :size="16" />{{ busy ? '正在提交…' : direct ? '提交评论' : '提交作品' }}</button></template>
      <div v-else class="stack"><p role="status">{{ resultMessage }}</p><RouterLink :to="resultLink" class="button primary btn" @click="dialog?.close()">{{ sourceCommentLink ? '查看源作品评论' : '查看提交' }}</RouterLink></div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </form>
  </dialog></Teleport>
</template>
<style scoped>
.publish-preview { display: flex; gap: 8px; overflow-x: auto; max-height: 200px; }
.publish-preview img, .publish-preview video { width: min(220px, 70vw); max-height: 200px; object-fit: contain; border-radius: 8px; background: var(--surface); }
.form-note a { color: var(--blue); }
</style>
