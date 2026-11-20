import { describe, expect, it, vi } from 'vitest'
import { usePagedList } from './usePagedList'

describe('usePagedList', () => {
  it('charge la première page puis la suivante avec le curseur rendu', async () => {
    const fetchPage = vi.fn(async (before: string | null) => before === null
      ? { items: [1, 2], next: 'c1' }
      : { items: [3], next: null })
    const list = usePagedList(fetchPage)
    await list.reload()
    expect(list.items.value).toEqual([1, 2])
    expect(list.next.value).toBe('c1')
    await list.more()
    expect(fetchPage).toHaveBeenLastCalledWith('c1')
    expect(list.items.value).toEqual([1, 2, 3])
    expect(list.next.value).toBeNull()
    expect(list.loaded.value).toBe(true)
  })

  it('une erreur garde les éléments chargés et le curseur ; un nouvel essai repart du même curseur', async () => {
    let fail = false
    const fetchPage = vi.fn(async (before: string | null) => {
      if (fail) throw new Error('réseau')
      return before === null ? { items: ['a'], next: 'c1' } : { items: ['b'], next: null }
    })
    const list = usePagedList(fetchPage)
    await list.reload()
    fail = true
    await list.more()
    expect(list.error.value).toBeInstanceOf(Error)
    expect(list.items.value).toEqual(['a'])
    expect(list.next.value).toBe('c1')
    fail = false
    await list.more()
    expect(list.error.value).toBeNull()
    expect(list.items.value).toEqual(['a', 'b'])
  })

  it('un chargement en cours n’est pas doublé', async () => {
    let resolve: (v: { items: number[], next: null }) => void = () => {}
    const fetchPage = vi.fn(() => new Promise<{ items: number[], next: null }>((r) => { resolve = r }))
    const list = usePagedList(fetchPage)
    const first = list.reload()
    void list.reload()
    resolve({ items: [1], next: null })
    await first
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('« plus » sans page suivante ne rajoute pas la première page', async () => {
    const fetchPage = vi.fn(async () => ({ items: [1], next: null }))
    const list = usePagedList(fetchPage)
    await list.more()
    await list.reload()
    await list.more()
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(list.items.value).toEqual([1])
  })
})
