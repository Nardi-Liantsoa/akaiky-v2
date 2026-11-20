// Publication d'un bundle OTA (NAR-189). Commande administrative, lancée à la main avec le
// compte PROPRIÉTAIRE de la base (comme bin/migrate.js) : l'application n'a que SELECT sur
// ota_bundles. Jamais appelée par l'app, la CI ni un script npm.
//
//   DATABASE_URL=<propriétaire> node server/bin/ota-publish.js \
//     --app parent --channel parent --min-native 3 --version 1.0.0-ota.1 bundle.zip
//
// Une publication par app ET par canal (docs/MOBILE.md « Publier un OTA ») : le même zip est
// publié pour parent puis pour enfant, chacun avec la coque minimale de SON échelle versionCode.
import { parseArgs } from 'node:util'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { createPool } from '../src/db.js'
import { publishProblem } from '../src/ota.js'

const MAX_BYTES = 10 * 1024 * 1024
const USAGE = 'Usage : node server/bin/ota-publish.js --app <parent|enfant> --channel <canal> --min-native <versionCode> --version <version> <bundle.zip>'

function fail(message) {
  console.error(`Refusé : ${message}\n${USAGE}`)
  process.exit(2)
}

// Noms des fichiers du zip, lus dans son répertoire central : le greffon attend index.html à
// la racine ; un chemin absolu ou remontant (« .. ») est refusé.
function zipEntries(buf) {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) return null
  // Fin de répertoire central : la signature dont la longueur de commentaire mène pile à la fin
  // du fichier (une signature recopiée dans le commentaire ne compte pas).
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) { eocd = i; break }
  }
  if (eocd < 0) return null
  // Une seule archive (ni multi-volume ni ZIP64), répertoire central entier avant sa fin.
  const count = buf.readUInt16LE(eocd + 10), size = buf.readUInt32LE(eocd + 12)
  let at = buf.readUInt32LE(eocd + 16)
  if (buf.readUInt16LE(eocd + 4) !== 0 || buf.readUInt16LE(eocd + 6) !== 0 || buf.readUInt16LE(eocd + 8) !== count) return null
  if (count === 0 || at + size !== eocd) return null
  const names = []
  for (let n = 0; n < count; n++) {
    if (at + 46 > eocd || buf.readUInt32LE(at) !== 0x02014b50) return null
    const nameLength = buf.readUInt16LE(at + 28), extra = buf.readUInt16LE(at + 30), comment = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    if (at + 46 + nameLength + extra + comment > eocd) return null
    // Chaque entrée renvoie à un en-tête local, placé avant le répertoire central.
    if (local + 30 > eocd - size || buf.readUInt32LE(local) !== 0x04034b50) return null
    names.push(buf.toString('utf8', at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extra + comment
  }
  // Le répertoire central doit être entièrement lu par ses entrées, ni plus ni moins.
  return at === eocd ? names : null
}

let args
try {
  args = parseArgs({
    strict: true,
    allowPositionals: true,
    options: { app: { type: 'string' }, channel: { type: 'string' }, 'min-native': { type: 'string' }, version: { type: 'string' } }
  })
} catch (e) { fail(e.message) }
const { values, positionals } = args
for (const flag of ['app', 'channel', 'min-native', 'version']) if (values[flag] === undefined) fail(`--${flag} manquant`)
if (positionals.length !== 1) fail('un seul fichier zip attendu')
const minRaw = values['min-native']
const target = { app: values.app, channel: values.channel, minNativeBuild: /^\d{1,10}$/.test(minRaw) ? Number(minRaw) : NaN, version: values.version }
const problem = publishProblem(target)
if (problem) fail(problem)

const file = positionals[0]
const info = await stat(file).catch(() => null)
if (!info?.isFile()) fail(`${file} : fichier introuvable`)
if (info.size > MAX_BYTES) fail(`${file} : ${info.size} octets, 10 Mo au plus`)
const bundle = await readFile(file)
const names = zipEntries(bundle)
if (!names) fail(`${file} : pas une archive zip lisible`)
if (!names.includes('index.html')) fail(`${file} : index.html absent de la racine du zip (zipper le contenu de dist/web, pas le dossier)`)
if (names.some((n) => n.startsWith('/') || n.includes('\\') || n.split('/').includes('..'))) fail(`${file} : chemin absolu ou remontant dans le zip`)
// Deux entrées du même nom : le contenu installé dépendrait du décompresseur.
if (new Set(names).size !== names.length) fail(`${file} : entrée en double dans le zip`)
const sha256 = createHash('sha256').update(bundle).digest('hex')

if (!process.env.DATABASE_URL) fail('DATABASE_URL (compte propriétaire) requis')
const pool = createPool(process.env.DATABASE_URL)
try {
  const { rows: [row] } = await pool.query(
    `INSERT INTO ota_bundles(app, channel, version, min_native_build, bundle, sha256)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
    [target.app, target.channel, target.version, target.minNativeBuild, bundle, sha256])
  console.log(`Publié : ${target.app} / ${target.channel} / ${target.version} (coque ≥ ${target.minNativeBuild})`)
  console.log(`id ${row.id}, ${bundle.length} octets, sha256 ${sha256}`)
} catch (e) {
  if (e.code === '23505') fail(`version ${target.version} déjà publiée pour ${target.app} / ${target.channel}`)
  if (e.code === '23514') fail(`la base refuse cette cible (${e.constraint})`)
  console.error(`Échec de la publication : ${e.message}`)
  process.exitCode = 1
} finally { await pool.end() }
