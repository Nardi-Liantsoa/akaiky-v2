// Export des données de la famille (NAR-178, RGPD : droit d'accès).
//   GET /api/families/me/export   owner, manager (contact → 403, sans famille → 404)
// Fichier JSON construit champ par champ, jamais une ligne de la base : ni hachage (mot de
// passe, code parent), ni jeton, ni session, ni index aveugle, ni identifiant d'un autre
// compte, ni journal d'audit, ni adresse IP. Les champs chiffrés sont ouverts avec leurs
// données associées habituelles. 5 exports par heure et par compte.
// Taille bornée par enfant : les 5000 évènements du journal et les 2000 messages rapides les
// plus récents par date de réception serveur (created_at, du plus récent au plus ancien) ; `journalTruncated` / `messagesTruncated`
// signalent une coupe. Une requête par table pour tous les enfants, regroupée ici.
// Un champ chiffré illisible (clé changée, ligne abîmée) donne null : il est compté dans
// `unreadableFields` et journalisé (table et identifiant de ligne, jamais de contenu).
import { HttpError, audit } from '../lib.js'
import { MANAGERS, requireOwnFamily } from '../families.js'
import { createLimiter } from '../security.js'
import { openField } from '../crypto-fields.js'
import { contactAad } from './contacts.js'
import { eventAad } from './devices.js'
import { messageTextAad, templateAad } from './messages.js'
import { scheduleAad } from './schedules.js'
import { allowedAppAad } from './apps.js'
import { childPhoneAad } from './children.js'

export const EXPORTS_PER_HOUR = 5
export const JOURNAL_CAP = 5000
export const MESSAGES_CAP = 2000
const childAad = (id) => `children:first_name:${id}`

// Regroupe des lignes par enfant, en gardant l'ordre de la requête.
function byChild(rows) {
  const out = new Map()
  for (const r of rows) {
    if (!out.has(r.child_id)) out.set(r.child_id, [])
    out.get(r.child_id).push(r)
  }
  return out
}

