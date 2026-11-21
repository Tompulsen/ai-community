<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, Gift, ImagePlus, Users } from '@lucide/vue'
import { welfareTaskSchema, type WelfareTask, type PublicationStatus } from '../../shared/welfare-tasks'
import type { ReferralStatus } from '../../shared/referral'
import { api, errorMessage, session } from '../state'
import ReferralBenefits from './ReferralBenefits.vue'

interface Rule { enabled: boolean; threshold: number; tickets: number }
const props = defineProps<{ lottery: {
  settings: { enabled: boolean; likes: Rule; followers: Rule; likesMode: string }
  counts: { likes: number; bestWorkLikes: number; followers: number }
} | null; rulesLoading: boolean }>()
const route = useRoute(), router = useRouter()
const items = ref<WelfareTask[]>([]), loading = ref(true), error = ref('')
const invitation = ref<ReferralStatus | null>(null)
const publication = ref<PublicationStatus | null>(null), currentTime = ref(Date.now())
let clockOffset = 0, lastRefresh = 0, timer: ReturnType<typeof setInterval> | undefined
const cooldown = computed(() => publication.value?.resetsAt ? Math.max(0, Math.ceil((Date.parse(publication.value.resetsAt) - currentTime.value) / 1000)) : 0)
const cooldownText = computed(() => [Math.floor(cooldown.value / 3600), Math.floor(cooldown.value % 3600 / 60), cooldown.value % 60].map(value => String(value).padStart(2, '0')).join(':'))
const resetLabel = computed(() => publication.value?.resetsAt ? new Date(publication.value.resetsAt).toLocaleString('zh-CN', { hour12: false }) : '')
const inviteExpanded = ref(Boolean(route.query.aff || route.query.invite))
const icons = { invite: Users, publish: ImagePlus, upcoming: Gift }
const hasInvite = computed(() => items.value.some(item => item.id === 'invite'))
const points = (amount: number) => amount.toLocaleString('zh-CN', { maximumFractionDigits: 20 })
const publishRules = computed(() => {
  if (!props.lottery?.settings.enabled) return []
  const { settings, counts } = props.lottery
  return [
    { id: 'likes', rule: settings.likes, label: settings.likesMode === 'work' ? '每件公开作品每获' : '公开作品累计每获',
      unit: '赞', count: settings.likesMode === 'work' ? counts.bestWorkLikes : counts.likes,
      progress: settings.likesMode === 'work' ? '最高单件作品获赞' : '作品累计获赞' },
    { id: 'followers', rule: settings.followers, label: '每收获', unit: '位关注者', count: counts.followers, progress: '当前关注者' },
  ].filter(item => item.rule.enabled)
})
let requestId = 0, controller: AbortController | undefined
async function load(background = false) {
  const id = ++requestId, owner = session.user?.id
  const current = () => id === requestId && session.user?.id === owner
  controller?.abort(); controller = new AbortController()
  lastRefresh = Date.now()
  if (!background) { loading.value = true; error.value = ''; items.value = []; invitation.value = null; publication.value = null }
  try {
    const data = await api<{ items: unknown; publication?: PublicationStatus | null }>('/api/welfare/tasks', { signal: controller.signal })
    const parsed = welfareTaskSchema.array().max(3).safeParse(data.items)
    if (!parsed.success || new Set(parsed.data.map(item => item.id)).size !== parsed.data.length) throw new Error('福利任务数据无效，请重试。')
    if (current()) {
      items.value = parsed.data.filter(item => item.enabled); publication.value = owner ? data.publication ?? null : null
      clockOffset = publication.value ? Date.parse(publication.value.serverTime) - Date.now() : 0
      currentTime.value = Date.now() + clockOffset; error.value = ''
    }
  } catch (cause) { if (current()) error.value = errorMessage(cause) }
  finally { if (current()) loading.value = false }
}
function publish() {
  const target = { path: '/activities', query: { ...route.query, tab: 'tasks', publish: '1' } }
  void router.push(session.user ? target : { path: '/account', query: { returnTo: router.resolve(target).fullPath } })
}
function tick() {
  if (document.visibilityState === 'hidden') return
  currentTime.value = Date.now() + clockOffset
  if (Date.now() - lastRefresh >= 30000) void load(true)
}
function resume() { if (document.visibilityState !== 'hidden') void load(true) }
watch(() => session.user?.id, () => { void load() }, { flush: 'sync' })
onMounted(() => { void load(); timer = setInterval(tick, 1000); window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume) })
onBeforeUnmount(() => { requestId++; controller?.abort(); clearInterval(timer); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume) })
defineExpose({ refresh: load })
</script>

