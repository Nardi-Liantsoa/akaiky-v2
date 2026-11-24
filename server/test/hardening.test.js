import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { startDb, startApp, call, native, newUser } from './helpers.js'
import { createLimiter, hashPassword, rateLimitKey } from '../src/security.js'
import { createPool, verifySchema } from '../src/db.js'
import { loadConfig } from '../src/config.js'
import { buildApp } from '../src/app.js'
import { createFakeProvider, runPushWorker } from '../src/push.js'
import { runSilentWatch } from '../src/device-status.js'

test('limiteur : saturation sans blocage global ni éviction des compteurs', () => {
  const limit = createLimiter({ max: 2, windowMs: 60000, maxKeys: 2 })
  assert.equal(limit('a'), true); assert.equal(limit('b'), true)
  assert.equal(limit('c'), true); assert.equal(limit('a'), true); assert.equal(limit('a'), false)
})
test('hachages : file bornée, surcharge refusée puis service disponible', async () => {
  const results = await Promise.allSettled(Array.from({ length: 14 }, () => hashPassword('un long mot de passe test')))
  assert.ok(results.some(r => r.status === 'rejected' && r.reason.status === 503))
  assert.ok(results.some(r => r.status === 'fulfilled'))
  assert.match(await hashPassword('un nouveau mot de passe test'), /^scrypt\$/)
})
test('configuration : aucun proxy implicitement fiable', () => {
  const env = { DATABASE_URL: 'postgres://unused' }
  assert.equal(loadConfig(env).trustProxy, false)
  assert.throws(() => loadConfig({ ...env, TRUST_PROXY: 'true' }))
  assert.throws(() => loadConfig({ ...env, TRUST_PROXY: '1' }))
})
test('API : entrées malformées, proxy falsifié et quotas globaux', async () => {
  const db = await startDb(), ctx = await startApp(db.url, { TRUST_PROXY: '10.42.0.2' })
  ctx.app.get('/test-ip', req => ({ ip: req.ip }))
  try {
    const badCookie = await call(ctx.app, 'GET', '/api/auth/me', { cookie: 'app-session=%ZZ' })
    assert.equal(badCookie.statusCode, 200); assert.equal(badCookie.json().user, null)
    assert.equal((await ctx.app.inject({ url: '/%ZZ' })).statusCode, 400)
    const spoofed = await ctx.app.inject({ url: '/test-ip', remoteAddress: '10.42.0.3', headers: { 'x-forwarded-for': '1.2.3.4' } })
    assert.equal(spoofed.json().ip, '10.42.0.3')
    const trusted = await ctx.app.inject({ url: '/test-ip', remoteAddress: '10.42.0.2', headers: { 'x-forwarded-for': '1.2.3.4' } })
    assert.equal(trusted.json().ip, '1.2.3.4')
    for (let i = 0; i < 300; i++) await ctx.app.inject({ url: '/api/auth/me', remoteAddress: '10.1.1.1' })
    const limited = await ctx.app.inject({ url: '/api/auth/me', remoteAddress: '10.1.1.1' })
    assert.equal(limited.statusCode, 429); assert.equal(limited.headers['retry-after'], '60')
    assert.equal((await ctx.app.inject({ url: '/health', remoteAddress: '10.1.1.1' })).statusCode, 200)
  } finally { await ctx.close(); db.stop() }
})
test('PostgreSQL : parcours restreint, élévation et DDL refusés', async () => {
  const db = await startDb(), admin = await startApp(db.url)
  let runtime
  try {
    const sql = (await readFile(new URL('../../ops/runtime-role.sql', import.meta.url), 'utf8')).replace(":'runtime_password'", "'runtime-test-only'")
    await admin.db.query(sql)
    const url = new URL(db.url); url.username = 'app_runtime'; url.password = 'runtime-test-only'
    const pool = createPool(url.toString())
    await verifySchema(pool)
    const config = loadConfig({
      DATABASE_URL: url.toString(), APP_ORIGIN: 'https://app.test', RATE_LIMIT_IP: '10000', NATIVE_ORIGINS: 'capacitor://localhost,https://localhost',
      DEVICE_APK_URL: 'https://cdn.app.test/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43)
    })
    const sent = [], app = await buildApp({ config, db: pool, mailer: { async send(m) { sent.push(m) } }, logger: false })
    runtime = { app, db: pool, sent }
    const user = await newUser(runtime)
    assert.equal((await call(app, 'GET', '/api/auth/me', { cookie: user.cookie })).json().user.id, user.id)
    // Familles sous le rôle restreint : création, lecture, renommage (GRANT de 003_families.sql).
    const family = await call(app, 'POST', '/api/families', { cookie: user.cookie, body: { name: 'Famille durcie' } })
    assert.equal(family.statusCode, 201, family.body)
    assert.equal((await call(app, 'PATCH', '/api/families/me', { cookie: user.cookie, body: { name: 'Renommée' } })).statusCode, 200)
    assert.equal((await call(app, 'GET', '/api/families/me', { cookie: user.cookie })).json().name, 'Renommée')
    // Invitation, acceptation, rôle et départ sous le rôle restreint (GRANT de 004_invitations.sql).
    const guest = await newUser(runtime)
    assert.equal((await call(app, 'POST', '/api/families/me/invitations', { cookie: user.cookie, body: { email: guest.email, role: 'member' } })).statusCode, 201)
    const token = runtime.sent.findLast((m) => m.to === guest.email).text.match(/#invite=([A-Za-z0-9_-]+)/)[1]
    assert.equal((await call(app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })).statusCode, 200)
    assert.equal((await call(app, 'PATCH', `/api/families/me/members/${guest.id}`, { cookie: user.cookie, body: { role: 'manager' } })).statusCode, 200)
    assert.equal((await call(app, 'DELETE', `/api/families/me/members/${guest.id}`, { cookie: guest.cookie })).statusCode, 200)
    // Enfants sous le rôle restreint (GRANT de 005_children.sql).
    const child = await call(app, 'POST', '/api/children', { cookie: user.cookie, body: { parentalConsent: true, firstName: 'Fy' } })
    assert.equal(child.statusCode, 201, child.body)
    assert.equal((await call(app, 'PATCH', `/api/children/${child.json().id}`, { cookie: user.cookie, body: { firstName: 'Fyfy' } })).statusCode, 200)
    // Code parent (009_parent_code.sql) : écrit, et config_version avance sans droit sur elle.
    assert.equal((await call(app, 'PUT', `/api/children/${child.json().id}/parent-code`, { cookie: user.cookie, body: { code: '482915' } })).statusCode, 200)
    await assert.rejects(pool.query('UPDATE children SET config_version = 0'), /permission denied/)
    // Déverrouillage à distance (010_unlocks.sql) sous le rôle restreint.
    assert.equal((await call(app, 'POST', `/api/children/${child.json().id}/unlock`, { cookie: user.cookie })).statusCode, 200)
    // Sirène pendant un SOS (022_sos_siren.sql) sous le rôle restreint.
    assert.equal((await call(app, 'PUT', `/api/children/${child.json().id}/sos-siren`, { cookie: user.cookie, body: { enabled: true } })).statusCode, 200)
    // Numéro de l'enfant (025_child_phone.sql) : posé, lu puis effacé sous le rôle restreint ;
    // la colonne chiffrée seule est ouverte en écriture, jamais la famille ni le consentement.
    const withPhone = await call(app, 'PATCH', `/api/children/${child.json().id}`, { cookie: user.cookie, body: { phone: '034 12 345 67' } })
    assert.equal(withPhone.statusCode, 200, withPhone.body)
    assert.equal(withPhone.json().phone, '+261341234567')
    assert.equal((await call(app, 'PATCH', `/api/children/${child.json().id}`, { cookie: user.cookie, body: { phone: null } })).json().phone, null)
    const { rows: childGrants } = await pool.query(
      `SELECT column_name FROM information_schema.column_privileges
        WHERE grantee = 'app_runtime' AND table_name = 'children' AND privilege_type = 'UPDATE' ORDER BY column_name`)
    assert.deepEqual(childGrants.map((r) => r.column_name),
      ['avatar_color', 'first_name_enc', 'parent_code_hash', 'parent_code_reset_requested_at', 'parent_code_set_at', 'phone_enc', 'remote_unlock_until', 'sos_siren'])
    await assert.rejects(pool.query('UPDATE children SET consent_by = consent_by'), /permission denied/)
    assert.equal((await call(app, 'DELETE', `/api/children/${child.json().id}`, { cookie: user.cookie })).statusCode, 200)
    await assert.rejects(pool.query('UPDATE children SET family_id = family_id'), /permission denied/)
    // Contacts autorisés sous le rôle restreint (GRANT de 006_allowed_contacts.sql).
    const kid = (await call(app, 'POST', '/api/children', { cookie: user.cookie, body: { parentalConsent: true, firstName: 'Tiana' } })).json()
    const contact = await call(app, 'POST', `/api/children/${kid.id}/contacts`, { cookie: user.cookie, body: { name: 'Maman', phone: '034 12 345 67' } })
    assert.equal(contact.statusCode, 201, contact.body)
    assert.equal((await call(app, 'PATCH', `/api/contacts/${contact.json().id}`, { cookie: user.cookie, body: { name: 'Mama' } })).statusCode, 200)
    assert.equal((await call(app, 'PUT', `/api/children/${kid.id}/contacts/order`, { cookie: user.cookie, body: { ids: [contact.json().id] } })).statusCode, 200)
    assert.equal((await call(app, 'DELETE', `/api/contacts/${contact.json().id}`, { cookie: user.cookie })).statusCode, 200)
    await assert.rejects(pool.query('UPDATE allowed_contacts SET child_id = child_id'), /permission denied/)
    await assert.rejects(pool.query('UPDATE children SET config_version = 0'), /permission denied/)
    // Appairage sous le rôle restreint (GRANT de 007_devices.sql).
    const qr = await call(app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: user.cookie })
    assert.equal(qr.statusCode, 201, qr.body)
    const pairingToken = qr.json().provisioning['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE']['akaiky.pairing']
    const phone = await native(app, 'POST', '/api/device/pair', { body: { token: pairingToken, model: 'Pixel' } })
    assert.equal(phone.statusCode, 201, phone.body)
    assert.equal((await native(app, 'GET', '/api/device/me', { token: phone.json().accessToken })).statusCode, 200)
    const renewedPhone = await native(app, 'POST', '/api/device/refresh', { body: { refreshToken: phone.json().refreshToken } })
    assert.equal(renewedPhone.statusCode, 200, renewedPhone.body)
    // Journal du téléphone sous le rôle restreint (GRANT de 008_device_events.sql) : ajout seul.
    const papa = (await call(app, 'POST', `/api/children/${kid.id}/contacts`, { cookie: user.cookie, body: { name: 'Papa', phone: '033 12 345 67' } })).json()
    const ev = { id: crypto.randomUUID(), kind: 'call_out', contactId: papa.id, startedAt: new Date().toISOString(), durationS: 3 }
    const logged = await native(app, 'POST', '/api/device/events', { token: renewedPhone.json().accessToken, body: { events: [ev] } })
    assert.deepEqual(logged.json(), { accepted: [ev.id], rejected: [] })
    await assert.rejects(pool.query('UPDATE device_events SET duration_s = 0'), /permission denied/)
    await assert.rejects(pool.query('DELETE FROM device_events'), /permission denied/)
    // Applications autorisées sous le rôle restreint (023_allowed_apps.sql) : inventaire remplacé,
    // liste choisie puis vidée ; config_version suit par déclencheur ; aucun UPDATE.
    const inventory = { apps: [{ package: 'com.android.calculator2', label: 'Calculatrice' }] }
    for (let i = 0; i < 2; i++) {
      const sent = await native(app, 'PUT', '/api/device/apps', { token: renewedPhone.json().accessToken, body: inventory })
      assert.equal(sent.statusCode, 200, sent.body)
    }
    assert.equal((await call(app, 'PUT', `/api/children/${kid.id}/allowed-apps`, { cookie: user.cookie, body: { packages: ['com.android.calculator2'] } })).statusCode, 200)
    assert.deepEqual((await native(app, 'GET', '/api/device/config', { token: renewedPhone.json().accessToken })).json().allowedApps.map((x) => x.package), ['com.android.calculator2'])
    assert.equal((await call(app, 'GET', `/api/children/${kid.id}/apps`, { cookie: user.cookie })).statusCode, 200)
    assert.equal((await call(app, 'PUT', `/api/children/${kid.id}/allowed-apps`, { cookie: user.cookie, body: { packages: [] } })).statusCode, 200)
    await assert.rejects(pool.query('UPDATE allowed_apps SET child_id = child_id'), /permission denied/)
    await assert.rejects(pool.query('UPDATE device_apps SET device_id = device_id'), /permission denied/)
    // Bundles OTA (024_ota_bundles.sql) : publiés par le propriétaire, lus et servis par le rôle
    // restreint, qui ne peut ni en publier, ni en modifier, ni en effacer.
    const zip = Buffer.from('PK\u0003\u0004 bundle de test du rôle restreint')
    const { rows: [ota] } = await admin.db.query(
      "INSERT INTO ota_bundles(app, channel, version, min_native_build, bundle, sha256) VALUES ('enfant','enfant','e1',2,$1,encode(sha256($1),'hex')) RETURNING id", [zip])
    const otaInfo = { platform: 'android', app_id: 'mg.nosytech.akaiky.enfant', version_code: '2', version_name: 'builtin', defaultChannel: 'enfant' }
    const offer = await app.inject({ method: 'POST', url: '/api/ota/latest', payload: otaInfo })
    assert.equal(offer.statusCode, 200, offer.body)
    assert.equal(offer.json().url, `https://app.test/api/ota/bundles/${ota.id}`)
    assert.equal((await app.inject({ method: 'POST', url: '/api/ota/latest', payload: { ...otaInfo, app_id: 'mg.nosytech.akaiky' } })).json().version, undefined)
    assert.equal((await app.inject({ method: 'PUT', url: '/api/ota/channel', payload: { ...otaInfo, defaultChannel: 'parent' } })).json().channel, 'enfant')
    assert.deepEqual((await app.inject({ method: 'GET', url: `/api/ota/bundles/${ota.id}` })).rawPayload, zip)
    await assert.rejects(pool.query("INSERT INTO ota_bundles(app, channel, version, min_native_build, bundle, sha256) SELECT app, channel, 'e2', 1, bundle, sha256 FROM ota_bundles"), /permission denied/)
    await assert.rejects(pool.query("UPDATE ota_bundles SET app = 'parent', channel = 'parent'"), /permission denied/)
    await assert.rejects(pool.query('UPDATE ota_bundles SET min_native_build = 1'), /permission denied/)
    await assert.rejects(pool.query('DELETE FROM ota_bundles'), /permission denied/)
    await assert.rejects(pool.query('TRUNCATE ota_bundles'), /permission denied/)
    // Purge à échéance (016_retention.sql) : lancée par le rôle restreint, durées fixées dans
    // la base ; aucun DELETE direct sur les journaux pour autant.
    await pool.query("SELECT purge_expired()")
    await assert.rejects(pool.query('DELETE FROM quick_messages'), /permission denied/)
    await assert.rejects(pool.query("UPDATE job_runs SET started_at = NULL"), /permission denied/)
    // Notifications push sous le rôle restreint (019_push.sql) : jetons du parent et du téléphone,
    // message rapide mis en file, worker (réservation, envoi, issue, jeton mort supprimé).
    const pushToken = `fcm-parent-${crypto.randomUUID()}`
    assert.equal((await call(app, 'PUT', '/api/push/token', { cookie: user.cookie, body: { token: pushToken, platform: 'android', lang: 'fr' } })).statusCode, 200)
    assert.equal((await call(app, 'PUT', '/api/push/token', { cookie: user.cookie, body: { token: pushToken, platform: 'android', lang: 'en' } })).statusCode, 200)
    assert.equal((await native(app, 'PUT', '/api/device/push/token', { token: renewedPhone.json().accessToken, body: { token: `fcm-phone-${crypto.randomUUID()}`, platform: 'android' } })).statusCode, 200)
    const quick = await native(app, 'POST', '/api/device/messages', { token: renewedPhone.json().accessToken, body: { id: crypto.randomUUID(), slot: 1, sentAt: new Date().toISOString() } })
    assert.equal(quick.statusCode, 200, quick.body)
    const pushes = createFakeProvider(), quiet = { info() {}, error() {} }
    assert.equal((await runPushWorker(pool, pushes, config, quiet)).sent, 1)
    assert.equal(pushes.sent[0].message.notification.title, 'Tiana sent a message')
    assert.equal((await call(app, 'POST', '/api/push/test', { cookie: user.cookie })).statusCode, 200)
    pushes.failNext('retry')
    assert.equal((await runPushWorker(pool, pushes, config, quiet)).retried, 1)
    await assert.rejects(pool.query('UPDATE push_tokens SET session_id = session_id'), /permission denied/)
    await assert.rejects(pool.query('UPDATE push_tokens SET device_id = device_id'), /permission denied/)
    await assert.rejects(pool.query('UPDATE push_tokens SET token_enc = token_enc'), /permission denied/)
    await assert.rejects(pool.query('UPDATE push_outbox SET token_id = token_id'), /permission denied/)
    await assert.rejects(pool.query('DELETE FROM push_outbox'), /permission denied/)
    await admin.db.query("UPDATE push_outbox SET next_attempt_at = now() WHERE status = 'pending'")
    pushes.failNext('unregistered')
    assert.equal((await runPushWorker(pool, pushes, config, quiet)).removedTokens, 1)
    assert.equal((await call(app, 'DELETE', '/api/push/token', { cookie: user.cookie, body: { token: pushToken } })).statusCode, 404, 'jeton mort supprimé')
    // État du téléphone sous le rôle restreint (020_device_status.sql) : signal, alerte et push,
    // veille « silence », fermeture ; ni DELETE ni autre colonne des alertes.
    assert.equal((await call(app, 'PUT', '/api/push/token', { cookie: user.cookie, body: { token: `fcm-parent-${crypto.randomUUID()}`, platform: 'android', lang: 'fr' } })).statusCode, 200)
    const beat = (body) => native(app, 'POST', '/api/device/heartbeat', { token: renewedPhone.json().accessToken, body })
    // background : vrai (signal natif en arrière-plan, NAR-180), seul surveillé pour le silence.
    const low = await beat({ batteryPct: 9, charging: false, network: 'mobile', simState: 'ready', background: true })
    assert.equal(low.statusCode, 200, low.body)
    const state = await call(app, 'GET', `/api/children/${kid.id}/status`, { cookie: user.cookie })
    assert.deepEqual(state.json().devices[0].alerts.map((a) => a.kind), ['battery_low'])
    assert.equal((await runPushWorker(pool, pushes, config, quiet)).sent, 1)
    assert.equal(pushes.sent.at(-1).message.notification.title, 'Batterie faible : téléphone de Tiana')
    await admin.db.query("UPDATE child_devices SET status_at = now() - interval '61 minutes' WHERE id = $1", [phone.json().device.id])
    assert.equal(await runSilentWatch(pool), 1)
    assert.equal(await runSilentWatch(pool), 0)
    assert.equal((await beat({ batteryPct: 30, charging: true, network: 'wifi', simState: 'ready' })).statusCode, 200)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM device_alerts WHERE closed_at IS NULL')).rows[0].n, 0)
    await assert.rejects(pool.query('DELETE FROM device_alerts'), /permission denied/)
    await assert.rejects(pool.query('UPDATE device_alerts SET kind = kind'), /permission denied/)
    await assert.rejects(pool.query('UPDATE device_alerts SET opened_at = now()'), /permission denied/)
    // Position à la demande sous le rôle restreint : demande (verrou de l'enfant, upsert),
    // réveil, relevé, lecture.
    assert.equal((await call(app, 'POST', `/api/children/${kid.id}/locate`, { cookie: user.cookie })).statusCode, 200)
    assert.equal((await call(app, 'POST', `/api/children/${kid.id}/locate`, { cookie: user.cookie })).statusCode, 200, 'prolongée')
    const fix = await native(app, 'POST', '/api/device/positions', { token: renewedPhone.json().accessToken, body: { lat: -18.9, lng: 47.5, accuracyM: 10, ageS: 0 } })
    assert.equal(fix.statusCode, 200, fix.body)
    assert.equal((await call(app, 'GET', `/api/children/${kid.id}/position`, { cookie: user.cookie })).json().position.lat, -18.9)
    // Positions (030_positions.sql) : ajout et lecture seuls ; demandes jamais déplacées.
    await assert.rejects(pool.query('UPDATE positions SET accuracy_m = 1'), /permission denied/)
    await assert.rejects(pool.query('UPDATE positions SET lat_enc = lat_enc'), /permission denied/)
    await assert.rejects(pool.query('DELETE FROM positions'), /permission denied/)
    await assert.rejects(pool.query('UPDATE location_requests SET user_id = user_id'), /permission denied/)
    await assert.rejects(pool.query('UPDATE location_requests SET child_id = child_id'), /permission denied/)
    await assert.rejects(pool.query('DELETE FROM location_requests'), /permission denied/)
    // Jeton « signal de vie » du natif (021_heartbeat_tokens.sql) : émis, remplacé, utilisé sans origine.
    const hbToken = async () => (await native(app, 'POST', '/api/device/heartbeat-token', { token: renewedPhone.json().accessToken, body: {} })).json().token
    const oldHb = await hbToken(), hb = await hbToken()
    const hbBeat = (t) => app.inject({ method: 'POST', url: '/api/device/heartbeat', headers: { authorization: `Heartbeat ${t}` },
      payload: { batteryPct: 31, charging: true, network: 'wifi', simState: 'ready', background: true } })
    assert.equal((await hbBeat(hb)).statusCode, 200)
    assert.equal((await hbBeat(oldHb)).statusCode, 401)
    assert.equal((await call(app, 'POST', `/api/devices/${phone.json().device.id}/revoke`, { cookie: user.cookie })).statusCode, 200)
    assert.equal((await hbBeat(hb)).statusCode, 401, 'révoqué : jeton « signal de vie » refusé')
    assert.equal((await admin.db.query('SELECT heartbeat_token_hash FROM child_devices WHERE id = $1', [phone.json().device.id])).rows[0].heartbeat_token_hash, null)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM push_tokens WHERE device_id IS NOT NULL')).rows[0].n, 0, 'révoqué : jeton du téléphone supprimé')
    await assert.rejects(pool.query('UPDATE child_devices SET child_id = child_id'), /permission denied/)
    await assert.rejects(pool.query('UPDATE child_devices SET family_id = family_id'), /permission denied/)
    await assert.rejects(pool.query('UPDATE device_sessions SET device_id = device_id'), /permission denied/)
    await assert.rejects(pool.query('UPDATE pairing_tokens SET child_id = child_id'), /permission denied/)
    await assert.rejects(pool.query('UPDATE pairing_tokens SET expires_at = now()'), /permission denied/)
    await assert.rejects(pool.query('DELETE FROM child_devices'), /permission denied/)
    await assert.rejects(pool.query('UPDATE memberships SET family_id = family_id'), /permission denied/)
    await assert.rejects(pool.query('UPDATE invitations SET role = role'), /permission denied/)
    await assert.rejects(pool.query('TRUNCATE families CASCADE'), /permission denied/)
    const nat = await native(app, 'POST', '/api/auth/native/login', { body: { email: user.email, password: user.password } })
    assert.equal(nat.statusCode, 200, nat.body)
    const renewed = await native(app, 'POST', '/api/auth/native/refresh', { body: { refreshToken: nat.json().refreshToken } })
    assert.equal(renewed.statusCode, 200, renewed.body)
    await native(app, 'POST', '/api/auth/native/logout', { body: { refreshToken: renewed.json().refreshToken } })
    assert.equal((await native(app, 'POST', '/api/auth/native/refresh', { body: { refreshToken: renewed.json().refreshToken } })).statusCode, 401)
    // Suppressions sous le rôle restreint (017_family_deletion.sql) : compte d'un ancien membre,
    // puis famille par son owner, cascade comprise (contacts, journal, téléphone).
    assert.equal((await call(app, 'DELETE', '/api/auth/me', { cookie: guest.cookie, body: { password: guest.password } })).statusCode, 200)
    assert.equal((await call(app, 'GET', '/api/auth/me', { cookie: guest.cookie })).json().user, null)
    const dropped = await call(app, 'DELETE', '/api/families/me', { cookie: user.cookie, body: { password: user.password } })
    assert.equal(dropped.statusCode, 200, dropped.body)
    assert.equal((await call(app, 'GET', '/api/families/me', { cookie: user.cookie })).statusCode, 404)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM device_events')).rows[0].n, 0)
    await assert.rejects(pool.query('UPDATE users SET is_admin = true'), /permission denied/)
    await assert.rejects(pool.query('CREATE TABLE public.forbidden(id int)'), /permission denied/)
    await assert.rejects(pool.query("COPY (SELECT 1) TO PROGRAM 'true'"), /permission denied|superuser/)
    await assert.rejects(pool.query('DELETE FROM audit_log'), /permission denied/)
    await assert.rejects(pool.query("UPDATE users SET email = 'pirate@exemple.fr'"), /permission denied/)
    await assert.rejects(pool.query("UPDATE audit_log SET action = 'x'"), /permission denied/)
    await assert.rejects(pool.query("INSERT INTO mfa_enrollment_invites(user_id, token_hash, expires_at) SELECT id, '\\x00', now() FROM users"), /permission denied/)
    await assert.rejects(pool.query('SET ROLE postgres'), /permission denied/)
  } finally {
    if (runtime) { await runtime.app.close(); await runtime.db.end() }
    await admin.close(); db.stop()
  }
})

test('IPv6 : changer le suffixe ne contourne pas le quota du préfixe', () => {
  assert.equal(rateLimitKey('2001:db8:1234:5678::1'), rateLimitKey('2001:0db8:1234:5678:abcd:ffff:1:2'))
  assert.notEqual(rateLimitKey('2001:db8:1234:5678::1'), rateLimitKey('2001:db8:1234:5679::1'))
  assert.equal(rateLimitKey('::ffff:127.0.0.1'), '127.0.0.1')
})
test('délai de connexion : croissance après dix échecs, plafond de 30 secondes', async () => {
  const { loginDelay } = await import('../src/login-guard.js')
  assert.deepEqual([0, 9, 10, 11, 12, 13, 14, 15, 1000000].map(loginDelay), [0, 0, 1, 2, 4, 8, 16, 30, 30])
})