export async function exportRoutes(app) {
  const { db, config } = app
  const key = config.dataKey
  const perUser = createLimiter({ max: EXPORTS_PER_HOUR, windowMs: 60 * 60 * 1000 })

  app.get('/me/export', async (req, reply) => {
    const own = await requireOwnFamily(db, req, MANAGERS)
    // Compté avant la construction : un export en échec consomme quand même le quota (accepté pour borner la charge).
    if (!perUser(req.user.id)) throw new HttpError(429, 'Trop d’exports. Réessayez dans une heure.', 'too_many_exports')
    const familyId = own.familyId
    const q = async (sql, params = [familyId]) => (await db.query(sql, params)).rows

    let unreadable = 0
    const open = (sealed, aad, table, rowId) => {
      if (!sealed) return null
      try { return openField(sealed, key, aad) } catch {
        unreadable++
        req.log.warn({ table, rowId }, 'Export : champ chiffré illisible')
        return null
      }
    }

    const [me] = await q(
      `SELECT u.name, u.email, u.created_at, u.consent_at, u.email_verified_at,
              EXISTS (SELECT 1 FROM mfa_factors f WHERE f.user_id = u.id) AS mfa
         FROM users u WHERE u.id = $1`, [req.user.id])
    const [family] = await q('SELECT name, created_at, timezone FROM families WHERE id = $1')
    const members = await q(
      `SELECT m.user_id, m.role, m.created_at, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.family_id = $1 ORDER BY m.created_at, m.user_id`)
    const memberName = new Map(members.map((m) => [m.user_id, m.name]))
    const invitations = await q(
      `SELECT role, expires_at FROM invitations i
        WHERE i.family_id = $1 AND i.used_at IS NULL AND i.expires_at > now()
          AND EXISTS (SELECT 1 FROM memberships m WHERE m.family_id = i.family_id AND m.user_id = i.invited_by AND m.role = ANY($2::text[]))
        ORDER BY i.created_at`, [familyId, MANAGERS])
    const children = await q(
      'SELECT id, first_name_enc, phone_enc, avatar_color, created_at, parent_code_set_at, sos_siren, consent_at, consent_by FROM children WHERE family_id = $1 ORDER BY created_at, id')

    const contacts = byChild(await q(
      'SELECT id, child_id, name_enc, phone_enc, position, member_user_id FROM allowed_contacts WHERE family_id = $1 ORDER BY child_id, position'))
    const devices = byChild(await q(
      `SELECT child_id, model, os_version, app_version, created_at, last_seen_at, revoked_at,
              battery_pct, charging, network, sim_state, status_at
         FROM child_devices WHERE family_id = $1 ORDER BY child_id, created_at`))
    // Alertes du téléphone (NAR-147) : type et dates seulement, sans identifiant.
    const alerts = byChild(await q(
      'SELECT child_id, kind, opened_at, closed_at FROM device_alerts WHERE family_id = $1 ORDER BY child_id, opened_at, kind'))
    const schedules = byChild(await q(
      'SELECT id, child_id, label_enc, days_mask, start_min, end_min, enabled FROM schedules WHERE family_id = $1 ORDER BY child_id, start_min, created_at, id'))
    // Applications autorisées (NAR-143) : la liste choisie seulement, jamais l'inventaire du téléphone.
    const allowedApps = byChild(await q(
      'SELECT child_id, package, label_enc, position FROM allowed_apps WHERE family_id = $1 ORDER BY child_id, position'))
    const templates = byChild(await q(
      'SELECT child_id, slot, text_enc FROM quick_message_templates WHERE family_id = $1 ORDER BY child_id, slot'))
    // Une ligne de plus que le plafond par enfant : elle signale la coupe sans être exportée.
    const messages = byChild(await q(
      `SELECT id, child_id, slot, sent_at, text_enc FROM (
         SELECT qm.*, row_number() OVER (PARTITION BY child_id ORDER BY created_at DESC, id DESC) AS n
           FROM quick_messages qm WHERE family_id = $1) x
        WHERE n <= $2 ORDER BY child_id, n`, [familyId, MESSAGES_CAP + 1]))
    const events = byChild(await q(
      `SELECT id, child_id, kind, started_at, duration_s, name_enc, phone_enc, unlock_source FROM (
         SELECT e.*, row_number() OVER (PARTITION BY child_id ORDER BY created_at DESC, id DESC) AS n
           FROM device_events e WHERE family_id = $1) x
        WHERE n <= $2 ORDER BY child_id, n`, [familyId, JOURNAL_CAP + 1]))
    // Lectures des messages exportés : nom du contact lié s'il existe, sinon nom du compte.
    const messageIds = [...messages.values()].flatMap((rows) => rows.slice(0, MESSAGES_CAP).map((m) => m.id))
    const readers = new Map()
    if (messageIds.length) {
      const reads = await q(
        `SELECT r.message_id, u.name, c.id AS contact_id, c.name_enc
           FROM quick_message_reads r
           JOIN quick_messages qm ON qm.id = r.message_id AND qm.family_id = $1
           JOIN memberships m ON m.user_id = r.user_id AND m.family_id = $1
           JOIN users u ON u.id = r.user_id
           LEFT JOIN allowed_contacts c ON c.member_user_id = r.user_id AND c.child_id = qm.child_id AND c.family_id = $1
          WHERE r.message_id = ANY($2::uuid[])
          ORDER BY r.read_at`, [familyId, messageIds])
      for (const r of reads) {
        const name = r.name_enc ? open(r.name_enc, contactAad(r.contact_id, 'name'), 'allowed_contacts', r.contact_id) ?? r.name : r.name
        if (!readers.has(r.message_id)) readers.set(r.message_id, [])
        readers.get(r.message_id).push(name)
      }
    }

    const out = children.map((c) => {
      const msgs = messages.get(c.id) ?? []
      const evts = events.get(c.id) ?? []
      return {
        firstName: open(c.first_name_enc, childAad(c.id), 'children', c.id),
        phone: open(c.phone_enc, childPhoneAad(c.id), 'children', c.id),
        avatarColor: c.avatar_color,
        createdAt: c.created_at,
        parentCodeSetAt: c.parent_code_set_at ?? null,
        sosSiren: c.sos_siren,
        consentAt: c.consent_at ?? null,
        consentBy: c.consent_by ? memberName.get(c.consent_by) ?? null : null,
        contacts: (contacts.get(c.id) ?? []).map((r) => ({
          name: open(r.name_enc, contactAad(r.id, 'name'), 'allowed_contacts', r.id),
          phone: open(r.phone_enc, contactAad(r.id, 'phone'), 'allowed_contacts', r.id),
          position: r.position,
          linkedMember: r.member_user_id ? memberName.get(r.member_user_id) ?? null : null
        })),
        devices: (devices.get(c.id) ?? []).map((r) => ({
          model: r.model, osVersion: r.os_version, appVersion: r.app_version,
          pairedAt: r.created_at, lastSeenAt: r.last_seen_at, revokedAt: r.revoked_at ?? null,
          batteryPct: r.battery_pct ?? null, charging: r.charging ?? null, network: r.network ?? null,
          simState: r.sim_state ?? null, statusAt: r.status_at ?? null
        })),
        deviceAlerts: (alerts.get(c.id) ?? []).map((r) => ({ kind: r.kind, openedAt: r.opened_at, closedAt: r.closed_at ?? null })),
        schedules: (schedules.get(c.id) ?? []).map((r) => ({
          label: open(r.label_enc, scheduleAad(r.id), 'schedules', r.id), days: r.days_mask, startMin: r.start_min, endMin: r.end_min, enabled: r.enabled
        })),
        allowedApps: (allowedApps.get(c.id) ?? []).map((r) => ({
          package: r.package, label: open(r.label_enc, allowedAppAad(c.id, r.package), 'allowed_apps', `${c.id}:${r.package}`), position: r.position
        })),
        messageTexts: Object.fromEntries((templates.get(c.id) ?? []).map((r) =>
          [r.slot, open(r.text_enc, templateAad(c.id, r.slot), 'quick_message_templates', `${c.id}:${r.slot}`)])),
        quickMessages: msgs.slice(0, MESSAGES_CAP).map((r) => ({
          slot: r.slot,
          text: open(r.text_enc, messageTextAad(r.id), 'quick_messages', r.id),
          sentAt: r.sent_at,
          readBy: readers.get(r.id) ?? []
        })),
        messagesTruncated: msgs.length > MESSAGES_CAP,
        journal: evts.slice(0, JOURNAL_CAP).map((r) => ({
          kind: r.kind,
          startedAt: r.started_at,
          durationS: r.duration_s ?? null,
          name: open(r.name_enc, eventAad(r.id, 'name'), 'device_events', r.id),
          phone: open(r.phone_enc, eventAad(r.id, 'phone'), 'device_events', r.id),
          source: r.unlock_source ?? null
        })),
        journalTruncated: evts.length > JOURNAL_CAP
      }
    })

    const now = new Date()
    const body = {
      exportedAt: now.toISOString(),
      me: {
        name: me.name, email: me.email, createdAt: me.created_at, consentAt: me.consent_at ?? null,
        emailVerified: !!me.email_verified_at, mfaEnabled: me.mfa
      },
      family: { name: family.name, createdAt: family.created_at, timezone: family.timezone },
      members: members.map((m) => ({
        name: m.name, role: m.role, joinedAt: m.created_at, isMe: m.user_id === req.user.id,
        ...(m.user_id === req.user.id ? { email: m.email } : {})
      })),
      invitations: invitations.map((r) => ({ role: r.role, expiresAt: r.expires_at })),
      children: out,
      ...(unreadable > 0 ? { unreadableFields: unreadable } : {})
    }
    // Des comptes seulement : aucune donnée personnelle dans le journal.
    await audit(db, req, 'family_exported', familyId, { children: children.length })
    reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="akaiky-famille-${now.toISOString().slice(0, 10)}.json"`)
      .header('cache-control', 'no-store')
    return body
  })
}
