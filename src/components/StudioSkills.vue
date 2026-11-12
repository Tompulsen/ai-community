<script setup lang="ts">
import { ref, watch } from 'vue'
import { Play, RefreshCw } from '@lucide/vue'
import { api, errorMessage, session } from '../state'
import { chats, saveChats, type NativeChat, type Skill } from '../native-chat'
import { verifySkillDocument } from '../../shared/studio/catalog'
const props = defineProps<{ chat: NativeChat }>()
const loading = ref(false), error = ref(''), query = ref(''), enabled = ref(false), servers = ref<{ id: string; status: string }[]>([])
const server = ref(''), tool = ref(''), tools = ref<{ name: string; description?: string; inputSchema?: unknown }[]>([]), args = ref('{}'), result = ref(''), busy = ref(false), config = ref('{"mcpServers":{}}')
let revision = 0
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
watch(() => session.user?.id, () => { chats.skills = []; result.value = ''; server.value = ''; tools.value = []; enabled.value = false; void load() }, { immediate: true })
async function toggle(skill: Skill, event: Event) {
  const input = event.target as HTMLInputElement
  const chat = props.chat, owner = session.user?.id
  try {
    await verifySkillDocument(skill.body, skill.sha256)
    if (owner !== session.user?.id) return
    if (input.checked) chat.skillIds.push(skill.id)
    else chat.skillIds = chat.skillIds.filter(id => id !== skill.id)
    await saveChats(true)
  } catch (cause) { error.value = errorMessage(cause); input.checked = false }
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
  <details class="skills-panel"><summary>技能与工具<span v-if="chat.skillIds.length"> · {{ chat.skillIds.length }}</span></summary>
    <div class="skills-heading"><input v-model="query" class="control" type="search" placeholder="搜索技能" aria-label="搜索技能" /><button class="icon-button" title="刷新技能" aria-label="刷新技能" :disabled="loading" @click="load"><RefreshCw :size="16" /></button></div>
    <p v-if="loading" class="muted" role="status">正在读取技能…</p><p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="skill-list"><label v-for="skill in chats.skills.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase()))" :key="skill.id" class="skill-row"><input type="checkbox" :checked="chat.skillIds.includes(skill.id)" @change="toggle(skill, $event)" /><span><strong>{{ skill.name }}</strong><span>{{ skill.description }}</span></span></label></div>
    <h3>MCP</h3><p v-if="!enabled" class="muted">当前账号未启用 MCP 工具。</p>
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
</template>
<style scoped>
.skills-panel { margin-top: 24px; border-top: 1px solid var(--border); padding-top: 16px; }summary { cursor: pointer; font-size: 14px; }.skills-heading { display: flex; gap: 8px; margin-block: 16px; }.skills-heading input { min-width: 0; width: 100%; }.skill-list { max-height: 320px; overflow-y: auto; }.skill-row { display: flex; align-items: flex-start; gap: 12px; padding-block: 12px; border-bottom: 1px solid var(--border); }.skill-row input { margin-top: 4px; }.skill-row > span { min-width: 0; display: grid; gap: 4px; font-size: 12px; line-height: 20px; overflow-wrap: anywhere; }.skill-row strong { color: var(--ink); font-size: 14px; font-weight: 500; }.skill-row span span { color: var(--muted); }h3 { font-size: 14px; margin-block: 24px 12px; }.field { margin-block: 16px; }pre { max-height: 320px; overflow: auto; font-size: 12px; background: var(--surface); padding: 12px; }.muted { font-size: 12px; line-height: 20px; }
</style>
