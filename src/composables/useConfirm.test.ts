import { describe, expect, it } from 'vitest'
import { useConfirm } from './useConfirm'

describe('useConfirm', () => {
  it('rien en attente au départ', () => {
    const c = useConfirm<string>()
    expect(c.target.value).toBeNull()
    expect(c.opener.value).toBeNull()
  })

  it('ask garde la cible ; close l’oublie', () => {
    const c = useConfirm<{ id: string }>()
    const item = { id: 'a' }
    c.ask(item)
    expect(c.target.value).toBe(item)
    c.close()
    expect(c.target.value).toBeNull()
  })

  it('sans élément HTML pour l’événement, aucun bouton d’origine retenu', () => {
    const c = useConfirm<boolean>()
    c.ask(true, { currentTarget: null } as unknown as Event)
    expect(c.target.value).toBe(true)
    expect(c.opener.value).toBeNull()
  })
})
