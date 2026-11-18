import { describe, expect, it } from 'vitest'
import { uuidV4 } from './uuid'

describe('uuidV4', () => {
  it('format UUID v4 accepté par le serveur, valeurs distinctes', () => {
    const a = uuidV4(), b = uuidV4()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })
})
