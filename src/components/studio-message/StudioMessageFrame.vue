<!-- Message alignment/header adapted from octopus_chat chat.tsx and chat.module.scss (MIT). -->
<script setup lang="ts">
import { computed } from 'vue'
import { session } from '../../state'

const props = defineProps<{ role: 'user' | 'assistant' | 'system'; model?: string; createdAt?: number }>()
const time = computed(() => props.createdAt && Number.isFinite(props.createdAt)
  ? new Date(props.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '')
</script>

<template>
  <article class="studio-message" :class="role">
    <header class="message-heading">
      <template v-if="role === 'user'">
        <img v-if="session.user?.avatarUrl" :src="session.user.avatarUrl" class="message-avatar" width="28" height="28" alt="你的头像" />
        <span v-else class="message-avatar" aria-label="你的头像">{{ (session.user?.name || session.user?.username || '你').slice(0, 1) }}</span>
      </template>
      <template v-else>
        <img src="/assets/brand/octopus-community.jpg" class="message-avatar" width="28" height="28" alt="" />
        <strong>{{ role === 'system' ? '系统' : model || '助手' }}</strong>
        <time v-if="time" :datetime="new Date(createdAt!).toISOString()">{{ time }}</time>
        <slot name="status" />
      </template>
    </header>
    <slot />
    <time v-if="role === 'user' && time" class="message-user-time" :datetime="new Date(createdAt!).toISOString()">{{ time }}</time>
  </article>
</template>

<style scoped>
.studio-message { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; padding-block: 16px; }
.studio-message.user { align-items: flex-end; }
.message-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 32px; max-width: 100%; margin-bottom: 10px; color: var(--muted); font-size: 12px; line-height: 20px; }
.message-heading strong { color: var(--ink); font-weight: 500; min-width: 0; overflow-wrap: anywhere; }
.message-heading time, .message-user-time { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.message-avatar { display: grid; place-items: center; flex: none; width: 28px; height: 28px; border-radius: 6px; background: var(--surface-soft); color: var(--ink); object-fit: cover; }
.user .message-heading { justify-content: flex-end; }
.message-user-time { margin-top: 6px; order: 1; }
.user :deep(.message-actions) { order: 2; }
.studio-message.user :deep(.message-bubble) { max-width: min(65ch, 85%); min-width: 0; padding: 12px 16px; border-radius: 16px 16px 6px 16px; background: var(--surface-soft); color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 16px; line-height: 28px; }
.studio-message :deep(.message-bubble > p) { margin: 0; }
@media (max-width: 639px) { .studio-message { padding-block: 12px; }.studio-message.user :deep(.message-bubble) { max-width: 92%; padding: 12px; }.message-heading { gap: 6px; } }
</style>
