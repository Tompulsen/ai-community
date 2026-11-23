<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { ChevronDown, Play, Plug, RefreshCw } from '@lucide/vue'
import { api, errorMessage, session } from '../state'
import { chats, saveChats as persistChats, type NativeChat, type Skill } from '../native-chat'
import { verifySkillDocument } from '../../shared/studio/catalog'
import { resolveCommunitySkill } from '../community-skill'
const props = defineProps<{ chat: NativeChat; embedded?: boolean; transient?: boolean }>()
function saveChats(required = false) { if (!props.transient) return persistChats(required) }
const loading = ref(false), error = ref(''), query = ref(''), enabled = ref(false), servers = ref<{ id: string; status: string }[]>([])
const server = ref(''), tool = ref(''), tools = ref<{ name: string; description?: string; inputSchema?: unknown }[]>([]), args = ref('{}'), result = ref(''), busy = ref(false), config = ref('{"mcpServers":{}}')
let revision = 0
const unavailable = computed(() => props.chat.skillIds.filter(id => !chats.skills.some(skill => skill.id === id)))
async function removeUnavailable() {
  props.chat.skillIds = props.chat.skillIds.filter(id => !unavailable.value.includes(id))
  try { await saveChats(true); error.value = '' } catch (cause) { error.value = errorMessage(cause) }
}
onUnmounted(() => revision++)
async function load() {
  const current = ++revision, owner = session.user?.id
  loading.value = true; error.value = ''
  try {
    const [skills, mcp] = await Promise.all([api<{ items: Skill[] }>('/api/creation/skills/catalog'), api<{ enabled: boolean; items: typeof servers.value }>('/api/creation/mcp/status')])
    if (current !== revision || owner !== session.user?.id) return
    chats.skills = skills.items || []; enabled.value = mcp.enabled === true; servers.value = mcp.items || []
  } catch (cause) { if (current === revision && owner === session.user?.id) error.value = errorMessage(cause) }
  finally { if (current === revision) loading.value = false }
}
watch(() => session.user?.id, () => { result.value = ''; server.value = ''; tools.value = []; enabled.value = false; void load() }, { immediate: true })
async function toggle(skill: Skill, event: Event) {
  const input = event.target as HTMLInputElement
  const chat = props.chat, owner = session.user?.id
  const selected = input.checked
  input.disabled = true
  try {
    if (selected) {
      const document = await resolveCommunitySkill(skill, owner)
      await verifySkillDocument(document.body, document.sha256)
    }
    if (owner !== session.user?.id) return
    if (selected) { if (!chat.skillIds.includes(skill.id)) chat.skillIds.push(skill.id) }
    else chat.skillIds = chat.skillIds.filter(id => id !== skill.id)
    await saveChats(true)
  } catch (cause) { if (owner === session.user?.id) { error.value = errorMessage(cause); input.checked = chat.skillIds.includes(skill.id) } }
  finally { input.disabled = false }
}
async function listTools() {
  tools.value = []; tool.value = ''; error.value = ''
  if (!server.value) return
  try { const data = await api<{ tools: typeof tools.value }>(`/api/creation/mcp/tools?server=${encodeURIComponent(server.value)}`); tools.value = data.tools; tool.value = data.tools[0]?.name || '' }
  catch (cause) { error.value = errorMessage(cause) }
}
async function call() {
  if (busy.value) return
  const owner = session.user?.id, chat = props.chat
  busy.value = true; error.value = ''
  try {
    const parameters = JSON.parse(args.value)
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error('工具参数须为 JSON 对象。')
    const data = await api('/api/creation/mcp/call', { method: 'POST', body: { server: server.value, name: tool.value, arguments: parameters, requestId: crypto.randomUUID() } })
    if (owner !== session.user?.id) return
    result.value = JSON.stringify(data, null, 2)
    chat.toolContext = result.value; await saveChats(true)
  } catch (cause) { if (owner === session.user?.id) error.value = errorMessage(cause) }
  finally { busy.value = false }
}
async function saveConfig() {
  busy.value = true
  try { await api('/api/creation/mcp/config', { method: 'POST', body: JSON.parse(config.value) }); await load() }
  catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}
