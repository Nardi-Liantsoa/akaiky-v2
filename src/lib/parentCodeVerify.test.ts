import { pbkdf2Sync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyParentCode } from './parentCodeVerify'

// Hachage produit comme le serveur (server/src/parent-code.js), itérations réduites pour le test.
const hashOf = (code: string, iterations = 10_000, salt = Buffer.from('sel-de-seize-oct')) =>
  `pbkdf2-sha256$${iterations}$${salt.toString('base64')}$${pbkdf2Sync(code, salt, iterations, 32, 'sha256').toString('base64')}`

describe('verifyParentCode', () => {
  it('accepte le bon code, refuse les autres', async () => {
    const hash = hashOf('482915')
    expect(await verifyParentCode(hash, '482915')).toBe(true)
    expect(await verifyParentCode(hash, '482916')).toBe(false)
    expect(await verifyParentCode(hash, '000000')).toBe(false)
  })

  it('vérifie le format exact produit par le serveur (600 000 itérations)', async () => {
    expect(await verifyParentCode(hashOf('305718', 600_000), '305718')).toBe(true)
  })

  it('un hachage mal formé ou affaibli ne valide jamais rien', async () => {
    const good = hashOf('482915')
    for (const bad of ['', 'pbkdf2-sha256$', good.replace('pbkdf2-sha256', 'pbkdf2-sha1'), hashOf('482915', 1000), good.replace(/\$[^$]+$/, '$AAAA'), `${good}$x`]) {
      expect(await verifyParentCode(bad, '482915')).toBe(false)
    }
  })

  it('refuse ce qui n’est pas six chiffres', async () => {
    const hash = hashOf('482915')
    for (const code of ['48291', '4829150', ' 482915', 'abcdef']) expect(await verifyParentCode(hash, code)).toBe(false)
  })
})
