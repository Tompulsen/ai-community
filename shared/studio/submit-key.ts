// Adapted from octopus_chat app/utils/use-submit-handler.ts (MIT).
export const SUBMIT_KEYS = ['Enter', 'Ctrl+Enter', 'Shift+Enter', 'Alt+Enter', 'Meta+Enter'] as const
export type SubmitKey = typeof SUBMIT_KEYS[number]
export function shouldSubmit(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'isComposing' | 'keyCode'>, key: SubmitKey, finePointer = true) {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return false
  const modifier = key === 'Enter' ? '' : key.split('+')[0]
  return (key !== 'Enter' || finePointer) && event.ctrlKey === (modifier === 'Ctrl') &&
    event.shiftKey === (modifier === 'Shift') && event.altKey === (modifier === 'Alt') && event.metaKey === (modifier === 'Meta')
}
