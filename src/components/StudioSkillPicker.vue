<script setup lang="ts">
import { computed, ref } from 'vue'
import { Puzzle } from '@lucide/vue'
import { chats, type NativeChat } from '../native-chat'
import { countSkillChoices, type SkillKind } from '../../shared/community-skills'
import { selectedSkillIds } from '../community-skill'
import StudioPopover from './StudioPopover.vue'
import StudioSkills from './StudioSkills.vue'
const props = withDefaults(defineProps<{ chat: NativeChat; kind?: SkillKind; transient?: boolean; disabled?: boolean }>(), { kind: 'text' })
const loaded = ref(false)
const count = computed(() => countSkillChoices(selectedSkillIds(props.chat, props.kind), chats.skills))
</script>
<template>
  <StudioPopover label="技能与工具" :width="480" :disabled="disabled" @toggle="loaded ||= $event">
    <template #trigger><Puzzle :size="16" aria-hidden="true" /><span>技能{{ count ? ` ${count}` : '' }}</span></template>
    <StudioSkills v-if="loaded" :chat="chat" :kind="kind" :transient="transient" :disabled="disabled" embedded />
  </StudioPopover>
</template>
