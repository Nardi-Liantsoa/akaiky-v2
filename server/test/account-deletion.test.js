// Suppression de la famille (owner, mot de passe) et de son propre compte (NAR-177, C21).
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startDb, startApp, call, native, newUser, tokenIn } from './helpers.js'

const APK = { DEVICE_APK_URL: 'https://akaiky.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43) }
let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', INVITATION_EMAILS_PER_HOUR: '100000', ...APK }) })
after(async () => { await ctx.close(); dbh.stop() })

const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'
const family = (u) => call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name: 'Famille' } })
const myFamily = (u) => call(ctx.app, 'GET', '/api/families/me', { cookie: u.cookie })
const deleteFamily = (u, body) => call(ctx.app, 'DELETE', '/api/families/me', { cookie: u.cookie, body })
const deleteAccount = (u, body) => call(ctx.app, 'DELETE', '/api/auth/me', { cookie: u.cookie, body })
const whoami = async (u) => (await call(ctx.app, 'GET', '/api/auth/me', { cookie: u.cookie })).json().user
const count = async (table, column, id) => (await ctx.db.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [id])).rows[0].n

async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  assert.equal((await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })).statusCode, 200)
  return guest
}
async function pairedChild(owner, firstName) {
  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName } })).json()
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const res = await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel 3a', osVersion: '14', appVersion: '1.0' } })
  assert.equal(res.statusCode, 201, res.body)
  return { kid, device: res.json() }
}
const familyIdOf = async (u) => (await myFamily(u)).json().id

// Tables qui portent la famille, et celles qui ne la portent que par l'enfant ou l'appareil.
const BY_FAMILY = ['memberships', 'invitations', 'children', 'allowed_contacts', 'pairing_tokens', 'child_devices', 'device_events', 'quick_messages', 'quick_message_templates', 'schedules']

test('l’owner supprime sa famille : tout ce qui en dépend disparaît, le téléphone est coupé, les autres membres sont avertis', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  const memberId = (await whoami(member)).id
  const fy = await pairedChild(owner, 'Fy')
  const id = fy.kid.id
  // Contact lié au membre, journal, message lu, modèle, plage, invitation en attente, QR en cours.
  const contact = await call(ctx.app, 'POST', `/api/children/${id}/contacts`, { cookie: owner.cookie, body: { name: 'Tonton', phone: '034 44 444 44', memberUserId: memberId } })
  assert.equal(contact.statusCode, 201, contact.body)
  const ev = { id: randomUUID(), kind: 'call_out', contactId: contact.json().id, startedAt: new Date().toISOString(), durationS: 3 }
  assert.equal((await native(ctx.app, 'POST', '/api/device/events', { token: fy.device.accessToken, body: { events: [ev] } })).statusCode, 200)
  const msg = randomUUID()
  assert.equal((await native(ctx.app, 'POST', '/api/device/messages', { token: fy.device.accessToken, body: { id: msg, slot: 1, sentAt: new Date().toISOString() } })).statusCode, 200)
  assert.equal((await call(ctx.app, 'POST', `/api/messages/${msg}/read`, { cookie: member.cookie })).statusCode, 200)
  assert.equal((await call(ctx.app, 'PUT', `/api/children/${id}/message-templates/2`, { cookie: owner.cookie, body: { text: 'Viens me chercher' } })).statusCode, 200)
  assert.equal((await call(ctx.app, 'POST', `/api/children/${id}/schedules`, { cookie: owner.cookie, body: { label: 'École', days: 31, startMin: 480, endMin: 960 } })).statusCode, 201)
  assert.equal((await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: 'invite.attente@exemple.fr', role: 'member' } })).statusCode, 201)
  assert.equal((await call(ctx.app, 'POST', `/api/children/${id}/pairing`, { cookie: owner.cookie })).statusCode, 201)
  const familyId = await familyIdOf(owner)
  for (const table of BY_FAMILY) assert.ok(await count(table, 'family_id', familyId) > 0, `${table} rempli avant`)
  const deviceId = fy.device.device.id

  // Mauvais mot de passe : refusé, rien n'est effacé.
  const wrong = await deleteFamily(owner, { password: 'pas le bon mot de passe' })
  assert.equal(wrong.statusCode, 400)
  assert.equal(wrong.json().code, 'wrong_password')
  assert.equal((await deleteFamily(owner, {})).statusCode, 400)
  assert.equal(await count('families', 'id', familyId), 1)
  assert.equal((await native(ctx.app, 'GET', '/api/device/me', { token: fy.device.accessToken })).statusCode, 200)

  const before = ctx.sent.length
  const done = await deleteFamily(owner, { password: owner.password })
  assert.equal(done.statusCode, 200, done.body)
  assert.equal(await count('families', 'id', familyId), 0)
  for (const table of BY_FAMILY) assert.equal(await count(table, 'family_id', familyId), 0, `${table} vidé`)
  assert.equal(await count('device_sessions', 'device_id', deviceId), 0)
  assert.equal(await count('quick_message_reads', 'message_id', msg), 0)
  // Le téléphone est coupé, ses deux jetons ne servent plus.
  assert.equal((await native(ctx.app, 'GET', '/api/device/me', { token: fy.device.accessToken })).statusCode, 401)
  assert.equal((await native(ctx.app, 'POST', '/api/device/refresh', { body: { refreshToken: fy.device.refreshToken } })).statusCode, 401)
  // Le membre est averti (sans le nom de la famille), pas l'owner ni l'invité en attente.
  // Courriel parti après la réponse : on l'attend.
  for (let i = 0; i < 100 && ctx.sent.length === before; i++) await new Promise((r) => setTimeout(r, 20))
  await new Promise((r) => setTimeout(r, 50))
  const mails = ctx.sent.slice(before)
  assert.deepEqual(mails.map((m) => m.to), [member.email])
  assert.match(mails[0].subject, /supprimée/)
  assert.ok(!mails[0].text.includes('Famille'))
  // Audit sans donnée personnelle : des comptes seulement.
  const { rows: [log] } = await ctx.db.query("SELECT actor_id, target, details FROM audit_log WHERE action = 'family_deleted' AND target = $1", [familyId])
  assert.deepEqual(log.details, { members: 2, children: 1 })
  // Les deux comptes restent, toujours connectés, sans famille ; l'owner peut en recréer une.
  assert.equal((await whoami(owner)).id, log.actor_id)
  assert.equal((await myFamily(owner)).statusCode, 404)
  assert.equal((await myFamily(member)).statusCode, 404)
  assert.equal((await family(owner)).statusCode, 201)
})

