// Chiffrement des champs sensibles en base (données de mineurs, CdC §7.1).
// AES-256-GCM, balise de 16 octets, IV aléatoire de 12 octets. Les données
// associées lient le chiffré à sa ligne et à sa colonne (`table:colonne:id`) :
// un chiffré recopié sur une autre ligne ou dans une autre colonne ne se
// déchiffre pas. Premier octet = version du format, pour une rotation de clé.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'

const VERSION = 1

export function sealField(text, keyHex, aad) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv, { authTagLength: 16 })
  cipher.setAAD(Buffer.from(aad))
  const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body])
}

export function openField(sealed, keyHex, aad) {
  const b = Buffer.isBuffer(sealed) ? sealed : Buffer.from(sealed)
  if (b.length < 29 || b[0] !== VERSION) throw new Error('Champ chiffré illisible')
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), b.subarray(1, 13), { authTagLength: 16 })
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(b.subarray(13, 29))
  return Buffer.concat([decipher.update(b.subarray(29)), decipher.final()]).toString('utf8')
}

// Index aveugle : HMAC-SHA256 d'une valeur normalisée, pour tester l'égalité
// (numéro en double) sans pouvoir lire la valeur. Clé dérivée de la clé des
// données (HKDF) avec un usage distinct : elle ne chiffre rien.
export function blindIndex(value, keyHex, purpose) {
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(keyHex, 'hex'), Buffer.alloc(0), `akaiky:blind-index:${purpose}`, 32))
  return createHmac('sha256', key).update(String(value)).digest()
}
