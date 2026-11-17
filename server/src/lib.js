// Outils partagés : erreurs, validation, audit.

// `code` : identifiant stable que le front peut tester (le message, lui, peut changer).
export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code }
}

export const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i

export function text(value, { max, min = 0, field }) {
  if (typeof value !== 'string') throw new HttpError(400, `${field} invalide.`)
  const v = value.replace(/\u0000/g, '').trim()
  // Longueur en caractères (points de code), comme le schéma JSON et char_length de PostgreSQL.
  const length = [...v].length
  if (length < min || length > max) throw new HttpError(400, `${field} : ${min} à ${max} caractères.`)
  return v
}

// Adresse e-mail normalisée (minuscules) et validée : la même partout (comptes, invitations).
export function emailAddress(v) {
  const e = text(v, { max: 254, min: 3, field: 'Email' }).toLowerCase()
  if (!EMAIL_RE.test(e)) throw new HttpError(400, 'Adresse email invalide.', 'invalid_email')
  return e
}

export function isoDate(value, field) {
  if (value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 40 || Number.isNaN(Date.parse(value))) throw new HttpError(400, `${field} : date invalide.`)
  return new Date(value).toISOString()
}

// Liens affichés aux utilisateurs : http(s) seulement — jamais javascript:, data:…
export function safeUrl(value, field) {
  if (value === null || value === '') return ''
  if (typeof value !== 'string' || value.length > 2000) throw new HttpError(400, `${field} invalide.`)
  let u
  try { u = new URL(value) } catch { throw new HttpError(400, `${field} : adresse invalide.`) }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HttpError(400, `${field} : http(s) uniquement.`)
  return u.toString()
}

// Corps attendu : un objet dont chaque clé est connue. Un champ inconnu est un
// 400, jamais un champ ignoré en silence (parade à l'affectation de masse).
export function body(req, allowed) {
  const b = req.body
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'Requête invalide.')
  const unknown = Object.keys(b).filter((k) => !allowed.includes(k))
  if (unknown.length) throw new HttpError(400, `Champ non accepté : ${unknown.join(', ')}`)
  return b
}

// Ce qu'un compte doit remplir pour qu'une session (alias s) de l'utilisateur
// (alias u) soit valable : adresse confirmée, et second facteur vérifié pour un
// admin ou un compte qui en a un. Une seule définition, pour le hook de session
// et le renouvellement natif.
export const SESSION_RULE = `u.email_verified_at IS NOT NULL
  AND (s.mfa_verified_at IS NOT NULL OR (NOT u.is_admin AND NOT EXISTS (SELECT 1 FROM mfa_factors f WHERE f.user_id = u.id)))`

// Ce que le navigateur reçoit d'un compte : champ par champ, jamais la ligne entière.
export const me = (u) => ({ id: u.id, email: u.email, name: u.name, is_admin: u.is_admin })

// Journal en ajout seul (le rôle SQL de l'application n'a que INSERT dessus).
export async function audit(db, req, action, target = null, details = null) {
  await db.query('INSERT INTO audit_log(actor_id, action, target, ip, details) VALUES ($1,$2,$3,$4,$5)',
    [req.user?.id ?? null, action, target, req.ip, details])
}