test('suppression de la famille : manager et member → 403 quel que soit le corps ; sans famille → 404', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const manager = await join(owner, 'manager')
  const member = await join(owner, 'member')
  for (const u of [manager, member]) {
    for (const body of [{ password: u.password }, { password: 42 }, {}, undefined]) {
      const r = await deleteFamily(u, body)
      assert.equal(r.statusCode, 403, r.body)
      assert.equal(r.json().code, 'family_role')
    }
  }
  const stranger = await newUser(ctx)
  const r = await deleteFamily(stranger, { password: stranger.password })
  assert.equal(r.statusCode, 404)
  assert.equal(r.json().code, 'no_family')
  assert.equal((await myFamily(owner)).json().members.length, 3)
  assert.equal((await call(ctx.app, 'DELETE', '/api/families/me', { body: { password: 'x' } })).statusCode, 401)
})

test('un membre supprime son compte : adhésion partie, famille intacte, lien du contact effacé, sessions mortes', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'manager')
  const memberId = (await whoami(member)).id
  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName: 'Tiana' } })).json()
  const contact = (await call(ctx.app, 'POST', `/api/children/${kid.id}/contacts`, { cookie: owner.cookie, body: { name: 'Papa', phone: '034 22 222 22', memberUserId: memberId } })).json()
  // Invitation envoyée par ce gestionnaire, encore en attente.
  assert.equal((await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: member.cookie, body: { email: 'cousine@exemple.fr', role: 'member' } })).statusCode, 201)
  // Invitation en attente adressée à ce membre par une autre famille (adresse en majuscules).
  const other = await newUser(ctx)
  await family(other)
  assert.equal((await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: other.cookie, body: { email: member.email.toUpperCase(), role: 'member' } })).statusCode, 201)
  const pendingFor = async (e) => (await ctx.db.query('SELECT count(*)::int AS n FROM invitations WHERE email = $1 AND used_at IS NULL', [e])).rows[0].n
  assert.equal(await pendingFor(member.email), 1)
  const nat = await native(ctx.app, 'POST', '/api/auth/native/login', { body: { email: member.email, password: member.password } })
  assert.equal(nat.statusCode, 200, nat.body)

  assert.equal((await deleteAccount(member, { password: 'mauvais mot de passe' })).json().code, 'wrong_password')
  assert.equal(await count('users', 'id', memberId), 1)

  const res = await deleteAccount(member, { password: member.password })
  assert.equal(res.statusCode, 200, res.body)
  assert.ok([].concat(res.headers['set-cookie']).some((c) => /app-session=;.*Max-Age=0/.test(c)), 'cookie effacé')
  assert.equal(await count('users', 'id', memberId), 0)
  assert.equal(await count('memberships', 'user_id', memberId), 0)
  assert.equal(await count('sessions', 'user_id', memberId), 0)
  assert.equal(await count('invitations', 'email', 'cousine@exemple.fr'), 0)
  assert.equal(await pendingFor(member.email), 0)
  // Aucune invitation à son adresse ne reste, pas même celle qu'il a acceptée.
  assert.equal(await count('invitations', 'email', member.email), 0)
  assert.equal((await ctx.db.query('SELECT member_user_id FROM allowed_contacts WHERE id = $1', [contact.id])).rows[0].member_user_id, null)
  assert.equal(await whoami(member), null)
  assert.equal((await native(ctx.app, 'GET', '/api/families/me', { token: nat.json().accessToken })).statusCode, 401)
  assert.equal((await native(ctx.app, 'POST', '/api/auth/native/refresh', { body: { refreshToken: nat.json().refreshToken } })).statusCode, 401)
  const fam = (await myFamily(owner)).json()
  assert.deepEqual(fam.members.map((m) => m.role), ['owner'])
  assert.equal((await ctx.db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'account_deleted' AND target = $1", [memberId])).rows[0].n, 1)
})

