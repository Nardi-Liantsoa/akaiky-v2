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

export default async function probeRoutes(app) {
  app.get('/', async (req) => ({ userId: app.requireUser(req).id }))
  app.post('/', { schema: { body: BODY } }, async (req, reply) =>
    reply.code(201).send({ userId: app.requireUser(req).id, title: req.body.title }))
}