</script>
<template>
  <details class="skills-panel" :class="{ embedded }" :open="embedded"><summary v-show="!embedded">技能与工具<span v-if="chat.skillIds.length"> · {{ chat.skillIds.length }}</span></summary>
    <div class="skills-heading"><input v-model="query" class="control" type="search" placeholder="搜索技能" aria-label="搜索技能" /><button class="icon-button" title="刷新技能" aria-label="刷新技能" :disabled="loading" @click="load"><RefreshCw :size="16" /></button></div>
    <p class="skill-empty muted"><RouterLink to="/skills">浏览技能广场 / 上传技能</RouterLink></p>
    <p v-if="loading" class="muted" role="status">正在读取技能…</p><p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="!loading && unavailable.length" class="skill-empty muted">{{ unavailable.length }} 个已选技能已下架或不可用。<button class="button subtle btn" @click="removeUnavailable">移除失效技能</button></p>
    <div class="skill-list"><label v-for="skill in chats.skills.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase()))" :key="skill.id" class="skill-row"><span><strong>{{ skill.name }}</strong><span>{{ skill.description }}</span></span><input type="checkbox" :aria-label="skill.name" :checked="chat.skillIds.includes(skill.id)" @change="toggle(skill, $event)" /></label><p v-if="!loading && !chats.skills.some(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase()))" class="muted skill-empty">{{ query ? '没有匹配的技能' : '暂无可用技能' }}</p></div>
    <details class="mcp-section"><summary><Plug :size="18" /><span>MCP 工具</span><ChevronDown :size="15" /></summary><p v-if="!enabled" class="muted">当前账号未启用 MCP 工具。</p>
    <div class="model-tools" v-show="enabled"><label v-for="item in servers" :key="item.id" class="skill-row"><input v-model="chat.settings.mcpServers" type="checkbox" :value="item.id" :disabled="item.status === 'paused'" @change="saveChats()" /><span>允许模型使用 {{ item.id }}</span></label></div>
    <template v-if="enabled">
      <label class="field"><span>工具服务</span><select v-model="server" class="control" @change="listTools"><option value="">选择服务</option><option v-for="item in servers" :key="item.id" :value="item.id">{{ item.id }} · {{ item.status }}</option></select></label>
      <template v-if="server">
        <label class="field"><span>工具</span><select v-model="tool" class="control"><option v-for="item in tools" :key="item.name" :value="item.name">{{ item.name }}</option></select></label>
        <p class="muted">{{ tools.find(item => item.name === tool)?.description }}</p>
        <details v-if="tools.find(item => item.name === tool)?.inputSchema"><summary>参数定义</summary><pre>{{ JSON.stringify(tools.find(item => item.name === tool)?.inputSchema, null, 2) }}</pre></details>
        <label class="field"><span>调用参数 JSON</span><textarea v-model="args" class="control" rows="5" /></label>
        <button class="button subtle btn" :disabled="busy || !tool" @click="call"><Play :size="16" />{{ busy ? '正在执行…' : '执行工具' }}</button>
      </template>
      <details><summary>管理 MCP 服务</summary><label class="field"><span>服务配置 JSON</span><textarea v-model="config" class="control" rows="6" /></label><button class="button subtle btn" :disabled="busy" @click="saveConfig">保存配置</button></details>
    </template>
    <pre v-if="result">{{ result }}</pre><button v-if="chat.toolContext" class="button subtle btn" @click="chat.toolContext = ''; result = ''; saveChats()">移除本轮工具结果</button>
    </details>
  </details>
</template>
<style scoped>
.skills-panel { margin-top: 24px; padding-top: 16px; }summary { cursor: pointer; font-size: 14px; }.skills-heading { display: flex; gap: 8px; margin-block: 16px; }.skills-heading input { min-width: 0; width: 100%; }.skill-list { max-height: 320px; overflow-y: auto; }.skill-row { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 10px 8px; border-radius: 6px; cursor: pointer; }.skill-icon { flex: none; color: var(--muted); }.skill-row input { flex: none; width: 16px; height: 16px; margin: 0; accent-color: var(--ink); }.skill-row > span { flex: 1; min-width: 0; display: grid; gap: 4px; font-size: 12px; line-height: 20px; overflow-wrap: anywhere; }.skill-row strong { color: var(--ink); font-size: 14px; font-weight: 500; }.skill-row span span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--muted); }.skill-row:hover:not(:has(:disabled)) { color: var(--ink); background: var(--state-hover); }.skill-row:has(:checked) { color: var(--ink); background: var(--state-selected); }.skill-row:has(:checked):hover:not(:has(:disabled)), .skill-row:active:not(:has(:disabled)) { color: var(--ink); background: var(--state-pressed); }.skill-row:is(:hover:not(:has(:disabled)), :has(:checked)) :is(.skill-icon, span span) { color: var(--ink); }.skill-row:has(:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: -2px; }.field { margin-block: 16px; }pre { max-height: 320px; overflow: auto; font-size: 12px; background: var(--surface); padding: 12px; }.muted { font-size: 12px; line-height: 20px; }.skill-empty { padding: 12px 8px; }.mcp-section { margin-top: 20px; }.mcp-section > summary { display: flex; align-items: center; gap: 8px; min-height: 44px; list-style: none; color: var(--muted); font-size: 13px; }.mcp-section > summary span { flex: 1; }.mcp-section > summary::-webkit-details-marker { display: none; }.mcp-section[open] > summary > svg:last-child { transform: rotate(180deg); }
.mcp-section > summary:hover { color: var(--ink); background: var(--state-hover); }.mcp-section > summary:active { color: var(--ink); background: var(--state-pressed); }
.skills-panel.embedded { margin: 0; padding: 0; border: 0; }
.embedded .skills-heading { margin-top: 0; }
</style>
