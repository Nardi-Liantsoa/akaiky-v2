// Vérification hors ligne du code parent (NAR-167) contre le hachage reçu dans la
// configuration du téléphone (NAR-139) : « pbkdf2-sha256$<itérations>$<sel>$<clé> »,
// base64. WebCrypto (PBKDF2), comparaison en temps constant. Un hachage mal formé ne
// valide jamais rien.
const FORMAT = /^pbkdf2-sha256\$([0-9]{5,7})\$([A-Za-z0-9+/]+=*)\$([A-Za-z0-9+/]+=*)$/
const MIN_ITERATIONS = 10_000

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function verifyParentCode(hash: string, code: string, subtle: SubtleCrypto = crypto.subtle): Promise<boolean> {
  const m = FORMAT.exec(hash)
  if (!m || !/^[0-9]{6}$/.test(code)) return false
  const iterations = Number(m[1])
  if (iterations < MIN_ITERATIONS) return false
  let salt: Uint8Array<ArrayBuffer>, expected: Uint8Array<ArrayBuffer>
  try { salt = fromBase64(m[2]); expected = fromBase64(m[3]) } catch { return false }
  if (salt.length < 8 || expected.length < 16) return false
  const key = await subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, expected.length * 8))
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= bits[i] ^ expected[i]
  return diff === 0
}
