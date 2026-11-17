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

// Visiteur non connecté ; ajouter par page les réponses dont elle a besoin.
const ANONYME = { 'GET /api/auth/me': { user: null }, 'GET /api/auth/mfa/status': { challenge: null } }
// Parent connecté (coquille à onglets de l'app parent).
const PARENT = { ...ANONYME, 'GET /api/auth/me': { user: { id: '6f1c2b1e-0000-4000-8000-000000000001', email: 'hanta@exemple.fr', name: 'Hanta', is_admin: false } } }
const PAGES = [
  ['accueil', '/', ANONYME],
  ['connexion', '/connexion', ANONYME],
  ['parent-accueil', '/espace', PARENT]
]

async function serve(page, api) {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://visual.test') return route.abort('blockedbyclient')
    if (url.pathname.startsWith('/api/')) {
      const body = api[`${route.request().method()} ${url.pathname}`]
      return route.fulfill(body === undefined ? { status: 404, json: { error: 'Introuvable.' } } : { json: body })
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
