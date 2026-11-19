<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Save } from '@lucide/vue'
import type { ReferralConfig } from '../../shared/referral'
import { api, errorMessage, notify } from '../state'

const draft = ref<ReferralConfig | null>(null), baseline = ref(''), busy = ref(false), error = ref(''), saved = ref(false)
const hasUnsavedChanges = computed(() => !!draft.value && JSON.stringify(draft.value) !== baseline.value)
defineExpose({ hasUnsavedChanges })
const controller = new AbortController()
async function load() {
  busy.value = true; error.value = ''
  try { draft.value = await api<ReferralConfig>('/api/admin/referrals/config', { signal: controller.signal }); baseline.value = JSON.stringify(draft.value) }
  catch { if (!controller.signal.aborted) error.value = '邀请福利配置暂时无法读取，请重试。' }
  finally { busy.value = false }
}
async function save() {
  if (!draft.value || busy.value) return
  busy.value = true; error.value = ''; saved.value = false
  try {
    draft.value = await api<ReferralConfig>('/api/admin/referrals/config', { method: 'PATCH', body: draft.value, signal: controller.signal })
    baseline.value = JSON.stringify(draft.value); saved.value = true; notify('邀请福利配置已保存。')
  } catch (cause) {
    if (!controller.signal.aborted) error.value = errorMessage(cause) === 'REFERRAL_CONFLICT' ? '配置已被更新。请重新读取后再修改，当前填写内容已保留。' : '保存未成功，请重试；不会重复发放奖励。'
  } finally { busy.value = false }
}
onMounted(load)
onBeforeUnmount(() => controller.abort())
</script>

<template>
  <section class="panel-section admin-referral" aria-labelledby="admin-referral-heading">
    <h2 id="admin-referral-heading">邀请充值福利</h2>
    <p class="form-note">新人通过邀请链接注册并绑定后，首次成功充值即可让双方获得永久积分。充值金额不限，实际支付须大于 0；每位新人只发一次。</p>
    <p v-if="!draft && busy" role="status">正在读取邀请福利配置…</p>
    <p v-if="error" class="form-error" role="alert">{{ error }} <button type="button" class="text-button" :disabled="busy" @click="load">重新读取配置</button></p>
    <form v-if="draft" class="stack" @submit.prevent="save">
      <fieldset class="fieldset stack" :disabled="busy">
        <label class="check-label"><input v-model="draft.enabled" type="checkbox" @change="saved = false" />开放新邀请福利</label>
        <div class="fields"><label class="field"><span>邀请人奖励（永久积分）</span><input v-model.number="draft.inviterPoints" class="control" type="number" inputmode="numeric" min="1" max="100000000" step="1" required @input="saved = false" /></label><label class="field"><span>新人奖励（永久积分）</span><input v-model.number="draft.inviteePoints" class="control" type="number" inputmode="numeric" min="1" max="100000000" step="1" required @input="saved = false" /></label></div>
        <p class="form-note">修改仅对之后绑定的新邀请生效；已绑定的邀请保留原额度。关闭后停止新绑定，已有待充值或待发放记录继续兑现。</p>
        <div class="table-actions"><button class="button primary btn" :disabled="!hasUnsavedChanges"><Save :size="16" />{{ busy ? '正在保存…' : '保存邀请福利' }}</button><span v-if="saved" role="status">已保存</span></div>
      </fieldset>
    </form>
  </section>
</template>

<style scoped>
.admin-referral { display: grid; gap: 16px; }
.admin-referral h2, .admin-referral p { margin: 0; }
.admin-referral .btn { min-height: 44px; }
.admin-referral .fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.admin-referral .check-label { min-height: 44px; }
.text-button { min-height: 44px; padding: 8px; text-decoration: underline; }
</style>
