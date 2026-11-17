// Numéros de téléphone normalisés en E.164 (+<indicatif><numéro>), forme unique
// pour comparer, chiffrer et indexer. Un numéro local (commençant par 0) est lu
// avec le pays par défaut de l'installation (PHONE_DEFAULT_COUNTRY) : le marché
// n'est pas encore tranché (CdC §12.1).
import { HttpError } from './lib.js'

export const COUNTRIES = {
  MG: { code: '261', local: /^0(\d{9})$/ }, // 034 12 345 67 → +261341234567
  FR: { code: '33', local: /^0(\d{9})$/ } // 06 12 34 56 78 → +33612345678
}

const invalid = () => new HttpError(400, 'Numéro de téléphone invalide.', 'invalid_phone')

export function normalizePhone(raw, country = 'MG') {
  if (typeof raw !== 'string' || raw.length > 40) throw invalid()
  let v = raw.replace(/[\s.\-()/]/g, '')
  if (v.startsWith('00')) v = `+${v.slice(2)}`
  // 0 national gardé après l'indicatif (« +261 (0)34… », « +261 034… ») : retiré,
  // sinon le même numéro aurait deux formes et passerait le contrôle de doublon.
  for (const { code } of Object.values(COUNTRIES)) {
    if (v.startsWith(`+${code}0`)) { v = `+${code}${v.slice(code.length + 2)}`; break }
  }
  if (!v.startsWith('+')) {
    const rule = COUNTRIES[country]
    const m = rule && rule.local.exec(v)
    if (!m) throw invalid()
    v = `+${rule.code}${m[1]}`
  }
  // E.164 : 8 à 15 chiffres, sans 0 en tête de l'indicatif.
  if (!/^\+[1-9]\d{7,14}$/.test(v)) throw invalid()
  return v
}
