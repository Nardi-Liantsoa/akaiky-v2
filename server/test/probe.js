// Route sonde, enregistrée par les seuls tests (helpers.startApp), jamais par
// l'application : elle porte les garanties génériques du pipeline (fermé par
// défaut, CSRF, Bearer, CORS natif, schéma strict, révocation) sans dépendre
// d'une ressource métier. Chaque ressource métier garde, elle, son propre test
// « A ne touche pas la ressource de B » (ampy-auth).
const BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: { title: { type: 'string', minLength: 1, maxLength: 200 } }
}

// Aucun appel à requireUser : seule la garde globale (« fermé par défaut »,
// app.js) écarte les requêtes sans session. Si elle cassait, ces routes
// répondraient 500 au lieu de 401, et les tests le verraient.
export default async function probeRoutes(app) {
  app.get('/', async (req) => ({ userId: req.user.id }))
  app.post('/', { schema: { body: BODY } }, async (req, reply) =>
    reply.code(201).send({ userId: req.user.id, title: req.body.title }))
}
