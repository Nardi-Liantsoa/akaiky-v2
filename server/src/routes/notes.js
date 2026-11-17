// Ressource d'exemple : des notes privées. Elle montre la forme attendue de
// toute ressource métier (ampy-auth, « Une ressource d'un autre n'existe pas ») :
//   - le propriétaire est l'utilisateur de la session, jamais un champ envoyé ;
//   - chaque lecture et écriture filtre sur le propriétaire DANS la requête SQL ;
//   - la ressource d'un autre répond 404, comme une ressource inexistante ;
//   - le corps est validé par un schéma qui refuse les champs inconnus ;
//   - ce qui repart au navigateur est construit champ par champ.
// À remplacer par les ressources du projet, en gardant ces cinq propriétés et
// le test « A ne touche pas la ressource de B » (test/notes.test.js).
import { HttpError, isUuid, audit } from '../lib.js'

const NOTE = {
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    body: { type: 'string', maxLength: 20000 }
  }
}
const serialize = (r) => ({ id: r.id, title: r.title, body: r.body, created_at: r.created_at, updated_at: r.updated_at })
const clean = (s) => String(s ?? '').replace(/\u0000/g, '').trim()

export default async function notesRoutes(app) {
  const { db, config } = app
  const notFound = () => new HttpError(404, 'Note introuvable.')
  const id = (req) => { if (!isUuid(req.params.id)) throw notFound(); return req.params.id }

  app.get('/', async (req) => {
    const user = app.requireUser(req)
    const { rows } = await db.query(
      'SELECT id, title, body, created_at, updated_at FROM notes WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 100', [user.id])
    return rows.map(serialize)
  })

  app.post('/', { schema: { body: NOTE } }, async (req, reply) => {
    const user = app.requireUser(req)
    const title = clean(req.body.title)
    if (!title) throw new HttpError(400, 'Titre requis.')
    const conn = await db.connect()
    try {
      await conn.query('BEGIN')
      // Quota par compte, sous verrou : deux créations simultanées ne le dépassent pas.
      await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`notes:${user.id}`])
      const { rows: [{ n }] } = await conn.query('SELECT count(*)::int AS n FROM notes WHERE owner_id = $1', [user.id])
      if (n >= config.quotas.notesPerUser) throw new HttpError(409, 'Nombre maximal de notes atteint.')
      const { rows } = await conn.query(
        'INSERT INTO notes(owner_id, title, body) VALUES ($1, $2, $3) RETURNING *', [user.id, title, clean(req.body.body)])
      await conn.query('COMMIT')
      return reply.code(201).send(serialize(rows[0]))
    } catch (e) { await conn.query('ROLLBACK'); throw e } finally { conn.release() }
  })

  app.get('/:id', async (req) => {
    const user = app.requireUser(req)
    const { rows } = await db.query('SELECT * FROM notes WHERE id = $1 AND owner_id = $2', [id(req), user.id])
    if (!rows[0]) throw notFound()
    return serialize(rows[0])
  })

  app.put('/:id', { schema: { body: NOTE } }, async (req) => {
    const user = app.requireUser(req)
    const title = clean(req.body.title)
    if (!title) throw new HttpError(400, 'Titre requis.')
    const { rows } = await db.query(
      `UPDATE notes SET title = $3, body = $4, updated_at = now() WHERE id = $1 AND owner_id = $2 RETURNING *`,
      [id(req), user.id, title, clean(req.body.body)])
    if (!rows[0]) throw notFound()
    return serialize(rows[0])
  })

  app.delete('/:id', async (req) => {
    const user = app.requireUser(req)
    const { rowCount } = await db.query('DELETE FROM notes WHERE id = $1 AND owner_id = $2', [id(req), user.id])
    if (!rowCount) throw notFound()
    await audit(db, req, 'note_deleted', req.params.id)
    return { ok: true }
  })
}
