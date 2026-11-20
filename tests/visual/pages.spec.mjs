// Pages clés comparées à leur rendu sur main (critère de qualité visuel).
// Le front construit est servi par interception, l'API est simulée page par
// page et la date est figée : seul un changement de code modifie un rendu.
import { test, expect } from '@playwright/test'
import { readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const DIST = process.env.VISUAL_DIST || 'dist'
const NOW = new Date('2026-01-15T10:00:00Z')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }
const isFile = (f) => { try { return statSync(f).isFile() } catch { return false } }

const ERREUR = Symbol('erreur')

// Visiteur non connecté ; ajouter par page les réponses dont elle a besoin.
const ANONYME = { 'GET /api/auth/me': { user: null }, 'GET /api/auth/mfa/status': { challenge: null } }
// Parent connecté (coquille à onglets de l'app parent).
const HANTA = { id: '6f1c2b1e-0000-4000-8000-000000000001', email: 'hanta@exemple.fr', name: 'Hanta', is_admin: false }
const PARENT = {
  ...ANONYME,
  'GET /api/auth/me': { user: HANTA },
  'GET /api/families/me': {
    id: '6f1c2b1e-0000-4000-8000-0000000000f1', name: 'Famille Rakoto', role: 'owner',
    members: [{ userId: HANTA.id, name: 'Hanta', role: 'owner', isMe: true }, { userId: '6f1c2b1e-0000-4000-8000-000000000002', name: 'Rivo', role: 'manager', isMe: false }]
  },
  'GET /api/children': [
    { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-01-10T10:00:00Z', parentCodeSetAt: '2026-01-12T10:00:00Z', remoteUnlockUntil: null, phoneLastSeenAt: '2026-01-15T09:58:00Z', sosSiren: false },
    { id: '6f1c2b1e-0000-4000-8000-000000000102', firstName: 'Tiana', avatarColor: 'green', createdAt: '2026-01-11T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false }
  ],
  'GET /api/children/6f1c2b1e-0000-4000-8000-000000000101/contacts': {
    version: 4, max: 6, country: 'MG',
    contacts: [
      { id: '6f1c2b1e-0000-4000-8000-000000000201', childId: '6f1c2b1e-0000-4000-8000-000000000101', name: 'Maman', phone: '+261341234567', position: 1, avatarColor: 'orange', memberUserId: '6f1c2b1e-0000-4000-8000-000000000001', memberRole: 'owner' },
      { id: '6f1c2b1e-0000-4000-8000-000000000202', childId: '6f1c2b1e-0000-4000-8000-000000000101', name: 'Papa', phone: '+261331234567', position: 2, avatarColor: 'blue', memberUserId: '6f1c2b1e-0000-4000-8000-000000000002', memberRole: 'manager' },
      { id: '6f1c2b1e-0000-4000-8000-000000000203', childId: '6f1c2b1e-0000-4000-8000-000000000101', name: 'Mamie', phone: '+261321234567', position: 3, avatarColor: 'violet', memberUserId: null, memberRole: null }
    ]
  },
  // Applications autorisées (NAR-143) : une autorisée, une proposée.
  'GET /api/children/6f1c2b1e-0000-4000-8000-000000000101/apps': {
    max: 4,
    inventory: [{ package: 'com.android.camera2', label: 'Appareil photo', icon: null, allowed: true }, { package: 'com.android.calculator2', label: 'Calculatrice', icon: null, allowed: false }],
    allowed: [{ package: 'com.android.camera2', label: 'Appareil photo', position: 1 }]
  },
  // Plages « école » (NAR-148).
  'GET /api/children/6f1c2b1e-0000-4000-8000-000000000101/schedules': [
    { id: '6f1c2b1e-0000-4000-8000-000000000301', label: 'École', days: 31, startMin: 480, endMin: 960, enabled: true }
  ],
  // Textes des messages rapides (NAR-173) : un modifié.
  'GET /api/children/6f1c2b1e-0000-4000-8000-000000000101/message-templates': [
    { slot: 1, text: null }, { slot: 2, text: 'Viens me chercher à l’école' }, { slot: 3, text: null }, { slot: 4, text: null }
  ],
  // Journal figé (NAR-152) : dates fixes ; l'accueil n'en montre que la journée en cours.
  'GET /api/children/6f1c2b1e-0000-4000-8000-000000000101/journal': {
    items: [
      { id: '6f1c2b1e-0000-4000-8000-000000000301', kind: 'message', at: '2026-01-15T09:05:00Z', slot: 1, readBy: [{ name: 'Maman', readAt: '2026-01-15T09:06:00Z' }], readByMe: true },
      { id: '6f1c2b1e-0000-4000-8000-000000000401', kind: 'call_blocked', at: '2026-01-15T08:40:00Z', contactId: null, name: null, phone: '+261329876543', durationS: null },
      { id: '6f1c2b1e-0000-4000-8000-000000000402', kind: 'call_in', at: '2026-01-15T07:02:00Z', contactId: '6f1c2b1e-0000-4000-8000-000000000201', name: 'Maman', phone: '+261341234567', durationS: 134 },
      { id: '6f1c2b1e-0000-4000-8000-000000000403', kind: 'unlock', at: '2026-01-14T17:30:00Z', source: 'code', durationS: 900 },
      { id: '6f1c2b1e-0000-4000-8000-000000000404', kind: 'call_out', at: '2026-01-13T16:10:00Z', contactId: '6f1c2b1e-0000-4000-8000-000000000202', name: 'Papa', phone: '+261331234567', durationS: 0 }
    ],
    next: null,
    today: { calls: 1, blocked: 1, messages: 1, unlocks: 0 }
  },
  // État du téléphone (NAR-147) : relevé d'il y a 2 minutes, batterie faible signalée.
  'GET /api/children/6f1c2b1e-0000-4000-8000-000000000101/status': {
    devices: [{
      id: '6f1c2b1e-0000-4000-8000-0000000000d1', model: 'Samsung Galaxy A10', batteryPct: 12, charging: false, network: 'mobile', simState: 'ready',
      statusAt: '2026-01-15T09:58:00Z', alerts: [{ kind: 'battery_low', openedAt: '2026-01-15T09:50:00Z' }]
    }]
  },
  'GET /api/children/6f1c2b1e-0000-4000-8000-000000000101/devices': [
    { id: '6f1c2b1e-0000-4000-8000-0000000000d1', model: 'Samsung Galaxy A10', osVersion: '11', appVersion: '1.0', createdAt: '2026-01-12T10:00:00Z', lastSeenAt: '2026-01-14T10:00:00Z' }
  ],
  // Sécurité du compte (« Mon compte », NAR-156).
  'GET /api/auth/security': {
    mfaEnabled: false, recoveryCodesRemaining: 0,
    devices: [{ id: '6f1c2b1e-0000-4000-8000-0000000000e1', label: 'Chrome · macOS', last_used_at: '2026-01-15T09:00:00Z', current: true }]
  },
  'GET /api/auth/app-sessions': [],
  'GET /api/families/me/invitations': [
    { id: '6f1c2b1e-0000-4000-8000-0000000000a1', email: 'mamie@exemple.fr', role: 'member', createdAt: '2026-01-14T10:00:00Z', expiresAt: '2026-01-21T10:00:00Z' }
  ]
}
// Parent connecté sans famille : l'accueil présente la création.
const SANS_FAMILLE = {
  ...ANONYME,
  'GET /api/auth/me': { user: HANTA },
  'GET /api/families/me': { [ERREUR]: true, status: 404, json: { error: 'Famille introuvable.', code: 'no_family' } }
}
// Back-office (NAR-144) : administrateur, statistiques, familles par référence, téléphones.
const ADMIN = {
  ...PARENT,
  'GET /api/auth/me': { user: { ...HANTA, is_admin: true } },
  'GET /api/admin/stats': { families: 12, children: 17, devices: 15, activeDevices: 13, silentDevices: 2, devicesSignal24h: 14, sosThisMonth: 0, sosTracked: false },
  'GET /api/admin/families': {
    items: [
      { id: '6f1c2b1e-0000-4000-8000-0000000000f1', members: 2, children: 2, devices: 1, createdAt: '2026-01-10T10:00:00Z' },
      { id: '9a3d4c5e-0000-4000-8000-0000000000f2', members: 1, children: 1, devices: 1, createdAt: '2026-01-08T10:00:00Z' }
    ],
    next: null
  },
  'GET /api/admin/devices': {
    items: [
      { id: '6f1c2b1e-0000-4000-8000-0000000000d1', familyId: '6f1c2b1e-0000-4000-8000-0000000000f1', model: 'Samsung Galaxy A10', osVersion: '11', appVersion: '1.0', createdAt: '2026-01-12T10:00:00Z', lastSeenAt: '2026-01-15T09:58:00Z', statusAt: '2026-01-15T09:58:00Z', revokedAt: null, state: 'active' },
      { id: '9a3d4c5e-0000-4000-8000-0000000000d2', familyId: '9a3d4c5e-0000-4000-8000-0000000000f2', model: 'Itel A70', osVersion: '13', appVersion: '1.0', createdAt: '2026-01-09T10:00:00Z', lastSeenAt: '2026-01-15T07:00:00Z', statusAt: '2026-01-15T07:00:00Z', revokedAt: null, state: 'silent' }
    ],
    next: null
  },
  'GET /api/admin/users': [{ id: HANTA.id, email: HANTA.email, name: 'Hanta', is_admin: true, created_at: '2026-01-05T10:00:00Z', email_verified_at: '2026-01-05T10:05:00Z', sms_account: false, verified: true, mfa: true }],
  'GET /api/admin/audit': [{ at: '2026-01-15T09:00:00Z', action: 'login', target: null, actor: HANTA.email }]
}
const PAGES = [
  ['accueil', '/', ANONYME],
  ['connexion', '/connexion', ANONYME],
  ['parent-accueil', '/espace', PARENT],
  ['parent-creer-famille', '/espace', SANS_FAMILLE],
  ['parent-famille', '/espace/famille', PARENT],
  ['parent-ajouter-enfant', '/espace/enfant/nouveau', PARENT],
  // Modifier un enfant (NAR-195 : « ‹ Accueil » en tête, sans « Annuler » ni « Configurer le téléphone »).
  ['parent-modifier-enfant', '/espace/enfant/6f1c2b1e-0000-4000-8000-000000000101', PARENT],
  ['parent-reglages', '/espace/reglages', PARENT],
  // Page d'une section de Réglages (NAR-185) ; absente de main (la référence y est l'accueil).
  ['parent-reglages-contacts', '/espace/reglages/contacts', PARENT],
  ['parent-journal', '/espace/journal', PARENT],
  // Ancienne adresse : rendue dans la coquille parent depuis NAR-156, et sur main aussi.
  ['parent-securite', '/securite', PARENT],
  ['parent-telephone', '/espace/enfant/6f1c2b1e-0000-4000-8000-000000000101/telephone', PARENT],
  // Back-office (NAR-144) ; absent de main sous cette forme (référence : l'ancienne page Administration).
  ['admin', '/admin', ADMIN],
  ['invitation-sans-session', '/invitation#invite=' + 'T'.repeat(43), ANONYME]
]

async function serve(page, api) {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://visual.test') return route.abort('blockedbyclient')
    if (url.pathname.startsWith('/api/')) {
      const body = api[`${route.request().method()} ${url.pathname}`]
      if (body === undefined) return route.fulfill({ status: 404, json: { error: 'Introuvable.' } })
      // Réponse d'erreur simulée : { status, json }, marquée par ERREUR.
      if (body?.[ERREUR]) return route.fulfill({ status: body.status, json: body.json })
      return route.fulfill({ json: body })
    }
    const file = join(DIST, decodeURIComponent(url.pathname))
    const target = isFile(file) ? file : join(DIST, 'index.html')
    return route.fulfill({ body: readFileSync(target), contentType: TYPES[extname(target)] || 'application/octet-stream' })
  })
}

// Page parcourue jusqu'en bas (apparitions au défilement, compteurs), puis
// capturée depuis le haut une fois sa hauteur stable sur 5 images.
async function settle(page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState('networkidle')
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
      window.scrollTo(0, y)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    }
    window.scrollTo(0, 0)
  })
  await page.evaluate(() => new Promise((resolve) => {
    let last = -1, same = 0
    const tick = () => { const h = document.documentElement.scrollHeight; same = h === last ? same + 1 : 0; last = h; if (same >= 5) resolve(); else requestAnimationFrame(tick) }
    tick()
  }))
  // Hauteur entière : une hauteur fractionnaire s'arrondit différemment d'un passage à l'autre.
  return page.evaluate(() => ({ x: 0, y: 0, width: innerWidth, height: Math.floor(document.documentElement.getBoundingClientRect().height) - 1 }))
}

for (const [name, path, api] of PAGES) {
  test(`${name} : identique au rendu de main @C91`, async ({ page }) => {
    await page.clock.setFixedTime(NOW)
    await serve(page, api)
    await page.goto(path)
    const clip = await settle(page)
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, clip, mask: [page.locator('video')], timeout: 30000 })
  })
}
