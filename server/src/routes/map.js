// Fond de carte auto-hébergé (NAR-205, ampy-carte) : un extrait OpenStreetMap de Madagascar au
// format PMTiles (Protomaps), lu par morceaux (en-tête Range) par MapLibre dans l'app, et les
// polices des noms de lieux. Aucun service tiers ne voit quelle zone est affichée, donc aucune
// position d'enfant : toutes les requêtes de la carte arrivent ici.
//
//   GET /api/map/tiles.pmtiles             fichier MAP_TILES_FILE (volume, hors image et hors base),
//                                          un seul intervalle d'octets par requête (206), sinon le
//                                          fichier entier (200) ; ETag = taille + date du fichier.
//   GET /api/map/fonts/:stack/:range.pbf   polices de server/map/fonts (Noto Sans, OFL), liste fermée ;
//                                          noms sans espace (noto-sans-regular) : un chemin d'API encodé
//                                          (%20) est refusé, l'app réécrit le nom de la police.
//
// Publiques (données OpenStreetMap, rien de propre à une famille), lecture seule, hors session ;
// limite propre par adresse IP (une vue de carte lit des dizaines de morceaux), hors de la
// limite globale de l'API. Mises en cache par le téléphone (une journée, revalidées par ETag).
// Pas de fichier configuré : 404, l'app montre la position en texte.
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createLimiter, rateLimitKey } from '../security.js'

export const MAP_PER_MINUTE = 1200
const FONTS_DIR = new URL('../../map/fonts', import.meta.url).pathname
const RANGE = /^bytes=(\d+)-(\d*)$/
const FONT_RANGE = /^\d+-\d+\.pbf$/
export const MAP_CACHE = 'private, max-age=86400'

async function loadFonts() {
  const fonts = new Map()
  for (const stack of await readdir(FONTS_DIR).catch(() => [])) {
    for (const file of await readdir(join(FONTS_DIR, stack)).catch(() => [])) {
      if (FONT_RANGE.test(file)) fonts.set(`${stack}/${file}`, await readFile(join(FONTS_DIR, stack, file)))
    }
  }
  return fonts
}

export async function mapRoutes(app) {
  const { config } = app
  const limit = createLimiter({ max: MAP_PER_MINUTE, windowMs: 60_000 })
  const fonts = await loadFonts()
  const open = { config: { public: true, mapAsset: true } }
  const guard = (req, reply) => {
    if (limit(rateLimitKey(req.ip))) return true
    reply.code(429).header('retry-after', '60').send({ error: 'Trop de requêtes. Réessayez dans une minute.' })
    return false
  }

  app.get('/map/tiles.pmtiles', open, async (req, reply) => {
    if (!guard(req, reply)) return reply
    const file = config.mapTilesFile
    const info = file ? await stat(file).catch(() => null) : null
    if (!info?.isFile()) return reply.code(404).send({ error: 'Carte indisponible.', code: 'map_unavailable' })
    const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`
    reply.header('etag', etag).header('accept-ranges', 'bytes').header('cache-control', MAP_CACHE)
    const bytes = 'application/octet-stream'
    const range = req.headers.range
    if (!range) {
      if (req.headers['if-none-match'] === etag) return reply.code(304).send()
      return reply.type(bytes).header('content-length', info.size).send(createReadStream(file))
    }
    const m = RANGE.exec(range)
    const start = m ? Number(m[1]) : NaN
    const end = m ? (m[2] === '' ? info.size - 1 : Math.min(Number(m[2]), info.size - 1)) : NaN
    if (!m || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
      return reply.code(416).header('content-range', `bytes */${info.size}`).type('application/json').send({ error: 'Intervalle invalide.' })
    }
    return reply.code(206).type(bytes)
      .header('content-range', `bytes ${start}-${end}/${info.size}`)
      .header('content-length', end - start + 1)
      .send(createReadStream(file, { start, end }))
  })

  app.get('/map/fonts/:stack/:range', open, async (req, reply) => {
    if (!guard(req, reply)) return reply
    const body = fonts.get(`${req.params.stack}/${req.params.range}`)
    // Plage absente (écriture non latine) : 404, MapLibre affiche le reste.
    if (!body) return reply.code(404).send({ error: 'Introuvable.' })
    return reply.type('application/x-protobuf').header('cache-control', MAP_CACHE).send(body)
  })
}
