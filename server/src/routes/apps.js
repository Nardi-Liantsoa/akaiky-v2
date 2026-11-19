// Applications autorisées sur le téléphone de l'enfant (NAR-143).
//   PUT /api/device/apps                téléphone : inventaire de SES applications lançables,
//                                       remplacé en entier (150 au plus, 6 envois par heure) ;
//   GET /api/children/:id/apps          membres : inventaire des téléphones actifs de l'enfant
//                                       (sans doublon) et liste autorisée, ordonnée (une
//                                       autorisée devenue protégée marquée `blocked: true`) ;
//   PUT /api/children/:id/allowed-apps  owner, manager : liste ordonnée de 4 paquets au plus,
//                                       tous dans l'inventaire de cet enfant, jamais un paquet
//                                       protégé (l'app elle-même, appels, SMS, système,
//                                       réglages, lanceurs, navigateurs : bloqués en v1), ni un
//                                       paquet marqué `browser` par un téléphone de l'enfant ;
//                                       refus nommant le paquet en cause (`package`).
// Le téléphone reçoit la liste dans `allowedApps` de /api/device/config (devices.js) ; il
// cache les autres applications et n'ouvre que celles-là dans le lock task.
import { readFileSync } from 'node:fs'
import { HttpError, audit, isUuid } from '../lib.js'
import { withTransaction } from '../db.js'
import { MANAGERS, ROLES, lockOwnFamily, requireOwnFamily } from '../families.js'
import { createLimiter } from '../security.js'
import { openField, sealField } from '../crypto-fields.js'

export const MAX_ALLOWED_APPS = 4
export const MAX_INVENTORY = 150
export const INVENTORY_PER_HOUR = 6
const ICON_BYTES = 4096
export const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// Liste partagée avec le natif (AppsPolicy.kt, comparée par son test JVM).
const lists = JSON.parse(readFileSync(new URL('../protected-apps.json', import.meta.url), 'utf8'))
const PROTECTED = new Set([...lists.neverHide, ...lists.browsers])
export const isProtectedApp = (pkg) => PROTECTED.has(pkg) || lists.prefixes.some((p) => pkg === p || pkg.startsWith(`${p}.`))

export const inventoryAad = (deviceId, pkg) => `device_apps:label:${deviceId}:${pkg}`
export const allowedAppAad = (childId, pkg) => `allowed_apps:label:${childId}:${pkg}`

const childNotFound = () => new HttpError(404, 'Enfant introuvable.', 'child_not_found')
const invalidInventory = () => new HttpError(400, 'Liste d’applications invalide.', 'invalid_inventory')
const invalidAllowed = () => new HttpError(400, 'Liste d’applications autorisées invalide.', 'invalid_allowed_apps')

// Base64 strict (réencodage identique) puis signature PNG.
function iconOf(v) {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string' || v.length > Math.ceil(ICON_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(v)) throw invalidInventory()
  const b = Buffer.from(v, 'base64')
  if (b.toString('base64') !== v || b.length > ICON_BYTES || b.length < PNG.length || !b.subarray(0, PNG.length).equals(PNG)) throw invalidInventory()
  return b
}

// Nom affiché : sans caractère de contrôle, 1 à 80 caractères (points de code).
function labelOf(v) {
  if (typeof v !== 'string') throw invalidInventory()
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()
  const n = [...s].length
  if (n < 1 || n > 80) throw invalidInventory()
  return s
}

