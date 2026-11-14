// Adapted from octopus_chat app/utils/model.ts, model-metadata.ts and
// app/components/model-select.tsx. MIT; see public/assets/model-vendors/LICENSE.txt.
export interface CatalogModel { id: string; name?: string; description?: string; provider?: string }
const vendors = [
  ['agnes', /^agnes(?:-|$)/, 'Agnes AI'],
  ['openai', /^(?:gpt(?:-|$)|chatgpt|dall-?e|o[134](?:-|$))/, 'OpenAI'],
  ['gemini', /^(?:gemini|learnlm)/, 'Google'], ['gemma', /^gemma/, 'Google'],
  ['claude', /^claude/, 'Anthropic'], ['meta', /llama/, 'Meta'],
  ['mistral', /^(?:mistral|mixtral|codestral|pixtral|devstral|magistral)/, 'Mistral'],
  ['deepseek', /deepseek/, 'DeepSeek'], ['moonshot', /^(?:moonshot|kimi)/, '月之暗面'],
  ['qwen', /^(?:qwen|qwq|qvq|wanx)/, '通义千问'], ['wenxin', /^(?:ernie|wenxin)/, '文心一言'],
  ['grok', /^grok/, 'xAI'], ['hunyuan', /^hunyuan/, '混元'],
  ['doubao', /^(?:doubao|ep-)/, '豆包'], ['chatglm', /^(?:glm|chatglm|cogview|cogvideo)/, '智谱'],
  ['minimax', /^(?:minimax|abab|hailuo)/, 'MiniMax'], ['stepfun', /^(?:step(?:-|fun))/, '阶跃星辰'],
  ['spark', /^(?:spark|iflytek)/, '讯飞'], ['baichuan', /^baichuan/, '百川'],
  ['yi', /^yi(?:-|$)/, '零一万物'], ['cohere', /^(?:command(?:-|$)|cohere)/, 'Cohere'],
  ['nvidia', /^(?:nvidia|nemotron)/, 'NVIDIA'], ['perplexity', /^(?:sonar|perplexity)/, 'Perplexity'],
  ['baai', /^(?:bge|baai)/, 'BAAI'],
] as const
export function modelVendor(id: string) {
  const name = id.toLowerCase().split('/').pop() || ''
  const match = vendors.find(([, pattern]) => pattern.test(name))
  return { id: match?.[0] || 'other', name: match?.[2] || '其他' }
}
export function searchModels<T extends CatalogModel>(models: T[], query: string): T[] {
  const search = query.trim().toLocaleLowerCase()
  return search ? models.filter(model => [model.id, model.name, model.description, model.provider, modelVendor(model.id).name]
    .some(value => value?.toLocaleLowerCase().includes(search))) : models
}
export function modelCategories(models: CatalogModel[], favorite: (id: string) => boolean) {
  const counts = new Map<string, number>()
  for (const model of models) {
    const vendor = modelVendor(model.id).name
    counts.set(vendor, (counts.get(vendor) || 0) + 1)
  }
  const favorites = models.filter(model => favorite(model.id)).length
  return [
    { id: 'all', name: '全部', count: models.length },
    ...(favorites ? [{ id: 'favorites', name: '收藏', count: favorites }] : []),
    ...Array.from(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ id: name, name, count })),
  ]
}
export const kindLabels = { text: '对话', image: '生图', video: '视频' } as const
export function modelDescription(model: CatalogModel, kind: keyof typeof kindLabels) {
  if (model.description?.trim()) return model.description.trim()
  const name = model.id.toLowerCase().split('/').pop()
  if (name === 'tavily-quick') return '均衡搜索，通用场景，速度快'
  if (name === 'tavily-deep') return '高相关深度搜索，适合复杂查证'
  return { text: '问答、写作与内容整理', image: '图像生成与创作', video: '视频生成与创作' }[kind]
}
