// Garde d'accès par famille (ampy-auth, « Plusieurs organisations »).
// L'adhésion est relue en base à CHAQUE appel : un membre retiré perd l'accès
// à la requête suivante. La famille visée vient d'une ligne lue en base ou de
// l'adhésion de la session, jamais d'un champ que le client choisit pour la
// ressource d'un autre.
import { HttpError, isUuid } from './lib.js'

export const ROLES = ['owner', 'manager', 'member']
export const MANAGERS = ['owner', 'manager']

const notFound = () => new HttpError(404, 'Famille introuvable.', 'no_family')

// Famille de l'utilisateur (une seule en v1), ou null.
export async function familyOf(db, userId) {
  const { rows } = await db.query('SELECT family_id, role FROM memberships WHERE user_id = $1', [userId])
  return rows[0] ? { familyId: rows[0].family_id, role: rows[0].role } : null
}

// Rôle de l'utilisateur de la session dans `familyId`, s'il fait partie de `roles`.
// Pas membre → 404 (une famille d'un autre n'existe pas) ; rôle insuffisant → 403.
export async function requireFamilyRole(db, req, familyId, roles) {
  if (!req.user) throw new HttpError(401, 'Connexion requise.')
  if (!isUuid(familyId)) throw notFound()
  const { rows } = await db.query('SELECT role FROM memberships WHERE family_id = $1 AND user_id = $2', [familyId, req.user.id])
  if (!rows[0]) throw notFound()
  if (!roles.includes(rows[0].role)) throw new HttpError(403, 'Action réservée aux gestionnaires de la famille.', 'family_role')
  return rows[0].role
}

// Famille de la session avec le rôle exigé ; 404 si la session n'a pas de famille.
export async function requireOwnFamily(db, req, roles) {
  if (!req.user) throw new HttpError(401, 'Connexion requise.')
  const own = await familyOf(db, req.user.id)
  if (!own) throw notFound()
  await requireFamilyRole(db, req, own.familyId, roles)
  return own
}
