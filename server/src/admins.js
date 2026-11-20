// Garde du dernier administrateur (NAR-177, NAR-199) : l'équipe n'est jamais laissée sans
// administrateur actif, ni par la suppression d'un compte ni par une désactivation.
// Les deux écritures prennent le même verrou consultatif de transaction puis relisent la
// base : deux opérations simultanées passent l'une après l'autre, la seconde voit la première.

export async function lockAdmins(conn) {
  await conn.query("SELECT pg_advisory_xact_lock(hashtext('akaiky:last_admin'))")
}

// Vrai si `userId` est administrateur et qu'aucun AUTRE administrateur actif (non désactivé)
// n'existe : le retirer ou le désactiver laisserait le back-office sans personne.
export async function isLastAdmin(conn, userId) {
  const { rows } = await conn.query(
    `SELECT 1 FROM users u WHERE u.id = $1 AND u.is_admin
        AND NOT EXISTS (SELECT 1 FROM users o WHERE o.is_admin AND o.disabled_at IS NULL AND o.id <> u.id)`, [userId])
  return rows.length > 0
}
