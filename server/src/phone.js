// Numéros de téléphone normalisés en E.164 (+<indicatif><numéro>), forme unique
// pour comparer, chiffrer et indexer. Un numéro local (commençant par 0) est lu
// avec le pays par défaut de l'installation (PHONE_DEFAULT_COUNTRY) : le marché
// n'est pas encore tranché (CdC §12.1).
import { HttpError } from './lib.js'

export const COUNTRIES = {
  // Premier chiffre après le 0 : 2 (fixe) ou 3 (mobile) à Madagascar, 1 à 9 en France.
  MG: { code: '261', local: /^0([23]\d{8})$/ }, // 034 12 345 67 → +261341234567
  FR: { code: '33', local: /^0([1-9]\d{8})$/ } // 06 12 34 56 78 → +33612345678
}

const invalid = () => new HttpError(400, 'Numéro de téléphone invalide.', 'invalid_phone')

export function normalizePhone(raw, country = 'MG') {
  if (typeof raw !== 'string' || raw.length > 40) throw invalid()
  // « (0) » après l'indicatif (notation internationale courante) : retiré pour tous les pays.
  let v = raw.replace(/\(0\)/g, '').replace(/[\s.\-()/]/g, '')
  if (v.startsWith('00')) v = `+${v.slice(2)}`
  // 0 national gardé après l'indicatif (« +261 (0)34… », « +261 034… ») : retiré,
  // sinon le même numéro aurait deux formes et passerait le contrôle de doublon.
  // Tous les 0 (« +261 00 34… ») : sinon une seconde forme du même numéro contournerait
  // l'unicité du compte et les limites d'envoi de SMS par numéro (NAR-136).
  for (const { code } of Object.values(COUNTRIES)) {
    if (v.startsWith(`+${code}0`)) { v = `+${code}${v.slice(code.length + 1).replace(/^0+/, '')}`; break }
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

// Forme E.164 déjà normalisée (celle de la base) : distingue un numéro d'une adresse e-mail
// partout où un compte se cherche par son identifiant (connexion, garde, appareils de confiance).
export const isE164 = (v) => typeof v === 'string' && /^\+[1-9]\d{7,14}$/.test(v)
// Colonne de `users` qui porte l'identifiant : liste fermée, jamais une valeur du client.
export const loginColumn = (id) => isE164(id) ? 'phone' : 'email'