test('un owner ne supprime pas son compte (409) ; un compte sans famille, si', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const r = await deleteAccount(owner, { password: owner.password })
  assert.equal(r.statusCode, 409)
  assert.equal(r.json().code, 'owner_must_transfer_or_delete')
  assert.equal((await myFamily(owner)).statusCode, 200)
  assert.equal((await whoami(owner)).email, owner.email)

  const lone = await newUser(ctx)
  assert.equal((await deleteAccount(lone, {})).statusCode, 400)
  assert.equal((await deleteAccount(lone, { password: lone.password })).statusCode, 200)
  assert.equal(await whoami(lone), null)
  assert.equal((await call(ctx.app, 'POST', '/api/auth/login', { body: { email: lone.email, password: lone.password } })).statusCode, 401)
})

test('le dernier administrateur ne supprime pas son compte (409 last_admin) ; avec un autre administrateur, si', async () => {
  const first = await newUser(ctx, { admin: true })
  // Seul administrateur de la base de ce fichier.
  assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM users WHERE is_admin AND id <> $1', [first.id])).rows[0].n, 0)
  const r = await deleteAccount(first, { password: first.password })
  assert.equal(r.statusCode, 409)
  assert.equal(r.json().code, 'last_admin')
  assert.equal(await count('users', 'id', first.id), 1)

  const second = await newUser(ctx, { admin: true })
  assert.equal((await deleteAccount(first, { password: first.password })).statusCode, 200)
  assert.equal(await count('users', 'id', first.id), 0)
  assert.equal((await deleteAccount(second, { password: second.password })).json().code, 'last_admin')
  assert.equal(await count('users', 'id', second.id), 1)
})

test('promu owner juste avant, un membre ne supprime plus son compte (409) ; rétrogradé, si', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  const memberId = (await whoami(member)).id
  const promote = (role) => call(ctx.app, 'PATCH', `/api/families/me/members/${memberId}`, { cookie: owner.cookie, body: { role } })
  assert.equal((await promote('owner')).statusCode, 200)
  const r = await deleteAccount(member, { password: member.password })
  assert.equal(r.statusCode, 409)
  assert.equal(r.json().code, 'owner_must_transfer_or_delete')
  assert.equal(await count('users', 'id', memberId), 1)
  assert.equal((await promote('member')).statusCode, 200)
  assert.equal((await deleteAccount(member, { password: member.password })).statusCode, 200)
  assert.deepEqual((await myFamily(owner)).json().members.map((m) => m.role), ['owner'])
})
