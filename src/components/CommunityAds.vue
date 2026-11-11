<script setup lang="ts">
import { computed, ref } from 'vue'
import { ExternalLink } from '@lucide/vue'
import { api, safeExternalUrl } from '../state'
const props = defineProps<{ slots?: string[] }>()
const items = ref<{ id: string; title: string; imageUrl: string; linkUrl: string }[]>([])
const shown = computed(() => items.value.filter(item => (!props.slots || props.slots.includes(item.id)) && safeExternalUrl(item.linkUrl) && safeExternalUrl(item.imageUrl)))
void api<{ items: typeof items.value }>('/api/community/ads').then(value => { items.value = value.items }).catch(() => {})
</script>
<template>
  <aside v-if="shown.length" class="community-ads" aria-label="社区推广"><a v-for="item in shown" :key="item.id" :href="safeExternalUrl(item.linkUrl)" target="_blank" rel="sponsored noopener noreferrer"><img :src="safeExternalUrl(item.imageUrl)" :alt="item.title" loading="lazy" /><span>{{ item.title }}<ExternalLink :size="14" /></span></a></aside>
</template>
<style scoped>
.community-ads { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--border); }
.community-ads a { min-width: 0; }.community-ads img { width: 100%; max-height: 160px; object-fit: contain; border-radius: 6px; background: var(--surface-soft); }.community-ads span { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; margin-top: 8px; overflow-wrap: anywhere; }
@media (max-width: 639px) { .community-ads { grid-template-columns: 1fr; } }
</style>