<template>
  <div class="welfare-tasks">
    <p v-if="loading" class="task-feedback" role="status">正在读取福利任务…</p>
    <div v-else-if="error" class="task-feedback" role="alert"><p>{{ error }}</p><button type="button" class="button btn" @click="load()">重新读取任务</button></div>
    <p v-else-if="!items.length" class="task-feedback" role="status">暂无开放的福利任务，请稍后再来。</p>
    <template v-else>
      <ul class="welfare-task-list" aria-label="社区福利任务">
        <li v-for="item in items" :key="item.id" :data-task="item.id">
          <component :is="icons[item.id]" :size="22" class="task-icon" aria-hidden="true" />
          <div class="task-content">
            <h2>{{ item.title }}<span v-if="item.id === 'upcoming'" class="task-state">未开放</span><span v-else-if="item.id === 'invite' && invitation && !invitation.config.enabled" class="task-state">新邀请已暂停</span></h2>
            <template v-if="item.id === 'invite'">
              <template v-if="invitation">
                <template v-if="invitation.config.enabled">
                  <p class="task-award">你得 <strong>{{ points(invitation.config.inviterPoints) }}</strong> · 好友得 <strong>{{ points(invitation.config.inviteePoints) }}</strong> 永久积分</p>
                  <p class="task-condition">新朋友通过邀请链接注册后，任意一笔充值{{ invitation.config.minTopupCny > 0 ? `实付满 ¥${invitation.config.minTopupCny.toFixed(2)}` : '实际支付大于 0' }}，双方自动获奖。</p>
                </template>
                <p v-if="!invitation.config.enabled" class="task-condition">已绑定邀请仍按绑定时的规则发放。</p>
              </template>
              <p v-else class="task-condition">展开查看当前邀请奖励、充值条件及邀请记录。</p>
            </template>
            <template v-else-if="item.id === 'publish'">
              <div v-if="item.publicationReward" class="publication-task">
                <template v-if="item.publicationReward.enabled">
                  <p class="task-award">发布 <strong>{{ item.publicationReward.threshold }}</strong> 个作品，获得 <strong>{{ item.publicationReward.tickets }}</strong> 次抽奖机会</p>
                  <p class="task-condition">达标自动到账，每轮限领一次；到账后满 24 小时重置，冷却期间发布不计入下一轮。</p>
                  <template v-if="session.user && publication">
                    <template v-if="cooldown > 0">
                      <p class="publication-progress">本轮已到账 {{ publication.rewardTickets }} 次抽奖机会</p>
                      <p class="task-condition">距离下一轮 {{ cooldownText }} · {{ resetLabel }} 可重新参与（本地时间）</p>
                    </template>
                    <p v-else class="publication-progress">本轮进度：{{ publication.resetsAt ? 0 : publication.count }} / {{ item.publicationReward.threshold }} 个作品</p>
                  </template>
                  <p v-else-if="!session.user" class="task-condition">登录后查看你的任务进度。</p>
                  <p v-else class="task-condition">任务进度暂时无法读取，请刷新后重试。</p>
                  <p class="task-condition">仅计首次公开的社区作品；待审核作品通过后计入。编辑、重新上架和历史作品不重复计数。抽奖仍需满足活动参与条件。</p>
                </template>
                <p v-else class="task-condition">发作品送抽奖次数已暂停，已到账的次数与冷却记录保留。</p>
              </div>
              <p v-if="rulesLoading" class="task-condition" role="status">正在读取作品福利规则…</p>
              <p v-else-if="!lottery" class="task-condition">作品福利规则暂时无法读取，可刷新后重试。你仍可以发布作品。</p>
              <template v-else-if="publishRules.length">
                <div v-for="entry in publishRules" :key="entry.id" class="task-rule">
                  <p>{{ entry.label }} <strong>{{ entry.rule.threshold }}</strong> {{ entry.unit }}，获得 <strong>{{ entry.rule.tickets }}</strong> 次抽奖机会</p>
                  <p v-if="session.user" class="task-condition">{{ entry.progress }}：{{ entry.count }}{{ entry.unit === '赞' ? ' 赞' : ' 人' }}</p>
                </div>
                <p class="task-condition">公开作品的有效互动按活动规则统计；发布本身不直接赠送积分。参与抽奖仍需满足活动页的条件。</p>
              </template>
              <p v-else-if="!item.publicationReward?.enabled" class="task-condition">作品获赞与关注福利暂未开放。你仍可以发布作品，分享创作。</p>
            </template>
            <p v-if="item.description" class="task-description">{{ item.description }}</p>
          </div>
          <button v-if="item.id === 'invite'" type="button" class="button btn task-action" :aria-expanded="inviteExpanded" aria-controls="welfare-invitation-details" @click="inviteExpanded = !inviteExpanded">{{ item.buttonText }}<ArrowRight :size="16" aria-hidden="true" /></button>
          <button v-else-if="item.id === 'publish'" type="button" class="button btn task-action" @click="publish">{{ item.buttonText }}<ArrowRight :size="16" aria-hidden="true" /></button>
          <button v-else type="button" class="button subtle btn task-action" disabled>{{ item.buttonText }}</button>
        </li>
      </ul>
      <div v-if="hasInvite" id="welfare-invitation-details" v-show="inviteExpanded" class="task-details"><ReferralBenefits @status="invitation = $event" /></div>
    </template>
  </div>
