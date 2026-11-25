import { describe, expect, it, vi } from 'vitest'
import { focusFirstInvalid, length } from './formErrors'

// Pas de DOM dans les tests unitaires : un formulaire réduit à querySelector suffit.
const formWith = (el: { focus(): void } | null) => {
  const querySelector = vi.fn(() => el)
  return { form: { querySelector } as unknown as HTMLElement, querySelector }
}

describe('focusFirstInvalid', () => {
  it('cherche le premier champ marqué aria-invalid et lui donne le focus', async () => {
    const field = { focus: vi.fn() }
    const { form, querySelector } = formWith(field)
    await focusFirstInvalid(form)
    expect(querySelector).toHaveBeenCalledWith('[aria-invalid="true"]')
    expect(field.focus).toHaveBeenCalledOnce()
  })
  it('ne fait rien sans champ invalide ni formulaire', async () => {
    const { form } = formWith(null)
    await expect(focusFirstInvalid(form)).resolves.toBeUndefined()
    await expect(focusFirstInvalid(null)).resolves.toBeUndefined()
  })
})

describe('length', () => {
  it('compte les caractères visibles après retrait des espaces', () => {
    expect(length('  Fy  ')).toBe(2)
    expect(length('é')).toBe(1)
    expect(length('')).toBe(0)
  })
})
