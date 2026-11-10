<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<span :class="$style.root">
	<button type="button" class="_button" :class="{ [$style.liked]: displayLiked }" :aria-label="`${displayLiked ? t.likedComment : t.likeComment} ${displayCount}`" :aria-pressed="displayLiked" :aria-busy="working || reactionBusy" :disabled="working || reactionBusy" data-testid="comment-like" @click="like"><i :class="displayLiked ? 'ti ti-heart-filled' : 'ti ti-heart'" aria-hidden="true"></i><span>{{ failed ? t.retry : displayCount }}</span></button>
	<span v-if="failed" role="alert" :class="$style.error">{{ t.interactionFailed }}</span>
</span>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { workText as t } from './interactions-copy.js';
import type { entities } from 'misskey-js';
import { useWorkInteractions } from '@/pages/home/use-work-interactions.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';

const props = defineProps<{ note: entities.Note }>();
const emit = defineEmits<{ (event: 'login'): void }>();
const { note: verified, myReaction, liked, likes, otherReaction, reactionBusy, reactionFailed, refreshNote, toggleLike } = useWorkInteractions(() => props.note.id, { immediate: false, publicOnly: false, loadComments: () => false });
const isHeart = (value?: string | null) => value?.replaceAll('\uFE0F', '') === '❤';
const displayLiked = computed(() => myReaction.value === undefined ? isHeart(props.note.myReaction) : liked.value);
const displayCount = computed(() => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(verified.value ? likes.value : Object.entries(props.note.reactions).reduce((sum, [reaction, count]) => sum + (isHeart(reaction) ? count : 0), 0)));
const working = ref(false);
const failed = ref(false);
let active = true;
let generation = 0;

watch(() => props.note, () => {
	if (working.value || reactionBusy.value) return;
	verified.value = null;
	myReaction.value = undefined;
});

async function like() {
	if (!$i) { emit('login'); return; }
	if (!active || working.value || reactionBusy.value) return;
	const target = !displayLiked.value, ticket = generation, actor = $i.id;
	const current = () => active && ticket === generation && actor === $i?.id;
	working.value = true; failed.value = false;
	try {
		if (!await refreshNote()) { if (current()) failed.value = true; return; }
		if (!current() || liked.value === target) return;
		if (otherReaction.value && (await os.confirm({ type: 'question', text: t.replaceReaction })).canceled) return;
		if (!current()) return;
		await toggleLike();
		if (current()) failed.value = reactionFailed.value;
	} catch { if (current()) failed.value = true; } finally { if (current()) working.value = false; }
}

function reset() { generation++; working.value = false; failed.value = false; }

watch([() => props.note.id, () => $i?.id], reset);
onActivated(() => { active = true; });
onDeactivated(() => { active = false; reset(); });
onBeforeUnmount(() => { active = false; reset(); });
</script>

<style lang="scss" module>
.root { display: inline-flex; align-items: center; flex-wrap: wrap; margin-left: auto; max-width: 140px; color: var(--MI_THEME-fgTransparentWeak); }
.root button { display: inline-flex; justify-content: center; align-items: center; gap: 4px; min-width: 44px; min-height: 44px; padding: 0 2px; font: inherit; }
.root i { font-size: 20px; }
.root .liked { color: var(--MI_THEME-accent); }
.root :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: -2px; }
.error { font-size: 12px; color: var(--MI_THEME-error); }
</style>
