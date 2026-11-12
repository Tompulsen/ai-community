<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowUpRight } from '@lucide/vue'
import { accountCenterUrl } from '../state'
const route = useRoute(), router = useRouter()
const props = defineProps<{ resetToken?: string }>()
const emit = defineEmits<{ done: [] }>()
const recoveryUrl = computed(() => accountCenterUrl('forgot-password'))
onMounted(async () => {
  if (props.resetToken) await router.replace({ path: route.path, query: { ...route.query, reset: undefined } })
})
</script>
<template>
  <section class="panel-section stack password-recovery">
    <h2>找回章鱼账号密码</h2>
    <p class="muted">请通过章鱼账户中心找回密码，社区与创作台使用同一个章鱼账号。</p>
    <a v-if="recoveryUrl" :href="recoveryUrl" class="button primary btn" target="_blank" rel="noopener noreferrer">找回章鱼账号密码<ArrowUpRight :size="16" /></a>
    <button type="button" class="text-link" @click="emit('done')">返回登录</button>
  </section>
</template>

<style scoped>
.password-recovery { max-width: 640px; padding-block: 24px 32px; gap: 24px; }
.password-recovery h2 { font-size: 18px; line-height: 28px; }
.password-recovery > .button, .password-recovery > .text-link { align-self: flex-start; min-height: 44px; }
.password-recovery > .muted { font-size: 14px; line-height: 24px; max-width: 56ch; }
@media (max-width: 639px) { .password-recovery > .button { width: 100%; } }
</style>