</template>

<style scoped>
.welfare-tasks { padding-block: var(--space-group); }
.welfare-task-list { margin: 0; padding: 0; list-style: none; }
.welfare-task-list > li { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: var(--space-group); align-items: start; padding-block: var(--space-section); border-bottom: 1px solid var(--border); }
.task-icon { margin-top: 3px; color: var(--muted); }
.task-content { min-width: 0; }
.task-content h2 { display: flex; flex-wrap: wrap; gap: var(--space-control); align-items: center; margin: 0 0 var(--space-small); font-size: 20px; line-height: 28px; overflow-wrap: anywhere; }
.task-content p { margin: 0; line-height: 24px; overflow-wrap: anywhere; text-wrap: pretty; }
.task-content p + p, .task-rule + .task-rule, .task-rule + p { margin-top: var(--space-small); }
.task-state { color: var(--muted); font-size: 12px; font-weight: 400; }
.task-award strong { font-variant-numeric: tabular-nums; color: var(--blue); }
.publication-task { margin-bottom: var(--space-control); }
.publication-progress { font-weight: 600; font-variant-numeric: tabular-nums; }
.task-condition, .task-description { color: var(--muted); }
.task-action { min-height: var(--target-size); max-width: 240px; white-space: normal; overflow-wrap: anywhere; }
.task-action:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.task-details { min-width: 0; }
.task-feedback { padding-block: var(--space-section); }
@media (max-width: 700px) {
  .welfare-task-list > li { grid-template-columns: 22px minmax(0, 1fr); gap: var(--space-control); padding-block: var(--space-group); }
  .task-content h2 { font-size: 18px; }
  .task-action { grid-column: 2; justify-self: start; max-width: 100%; }
}
</style>
