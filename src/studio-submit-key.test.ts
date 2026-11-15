import { describe, expect, it } from 'vitest'
import { SUBMIT_KEYS, shouldSubmit } from '../shared/studio/submit-key'

const enter = { key: 'Enter', keyCode: 13, isComposing: false, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }
describe('Studio send shortcuts', () => {
  for (const key of SUBMIT_KEYS) {
    it(`${key} requires exactly its configured modifiers`, () => {
      const event = { ...enter, ctrlKey: key === 'Ctrl+Enter', shiftKey: key === 'Shift+Enter', altKey: key === 'Alt+Enter', metaKey: key === 'Meta+Enter' }
      expect(shouldSubmit(event, key)).toBe(true)
      for (const other of SUBMIT_KEYS.filter(value => value !== key)) expect(shouldSubmit(event, other)).toBe(false)
      expect(shouldSubmit({ ...event, isComposing: true }, key)).toBe(false)
      expect(shouldSubmit({ ...event, keyCode: 229 }, key)).toBe(false)
      expect(shouldSubmit({ ...event, key: 'a' }, key)).toBe(false)
    })
  }
  it('keeps plain Enter as a newline on touch screens while allowing a deliberate modifier shortcut', () => {
    expect(shouldSubmit(enter, 'Enter', false)).toBe(false)
    expect(shouldSubmit({ ...enter, ctrlKey: true }, 'Ctrl+Enter', false)).toBe(true)
    expect(shouldSubmit({ ...enter, ctrlKey: true, shiftKey: true }, 'Ctrl+Enter')).toBe(false)
  })
})