const APP_KEYS = new Set(['package', 'label', 'icon', 'browser'])
function parseInventory(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).join() !== 'apps' || !Array.isArray(body.apps)) throw invalidInventory()
  if (body.apps.length > MAX_INVENTORY) throw new HttpError(400, `${MAX_INVENTORY} applications au plus.`, 'too_many_apps')
  const seen = new Set()
  return body.apps.map((a) => {
    // Champ inconnu (durée d'usage, dernière ouverture…) : refusé, jamais ignoré.
    if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).some((k) => !APP_KEYS.has(k))) throw invalidInventory()
    if (typeof a.package !== 'string' || a.package.length > 200 || !PACKAGE_RE.test(a.package) || seen.has(a.package)) throw invalidInventory()
    // Navigateur vu par le téléphone : booléen seulement, absent = non.
    if (a.browser !== undefined && typeof a.browser !== 'boolean') throw invalidInventory()
    seen.add(a.package)
    return { package: a.package, label: labelOf(a.label), icon: iconOf(a.icon), browser: a.browser === true }
  })
}

export async function appsRoutes(app) {
  const { db, config } = app
  const key = config.dataKey

  // Paquets marqués navigateur par au moins un téléphone non révoqué de l'enfant.
  async function browsersOf(conn, familyId, childId) {
    const { rows } = await conn.query(
      `SELECT DISTINCT a.package
         FROM device_apps a JOIN child_devices d ON d.id = a.device_id AND d.family_id = a.family_id
        WHERE d.child_id = $1 AND d.family_id = $2 AND d.revoked_at IS NULL AND a.browser`, [childId, familyId])
    return new Set(rows.map((r) => r.package))
  }

  // Inventaire de l'enfant : téléphones non révoqués, un paquet une fois (le relevé le plus
  // récent gagne), sans paquet protégé ni navigateur marqué par l'un de ses téléphones.
  async function inventory(conn, familyId, childId) {
    const browsers = await browsersOf(conn, familyId, childId)
    const { rows } = await conn.query(
      `SELECT DISTINCT ON (a.package) a.device_id, a.package, a.label_enc, a.icon
         FROM device_apps a JOIN child_devices d ON d.id = a.device_id AND d.family_id = a.family_id
        WHERE d.child_id = $1 AND d.family_id = $2 AND d.revoked_at IS NULL
        ORDER BY a.package, a.updated_at DESC, a.device_id`, [childId, familyId])
    return rows.filter((r) => !isProtectedApp(r.package) && !browsers.has(r.package)).map((r) => ({
      package: r.package,
      label: openField(r.label_enc, key, inventoryAad(r.device_id, r.package)),
      icon: r.icon ? r.icon.toString('base64') : null
    }))
  }
  const allowedOf = async (conn, familyId, childId) => (await conn.query(
    'SELECT package, label_enc, position FROM allowed_apps WHERE child_id = $1 AND family_id = $2 ORDER BY position', [childId, familyId]
  )).rows.map((r) => ({ package: r.package, label: openField(r.label_enc, key, allowedAppAad(childId, r.package)), position: r.position }))

  app.get('/children/:id/apps', async (req) => {
    const own = await requireOwnFamily(db, req, ROLES)
    if (!isUuid(req.params.id)) throw childNotFound()
    return withTransaction(db, async (conn) => {
      await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
      const { rows: [child] } = await conn.query('SELECT id FROM children WHERE id = $1 AND family_id = $2', [req.params.id, own.familyId])
      if (!child) throw childNotFound()
      // Autorisée puis devenue protégée (liste fixe mise à jour, navigateur reconnu depuis) :
      // marquée `blocked`, montrée « bloquée » au parent, qui peut la retirer.
      const browsers = await browsersOf(conn, own.familyId, child.id)
      const allowed = (await allowedOf(conn, own.familyId, child.id))
        .map((a) => (isProtectedApp(a.package) || browsers.has(a.package) ? { ...a, blocked: true } : a))
      const chosen = new Set(allowed.map((a) => a.package))
      const apps = (await inventory(conn, own.familyId, child.id))
        .map((a) => ({ ...a, allowed: chosen.has(a.package) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'fr') || a.package.localeCompare(b.package))
      return { max: MAX_ALLOWED_APPS, inventory: apps, allowed }
    })
  })

  // Droits vérifiés AVANT le corps : un contact (member) reçoit 403 quoi qu'il envoie.
  app.put('/children/:id/allowed-apps', async (req) => {
    return withTransaction(db, async (conn) => {
      const own = await lockOwnFamily(conn, req, MANAGERS)
      if (!isUuid(req.params.id)) throw childNotFound()
      // Enfant verrouillé : deux enregistrements simultanés se suivent.
      const { rows: [child] } = await conn.query('SELECT id FROM children WHERE id = $1 AND family_id = $2 FOR UPDATE', [req.params.id, own.familyId])
      if (!child) throw childNotFound()
      const b = req.body
      if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).join() !== 'packages' || !Array.isArray(b.packages)) throw invalidAllowed()
      const packages = b.packages
      if (packages.some((p) => typeof p !== 'string' || p.length > 200 || !PACKAGE_RE.test(p)) || new Set(packages).size !== packages.length) throw invalidAllowed()
      if (packages.length > MAX_ALLOWED_APPS) throw new HttpError(400, `${MAX_ALLOWED_APPS} applications au plus.`, 'too_many_allowed_apps')
      // Le paquet refusé est nommé (`package`) : le parent sait laquelle retirer.
      const browsers = await browsersOf(conn, own.familyId, child.id)
      const refused = packages.find((p) => isProtectedApp(p) || browsers.has(p))
      if (refused) throw new HttpError(400, 'Cette application ne peut pas être autorisée.', 'protected_app', { package: refused })
      const installed = new Map((await inventory(conn, own.familyId, child.id)).map((a) => [a.package, a]))
      const missing = packages.find((p) => !installed.has(p))
      if (missing) throw new HttpError(400, 'Cette application n’est pas sur le téléphone de l’enfant.', 'app_not_installed', { package: missing })

      const current = await allowedOf(conn, own.familyId, child.id)
      // Même liste, même ordre : ni écriture, ni audit, ni nouvelle version de la configuration.
      if (current.map((a) => a.package).join() !== packages.join()) {
        await conn.query('DELETE FROM allowed_apps WHERE child_id = $1 AND family_id = $2', [child.id, own.familyId])
        for (const [i, p] of packages.entries()) {
          await conn.query(
            'INSERT INTO allowed_apps(family_id, child_id, package, label_enc, position) VALUES ($1, $2, $3, $4, $5)',
            [own.familyId, child.id, p, sealField(installed.get(p).label, key, allowedAppAad(child.id, p)), i + 1])
        }
        // Le nombre seulement : les noms des applications d'un mineur ne vont pas au journal d'audit.
        await audit(conn, req, 'allowed_apps_set', child.id, { count: packages.length })
      }
      return { max: MAX_ALLOWED_APPS, allowed: await allowedOf(conn, own.familyId, child.id) }
    })
  })
}

// Routes du téléphone (préfixe /api/device).
export async function deviceAppsRoutes(app) {
  const { db, config } = app
  const perDevice = createLimiter({ max: INVENTORY_PER_HOUR, windowMs: 60 * 60 * 1000 })

  // 150 applications × icône de 4 Ko en base64 : corps élargi à 1 Mo pour cette route seule.
  app.put('/apps', { config: { device: true }, bodyLimit: 1024 * 1024 }, async (req) => {
    // Validé d'abord (corps borné, téléphone authentifié) : seul un envoi valable compte.
    const apps = parseInventory(req.body)
    if (!perDevice(`device:${req.device.id}`)) throw new HttpError(429, 'Trop d’envois. Réessayez plus tard.')
    await withTransaction(db, async (conn) => {
      await conn.query('DELETE FROM device_apps WHERE device_id = $1', [req.device.id])
      for (const a of apps) {
        await conn.query(
          'INSERT INTO device_apps(device_id, family_id, package, label_enc, icon, browser) VALUES ($1, $2, $3, $4, $5, $6)',
          [req.device.id, req.device.familyId, a.package, sealField(a.label, config.dataKey, inventoryAad(req.device.id, a.package)), a.icon, a.browser])
      }
    })
    return { count: apps.length }
  })
}
