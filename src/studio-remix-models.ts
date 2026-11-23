import type { Work } from './data'
import { readRemixParameters } from '../shared/studio/remix-parameters'
import { creation, loadCreationGroups, loadCreationModels, selectCreationGroup } from './native-studio'
import { modelKind } from './model-preferences'
import { session } from './state'
import { studioAccount } from './studio-account'
import type { ModelPricing } from '../server/native-account/pricing'

export async function restoreRemixModels(source: Work, isCurrent: () => boolean, rememberGroup: (group: string | null) => void, force = false) {
  const owner = session.user?.id, account = session.user?.accountId || owner
  const current = () => isCurrent() && owner === session.user?.id && account === (session.user?.accountId || session.user?.id)
  const kind = source.kind === 'resource' ? 'text' : source.kind
  const parameters = readRemixParameters(source.generation?.parameters)
  if (source.generation?.parameters !== undefined && (!parameters || parameters.kind !== kind)) throw new Error('原作生成参数无效，请使用当前配置。')
  await loadCreationGroups(force)
  if (!current()) return
  if (creation.groupsError) throw new Error(creation.groupsError)
  if (creation.selectedGroup) rememberGroup(creation.selectedGroup)
  await loadCreationModels(force)
  if (!current()) return
  if (creation.modelsError) throw new Error(creation.modelsError)
  // The first model read can provision the account's automatic group.
  if (!creation.selectedGroup && creation.modelTokenId) {
    await loadCreationGroups()
    if (!current()) return
    if (creation.groupsError) throw new Error(creation.groupsError)
    rememberGroup(creation.selectedGroup)
  }
  const available = () => !source.model || creation.models.some(model => model.id === source.model && modelKind(model) === kind)
  if (available()) return

  // Find an accessible group without creating or switching tokens just to probe them.
  const catalog = await studioAccount<ModelPricing>('model-pricing')
  if (!current()) return
  if (!Array.isArray(catalog?.rows) || catalog.userId !== Number(account)) throw new Error('当前账号的模型目录读取失败，请重试。')
  const modelGroups = new Set(catalog.rows.filter(row => row.model === source.model).map(row => row.group))
  if (catalog.autoGroups?.some(group => modelGroups.has(group))) modelGroups.add('auto')
  const candidates = creation.groups.filter(group => group.id !== creation.selectedGroup && modelGroups.has(group.id))
  const target = candidates.find(group => group.id === parameters?.group)
    || candidates.find(group => group.id !== 'auto') || candidates[0]
  if (target) {
    await selectCreationGroup(target.id)
    if (!current()) return
    if (creation.groupsError || creation.selectedGroup !== target.id) throw new Error(creation.groupsError || '未能切换到可用分组，请重试。')
    if (creation.modelsError) throw new Error(creation.modelsError)
    if (available()) return
  }
  throw new Error(`模型“${source.model}”暂不可用，请选择其他模型。当前分组未提供可调用的同名模型，可进入工作台调整分组。`)
}
