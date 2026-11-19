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
const templates = (u, id) => call(ctx.app, 'GET', `/api/children/${id}/message-templates`, { cookie: u.cookie })
const put = (u, id, slot, text) => call(ctx.app, 'PUT', `/api/children/${id}/message-templates/${slot}`, { cookie: u.cookie, body: { text } })
const config = (device, etag) => native(ctx.app, 'GET', '/api/device/config', { token: device.accessToken, headers: etag ? { 'if-none-match': etag } : {} })

async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })
  return guest
}
async function pairedChild(owner, firstName) {
  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName } })).json()
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const res = await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel 3a', osVersion: '14', appVersion: '1.0' } })
  assert.equal(res.statusCode, 201, res.body)
  return { kid, device: res.json() }
}

test('le gestionnaire modifie un texte : le téléphone le reçoit (sans 304 périmé), le journal garde le texte envoyé', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const manager = await join(owner, 'manager')
  const member = await join(owner, 'member')
  const fy = await pairedChild(owner, 'Fy')

  assert.deepEqual((await templates(member, fy.kid.id)).json(), [1, 2, 3, 4].map((slot) => ({ slot, text: null })))
  const first = await config(fy.device)
  assert.deepEqual(first.json().messageTexts, {})

  const saved = await put(manager, fy.kid.id, 2, '  Viens me chercher à l’école  ')
  assert.equal(saved.statusCode, 200, saved.body)
  assert.deepEqual(saved.json(), { slot: 2, text: 'Viens me chercher à l’école' })
  // Deux enregistrements simultanés du même texte : une seule écriture, une seule version.
  const v0 = (await ctx.db.query('SELECT config_version FROM children WHERE id = $1', [fy.kid.id])).rows[0].config_version
  await Promise.all([put(manager, fy.kid.id, 3, 'Bus en retard'), put(owner, fy.kid.id, 3, 'Bus en retard')])
  assert.equal((await ctx.db.query('SELECT config_version FROM children WHERE id = $1', [fy.kid.id])).rows[0].config_version, String(Number(v0) + 1))
  await put(owner, fy.kid.id, 3, null)
  // Même texte renvoyé : aucune nouvelle version (pas de téléchargement inutile côté téléphone).
  const v1 = (await ctx.db.query('SELECT config_version FROM children WHERE id = $1', [fy.kid.id])).rows[0].config_version
  assert.equal((await put(manager, fy.kid.id, 2, 'Viens me chercher à l’école')).statusCode, 200)
  assert.equal((await ctx.db.query('SELECT config_version FROM children WHERE id = $1', [fy.kid.id])).rows[0].config_version, v1)
  const after = await config(fy.device, first.headers.etag)
  assert.equal(after.statusCode, 200, 'un texte modifié invalide le 304')
  assert.deepEqual(after.json().messageTexts, { 2: 'Viens me chercher à l’école' })
  assert.equal((await templates(member, fy.kid.id)).json()[1].text, 'Viens me chercher à l’école')

  // Chiffré au repos.
  const { rows: [row] } = await ctx.db.query('SELECT text_enc FROM quick_message_templates WHERE child_id = $1', [fy.kid.id])
  assert.ok(!row.text_enc.includes(Buffer.from('chercher')))

  // Message envoyé avec ce texte, puis texte remis par défaut : le journal garde le texte envoyé.
  const id = randomUUID()
  assert.equal((await native(ctx.app, 'POST', '/api/device/messages', { token: fy.device.accessToken, body: { id, slot: 2, sentAt: new Date().toISOString() } })).statusCode, 200)
  assert.equal((await put(owner, fy.kid.id, 2, null)).json().text, null)
  assert.deepEqual((await config(fy.device)).json().messageTexts, {})
  const journal = (await call(ctx.app, 'GET', `/api/children/${fy.kid.id}/journal?kind=messages`, { cookie: owner.cookie })).json()
  assert.equal(journal.items[0].text, 'Viens me chercher à l’école')
  // Même texte dans les listes de messages, côté parents et côté téléphone.
  assert.equal((await call(ctx.app, 'GET', `/api/children/${fy.kid.id}/messages`, { cookie: owner.cookie })).json()[0].text, 'Viens me chercher à l’école')
  assert.equal((await native(ctx.app, 'GET', '/api/device/messages', { token: fy.device.accessToken })).json()[0].text, 'Viens me chercher à l’école')
  const other = randomUUID()
  await native(ctx.app, 'POST', '/api/device/messages', { token: fy.device.accessToken, body: { id: other, slot: 2, sentAt: new Date().toISOString() } })
  assert.equal((await call(ctx.app, 'GET', `/api/children/${fy.kid.id}/journal?kind=messages`, { cookie: owner.cookie })).json().items[0].text, null)
})

test('droits et validation : contact 403, autre famille 404, texte vide ou trop long 400, emplacement inconnu 404', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName: 'Fy' } })).json()
  assert.equal((await put(member, kid.id, 1, 'Coucou')).statusCode, 403)
  // Droits vérifiés avant le contenu : texte invalide ou emplacement inconnu, toujours 403.
  assert.equal((await put(member, kid.id, 1, '')).statusCode, 403)
  assert.equal((await put(member, kid.id, 9, 'Coucou')).statusCode, 403)
  assert.equal((await put(member, kid.id, 1, 123)).statusCode, 403)
  assert.equal((await call(ctx.app, 'PUT', `/api/children/${kid.id}/message-templates/1`, { cookie: member.cookie, body: { text: 'a', slot: 3 } })).statusCode, 403)
  assert.equal((await put(owner, kid.id, 1, 123)).statusCode, 400)
  // 40 caractères comptés en points de code : 40 émojis passent.
  assert.equal((await put(owner, kid.id, 4, '😀'.repeat(40))).statusCode, 200)
  assert.equal((await put(owner, kid.id, 4, null)).statusCode, 200)
  const stranger = await newUser(ctx)
  await family(stranger)
  assert.equal((await put(stranger, kid.id, 1, 'Coucou')).statusCode, 404)
  assert.equal((await templates(stranger, kid.id)).statusCode, 404)
  assert.equal((await put(owner, kid.id, 1, '   ')).statusCode, 400)
  assert.equal((await put(owner, kid.id, 1, 'x'.repeat(41))).statusCode, 400)
  assert.equal((await put(owner, kid.id, 5, 'Coucou')).statusCode, 404)
  assert.equal((await call(ctx.app, 'PUT', `/api/children/${kid.id}/message-templates/1`, { cookie: owner.cookie, body: { text: 'Coucou', slot: 3 } })).statusCode, 400)
  const { rowCount } = await ctx.db.query('SELECT 1 FROM quick_message_templates WHERE child_id = $1', [kid.id])
  assert.equal(rowCount, 0)
})
