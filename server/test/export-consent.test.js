// Export des données de la famille et consentement parental (NAR-178).
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startDb, startApp, call, native, newUser, tokenIn } from './helpers.js'

const APK = { DEVICE_APK_URL: 'https://akaiky.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43) }
let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', INVITATION_EMAILS_PER_HOUR: '100000', ...APK }) })
after(async () => { await ctx.close(); dbh.stop() })

const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'
const family = (u) => call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name: 'Famille Rakoto' } })
const exportOf = (u) => call(ctx.app, 'GET', '/api/families/me/export', { cookie: u.cookie })
const register = (body) => call(ctx.app, 'POST', '/api/auth/register', { body })
const PASSWORD = 'cheval batterie agrafe correcte'

async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  assert.equal((await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })).statusCode, 200)
  return guest
}

test('inscription sans consentement : 400 consent_required, aucun compte ni courriel ; avec : date gardée', async () => {
  const email = `sans-consentement${process.pid}@exemple.fr`
  const sentBefore = ctx.sent.length
  for (const consent of [undefined, false, 'true', 1]) {
    const res = await register({ name: 'Sans', email, password: PASSWORD, ...(consent === undefined ? {} : { consent }) })
    assert.equal(res.statusCode, 400, res.body)
    assert.equal(res.json().code, 'consent_required')
  }
  assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM users WHERE email = $1', [email])).rows[0].n, 0)
  assert.equal(ctx.sent.length, sentBefore, 'aucun courriel')
  // Adresse déjà prise : même refus sans consentement (rien n'est révélé).
  const known = await newUser(ctx)
  const taken = await register({ name: 'Autre', email: known.email, password: 'un autre mot de passe long' })
  assert.equal(taken.statusCode, 400)
  assert.equal(taken.json().code, 'consent_required')
  // Avec consentement : date posée.
  assert.equal((await register({ consent: true, name: 'Avec', email, password: PASSWORD })).statusCode, 202)
  const { rows: [u] } = await ctx.db.query('SELECT consent_at FROM users WHERE email = $1', [email])
  assert.ok(u.consent_at instanceof Date && Date.now() - u.consent_at.getTime() < 60_000)
})

test('ajout d’un enfant sans consentement parental : 400 consent_required ; avec : date et auteur gardés', async () => {
  const owner = await newUser(ctx), member = await newUser(ctx)
  await family(owner)
  for (const parentalConsent of [undefined, false]) {
    const res = await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { firstName: 'Fy', ...(parentalConsent === undefined ? {} : { parentalConsent }) } })
    assert.equal(res.statusCode, 400, res.body)
    assert.equal(res.json().code, 'consent_required')
  }
  assert.equal((await call(ctx.app, 'GET', '/api/children', { cookie: owner.cookie })).json().length, 0)
  const ok = await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { firstName: 'Fy', parentalConsent: true } })
  assert.equal(ok.statusCode, 201, ok.body)
  const { rows: [c] } = await ctx.db.query('SELECT consent_at, consent_by FROM children WHERE id = $1', [ok.json().id])
  assert.equal(c.consent_by, owner.id)
  assert.ok(c.consent_at instanceof Date)
  // Le consentement ne se modifie pas après coup.
  assert.equal((await call(ctx.app, 'PATCH', `/api/children/${ok.json().id}`, { cookie: owner.cookie, body: { parentalConsent: false } })).statusCode, 400)
  // Un compte sans famille : 404 avant tout (le consentement n'y change rien).
  assert.equal((await call(ctx.app, 'POST', '/api/children', { cookie: member.cookie, body: { firstName: 'X', parentalConsent: true } })).statusCode, 404)
})

