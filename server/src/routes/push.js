// Jetons push (NAR-141, ampy-push « Les jetons d'appareil »). Le propriétaire d'un jeton
// est TOUJOURS la session qui l'envoie : aucun identifiant de compte ni d'appareil n'est
// accepté dans l'URL ou le corps (champ inconnu → 400).
//
// App parent (session de compte, cookie ou Bearer ; préfixe /api) :
//   PUT    /push/token   { token, platform, lang? }  enregistre (ou reprend) le jeton de CETTE session ;
//   DELETE /push/token   { token }                    le retire s'il est à cette session, sinon 404 ;
//   POST   /push/test                                 notification de test vers cette session (5/h).
// Téléphone de l'enfant (session d'appareil ; préfixe /api/device) :
//   PUT    /push/token   { token, platform: 'android', lang? } ;
//   DELETE /push/token   { token }.
import { HttpError, body } from '../lib.js'
import { withTransaction } from '../db.js'
import { createLimiter } from '../security.js'
import { LANGS } from '../push-texts.js'
import { notifySession, registerToken, unregisterToken } from '../push.js'

const TOKEN = /^[\x21-\x7e]{1,4096}$/
const notFound = () => new HttpError(404, 'Jeton introuvable.', 'push_token_not_found')

function tokenOf(b) {
  if (typeof b.token !== 'string' || !TOKEN.test(b.token)) throw new HttpError(400, 'Jeton invalide.', 'invalid_push_token')
  return b.token
}
function registration(req, platforms) {
  const b = body(req, ['token', 'platform', 'lang'])
  const token = tokenOf(b)
  if (!platforms.includes(b.platform)) throw new HttpError(400, 'Plateforme invalide.', 'invalid_platform')
  const lang = b.lang === undefined ? 'mg' : b.lang
  if (!LANGS.includes(lang)) throw new HttpError(400, 'Langue invalide.', 'invalid_lang')
  return { token, platform: b.platform, lang }
}

// Session de compte de la requête (identifiant stable : le renouvellement natif change
// l'empreinte, pas l'identifiant).
async function sessionOf(db, req) {
  if (!req.user || !req.sessionHash) throw new HttpError(401, 'Connexion requise.')
  const { rows: [s] } = await db.query('SELECT id FROM sessions WHERE token_hash = $1', [req.sessionHash])
  if (!s) throw new HttpError(401, 'Connexion requise.')
  return s.id
}

export async function pushRoutes(app) {
  const { db, config } = app
  const testLimit = createLimiter({ max: 5, windowMs: 3_600_000 })

  app.put('/push/token', async (req) => {
    const input = registration(req, ['android', 'ios'])
    const sessionId = await sessionOf(db, req)
    await withTransaction(db, (conn) => registerToken(conn, config, { sessionId }, input))
    return { ok: true }
  })

  app.delete('/push/token', async (req) => {
    const token = tokenOf(body(req, ['token']))
    const sessionId = await sessionOf(db, req)
    if (!await unregisterToken(db, config, { sessionId }, token)) throw notFound()
    return { ok: true }
  })

  app.post('/push/test', async (req) => {
    const sessionId = await sessionOf(db, req)
    if (!testLimit(`push-test:${req.user.id}`)) throw new HttpError(429, 'Trop de notifications de test. Réessayez plus tard.')
    const { queued } = await notifySession(db, sessionId, 'test')
    return { queued }
  })
}

export async function devicePushRoutes(app) {
  const { db, config } = app

  app.put('/push/token', { config: { device: true } }, async (req) => {
    const input = registration(req, ['android'])
    const owner = { deviceId: req.device.id, familyId: req.device.familyId }
    await withTransaction(db, async (conn) => {
      // Révocation simultanée (qui efface les jetons du téléphone) : attendue, puis refusée.
      const { rowCount } = await conn.query('SELECT 1 FROM child_devices WHERE id = $1 AND revoked_at IS NULL FOR SHARE', [owner.deviceId])
      if (!rowCount) throw new HttpError(401, 'Session de l’appareil expirée.')
      await registerToken(conn, config, owner, input)
    })
    return { ok: true }
  })

  app.delete('/push/token', { config: { device: true } }, async (req) => {
    const token = tokenOf(body(req, ['token']))
    if (!await unregisterToken(db, config, { deviceId: req.device.id }, token)) throw notFound()
    return { ok: true }
  })
}
