// Code parent à 6 chiffres (NAR-139). Le téléphone de l'enfant le vérifie hors
// ligne (NAR-167) avec WebCrypto, qui n'offre pas scrypt : PBKDF2-HMAC-SHA256.
// Les itérations sont écrites dans le hachage, pour pouvoir les ajuster plus tard
// sans invalider les codes déjà définis.
import { pbkdf2 as pbkdf2Cb, randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import { HttpError } from './lib.js'

const pbkdf2 = promisify(pbkdf2Cb)
export const PARENT_CODE_ITERATIONS = 600_000
const KEYLEN = 32

// Codes trop faciles à deviner : chiffres identiques, suites, motifs répétés.
// Même règle côté app (src/lib/parentCode.ts), pour le message.
export function parentCodeProblem(code) {
  if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) return 'invalid_parent_code'
  // Suites modulo 10 (901234 compris), motifs répétés (121212, 123123), paires ou triplets
  // doublés (112233, 111222), palindromes (123321).
  const d = [...code].map(Number)
  const steps = d.slice(1).map((x, i) => (x - d[i] + 10) % 10)
  const run = steps.every((s) => s === steps[0]) && [0, 1, 9].includes(steps[0])
  const repeated = code === code.slice(0, 2).repeat(3) || code === code.slice(0, 3).repeat(2)
  const pairs = code[0] === code[1] && code[2] === code[3] && code[4] === code[5]
  const triples = code[0] === code[1] && code[1] === code[2] && code[3] === code[4] && code[4] === code[5]
  const mirror = code === [...code].reverse().join('')
  if (run || repeated || pairs || triples || mirror) return 'weak_parent_code'
  return null
}

// Un calcul à la fois pour tout le serveur (≈ 0,3 s de processeur, sur les quatre fils
// partagés avec scrypt) : au-delà, 503 plutôt que de ralentir les connexions. La place
// est réservée AVANT le quota du compte : un refus « occupé » ne coûte pas d'essai.
let running = false

export function reserveHashSlot() {
  if (running) {
    const busy = new HttpError(503, 'Le service est occupé. Réessayez dans quelques instants.')
    busy.retryAfter = 5
    throw busy
  }
  running = true
  let released = false
  return () => { if (!released) { released = true; running = false } }
}

// À appeler avec une place réservée (reserveHashSlot), libérée par l'appelant.
export async function hashParentCode(code, iterations = PARENT_CODE_ITERATIONS) {
  const salt = randomBytes(16)
  const key = await pbkdf2(code, salt, iterations, KEYLEN, 'sha256')
  return `pbkdf2-sha256$${iterations}$${salt.toString('base64')}$${key.toString('base64')}`
}