test('export : toutes les données de la famille déchiffrées, seule l’adresse du demandeur, rien de secret, en-têtes, audit', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const manager = await join(owner, 'manager')
  const member = await join(owner, 'member')
  const pendingEmail = `invite-attente${process.pid}@exemple.fr`
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: pendingEmail, role: 'member' } })

  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName: 'Fy', avatarColor: 'violet' } })).json()
  assert.equal((await call(ctx.app, 'PUT', `/api/children/${kid.id}/parent-code`, { cookie: owner.cookie, body: { code: '914370' } })).statusCode, 200)
  const maman = (await call(ctx.app, 'POST', `/api/children/${kid.id}/contacts`, { cookie: owner.cookie, body: { name: 'Maman', phone: '034 12 345 67', memberUserId: manager.id } })).json()
  assert.ok(maman.id)
  await call(ctx.app, 'POST', `/api/children/${kid.id}/schedules`, { cookie: owner.cookie, body: { label: 'École', days: 31, startMin: 480, endMin: 720 } })
  await call(ctx.app, 'PUT', `/api/children/${kid.id}/message-templates/2`, { cookie: owner.cookie, body: { text: 'Viens me chercher' } })
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const device = (await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel 3a', osVersion: '14', appVersion: '1.0' } })).json()
  const startedAt = new Date(Date.now() - 60_000).toISOString()
  await native(ctx.app, 'POST', '/api/device/events', { token: device.accessToken, body: { events: [
    { id: randomUUID(), kind: 'call_out', contactId: maman.id, name: 'Maman', phone: '+261341234567', startedAt, durationS: 42 },
    { id: randomUUID(), kind: 'unlock', source: 'code', startedAt, durationS: 900 }
  ] } })
  const msgId = randomUUID()
  await native(ctx.app, 'POST', '/api/device/messages', { token: device.accessToken, body: { id: msgId, slot: 2, sentAt: new Date().toISOString() } })
  await call(ctx.app, 'POST', `/api/messages/${msgId}/read`, { cookie: member.cookie })
  // État du téléphone (NAR-147) : un relevé, une alerte batterie fermée, une carte SIM absente.
  const beat = (body) => native(ctx.app, 'POST', '/api/device/heartbeat', { token: device.accessToken, body })
  assert.equal((await beat({ batteryPct: 10, charging: false, network: 'wifi', simState: 'ready' })).statusCode, 200)
  assert.equal((await beat({ batteryPct: 30, charging: false, network: 'wifi', simState: 'ready' })).statusCode, 200)
  assert.equal((await beat({ batteryPct: 42, charging: true, network: 'mobile', simState: 'absent' })).statusCode, 200)

  const res = await exportOf(manager)
  assert.equal(res.statusCode, 200, res.body)
  assert.match(res.headers['content-disposition'], /^attachment; filename="akaiky-famille-\d{4}-\d{2}-\d{2}\.json"$/)
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.match(res.headers['content-type'], /^application\/json/)
  const data = res.json()
  assert.deepEqual(Object.keys(data).sort(), ['children', 'exportedAt', 'family', 'invitations', 'me', 'members'])
  assert.deepEqual(Object.keys(data.me).sort(), ['consentAt', 'createdAt', 'email', 'emailVerified', 'mfaEnabled', 'name'])
  assert.equal(data.me.email, manager.email)
  assert.equal(data.me.emailVerified, true)
  assert.equal(data.me.mfaEnabled, false)
  assert.deepEqual(Object.keys(data.family).sort(), ['createdAt', 'name', 'timezone'])
  assert.equal(data.family.name, 'Famille Rakoto')
  // Membres : adresse du demandeur seulement.
  assert.equal(data.members.length, 3)
  const me = data.members.find((m) => m.isMe)
  assert.equal(me.email, manager.email)
  assert.equal(me.role, 'manager')
  assert.ok(data.members.filter((m) => !m.isMe).every((m) => !('email' in m) && m.joinedAt))
  // Invitations : rôle et échéance, sans l'adresse de la personne invitée.
  assert.deepEqual(data.invitations.map((i) => Object.keys(i).sort()), [['expiresAt', 'role']])
  assert.equal(data.invitations[0].role, 'member')

  const [child] = data.children
  assert.equal(child.firstName, 'Fy')
  assert.equal(child.avatarColor, 'violet')
  assert.ok(child.parentCodeSetAt && child.consentAt)
  assert.equal(child.sosSiren, false)
  assert.deepEqual(child.contacts.map((c) => [c.name, c.phone, c.position, c.linkedMember]), [['Maman', '+261341234567', 1, data.members.find((m) => m.isMe).name]])
  assert.deepEqual(child.devices.map((d) => [d.model, d.osVersion, d.appVersion, d.revokedAt]), [['Pixel 3a', '14', '1.0', null]])
  assert.ok(child.devices[0].pairedAt && child.devices[0].lastSeenAt)
  assert.deepEqual(Object.keys(child.devices[0]).sort(),
    ['appVersion', 'batteryPct', 'charging', 'lastSeenAt', 'model', 'network', 'osVersion', 'pairedAt', 'revokedAt', 'simState', 'statusAt'])
  assert.deepEqual(child.devices.map((d) => [d.batteryPct, d.charging, d.network, d.simState]), [[42, true, 'mobile', 'absent']])
  assert.ok(Math.abs(Date.parse(child.devices[0].statusAt) - Date.now()) < 60_000)
  // Alertes : type et dates, champ par champ (ni téléphone, ni famille, ni enfant).
  assert.deepEqual(child.deviceAlerts.map((a) => Object.keys(a).sort()), [['closedAt', 'kind', 'openedAt'], ['closedAt', 'kind', 'openedAt']])
  assert.deepEqual(child.deviceAlerts.map((a) => [a.kind, a.closedAt === null]), [['battery_low', false], ['sim_absent', true]])
  assert.ok(child.deviceAlerts.every((a) => a.openedAt))
  assert.deepEqual(child.schedules, [{ label: 'École', days: 31, startMin: 480, endMin: 720, enabled: true }])
  assert.deepEqual(child.messageTexts, { 2: 'Viens me chercher' })
  assert.equal(child.quickMessages.length, 1)
  assert.equal(child.quickMessages[0].text, 'Viens me chercher')
  assert.equal(child.quickMessages[0].readBy.length, 1)
  assert.deepEqual(child.journal.map((e) => [e.kind, e.name, e.phone, e.durationS, e.source]).sort(),
    [['call_out', 'Maman', '+261341234567', 42, null], ['unlock', null, null, 900, 'code']])
  assert.equal(child.journalTruncated, false)
  assert.equal(child.messagesTruncated, false)
  assert.ok(!('unreadableFields' in data))

  // Rien de secret : ni hachage, ni jeton, ni identifiant de compte, ni index aveugle.
  const raw = res.body
  for (const id of [owner.id, manager.id, member.id, kid.id, maman.id, msgId, device.device.id]) assert.ok(!raw.includes(id), `identifiant ${id} absent`)
  for (const s of ['pbkdf2', 'password', 'hash', 'token', 'index', 'scrypt', '"ip"', 'secret', owner.email, member.email, pendingEmail]) assert.ok(!raw.includes(s), `${s} absent`)
  // La seule adresse du fichier est celle du demandeur.
  assert.deepEqual([...new Set(raw.match(/[\w.+-]+@[\w.-]+/g))], [manager.email])

  const { rows: logs } = await ctx.db.query("SELECT actor_id, target, details::text AS d FROM audit_log WHERE action = 'family_exported'")
  assert.equal(logs.length, 1)
  assert.equal(logs[0].actor_id, manager.id)
  assert.ok(!logs[0].d.includes('Fy') && !logs[0].d.includes('Maman'))
})

