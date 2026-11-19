import type { Work } from './data'
import { readRemixParameters } from '../shared/studio/remix-parameters'
import { creation, loadCreationGroups, loadCreationModels, selectCreationGroup } from './native-studio'
import { groupKind, modelKind } from './model-preferences'

export async function restoreRemixModels(source: Work, isCurrent: () => boolean, rememberGroup: (group: string | null) => void) {
  const kind = source.kind === 'resource' ? 'text' : source.kind
  const parameters = readRemixParameters(source.generation?.parameters)
  if (source.generation?.parameters !== undefined && (!parameters || parameters.kind !== kind)) throw new Error('原作生成参数无效，请使用当前配置。')
  await loadCreationGroups()
  if (!isCurrent()) return
  if (creation.groupsError) throw new Error(creation.groupsError)
  rememberGroup(creation.selectedGroup)
  const preferredGroup = parameters?.group || (source.kind !== 'resource' ? creation.groups.find(group => groupKind(group.id) === source.kind)?.id : undefined)
  if (preferredGroup && creation.selectedGroup !== preferredGroup) {
    if (!creation.groups.some(group => group.id === preferredGroup)) throw new Error(`当前账号无法使用原作分组“${preferredGroup}”，请选择可用配置。`)
    await selectCreationGroup(preferredGroup)
    if (!isCurrent()) return
    if (creation.groupsError || creation.selectedGroup !== preferredGroup) throw new Error(creation.groupsError || '未能恢复原作分组，请确认当前配置。')
  } else await loadCreationModels()
  if (!isCurrent()) return
  if (creation.modelsError) throw new Error(creation.modelsError)
  const originalModel = creation.models.find(model => model.id === source.model)
  if (source.model && (!originalModel || modelKind(originalModel) !== kind)) throw new Error(`模型“${source.model}”暂不可用，请选择其他模型。`)
}