test('export : un champ chiffré abîmé donne null et unreadableFields, sans faire échouer l’export', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName: 'Tiana' } })).json()
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const device = (await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel 3a', osVersion: '14', appVersion: '1.0' } })).json()
  const evId = randomUUID()
  const startedAt = new Date(Date.now() - 60_000).toISOString()
  await native(ctx.app, 'POST', '/api/device/events', { token: device.accessToken, body: { events: [
    { id: evId, kind: 'call_in', name: 'Dadabe', phone: '+261341111111', startedAt, durationS: 5 }
  ] } })
  // Chiffré d'une autre ligne : authentique, mais données associées fausses.
  const { rowCount } = await ctx.db.query(
    "UPDATE device_events SET name_enc = (SELECT first_name_enc FROM children WHERE id = $2) WHERE id = $1 AND name_enc IS NOT NULL", [evId, kid.id])
  assert.equal(rowCount, 1)
  const res = await exportOf(owner)
  assert.equal(res.statusCode, 200, res.body)
  const data = res.json()
  assert.equal(data.unreadableFields, 1)
  const [ev] = data.children[0].journal
  assert.equal(ev.name, null)
  assert.equal(ev.phone, '+261341111111')
})

test('export : contact 403, sans famille 404, sans session 401, 5 par heure puis 429', async () => {
  const owner = await newUser(ctx), lone = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  assert.equal((await exportOf(member)).statusCode, 403)
  assert.equal((await exportOf(lone)).statusCode, 404)
  assert.equal((await call(ctx.app, 'GET', '/api/families/me/export')).statusCode, 401)
  for (let i = 0; i < 5; i++) assert.equal((await exportOf(owner)).statusCode, 200)
  assert.equal((await exportOf(owner)).statusCode, 429)
  // Les refus ne consomment rien pour les autres comptes.
  const owner2 = await newUser(ctx)
  await family(owner2)
  assert.equal((await exportOf(owner2)).statusCode, 200)
})
