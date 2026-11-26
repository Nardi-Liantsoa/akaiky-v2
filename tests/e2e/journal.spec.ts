import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false }
// Heure figée à midi à Antananarivo : groupes par jour indépendants de l'heure d'exécution.
const NOW = new Date('2026-11-18T09:00:00Z')
const now = NOW.getTime()
const ago = (h: number) => new Date(now - h * 3_600_000).toISOString()
const ITEMS = [
  { id: '6f1c2b1e-0000-4000-8000-000000000401', kind: 'call_blocked', at: ago(0.1), contactId: null, name: null, phone: '+261329876543', durationS: null },
  { id: '6f1c2b1e-0000-4000-8000-000000000402', kind: 'call_blocked', at: ago(0.2), contactId: null, name: null, phone: null, durationS: null },
  { id: '6f1c2b1e-0000-4000-8000-000000000403', kind: 'call_in', at: ago(1), contactId: 'c1', name: 'Maman', phone: '+261341234567', durationS: 134 }
]
// Événement d'hier : renvoyé par le serveur quand aucun jour n'est demandé (accueil), jamais dans
// « Aujourd'hui » (NAR-244).
const YESTERDAY = { id: '6f1c2b1e-0000-4000-8000-000000000408', kind: 'call_in', at: ago(26), contactId: 'c1', name: 'Mamie', phone: '+261341234568', durationS: 20 }
// Jour d'un événement à Madagascar (UTC+3), comme le serveur pour ?day= (NAR-233).
const dayOf = (iso: string) => new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10)

function journalApi(role = 'owner') {
  const queries: string[] = []
  const days: string[] = []
  return {
    queries,
    days,
    handlers: {
      ...me,
      'GET /api/families/me': () => ({ body: { ...FAMILY, role } }),
      'GET /api/children': () => ({ body: [FY] }),
      [`GET /api/children/${FY.id}/contacts`]: () => ({ body: { version: 1, max: 6, country: 'MG', contacts: [] } }),
      [`GET /api/children/${FY.id}/journal`]: (req: { url(): string }) => {
        const kind = new URL(req.url()).searchParams.get('kind')
        const day = new URL(req.url()).searchParams.get('day')
        queries.push(kind ?? '')
        days.push(day ?? '')
        const wanted = day === 'today' ? dayOf(NOW.toISOString()) : day
        const kept = [...ITEMS, YESTERDAY].filter((i) => (wanted ? dayOf(i.at) === wanted : true))
        const items = kind === 'blocked' ? kept.filter((i) => i.kind === 'call_blocked') : kind === 'calls' ? kept.filter((i) => i.kind === 'call_in') : kept
        const counts = new URL(req.url()).searchParams.get('counts') === '1'
        return { body: { items, next: null, ...(counts ? { today: { calls: 0, blocked: 2, messages: 0, unlocks: 0 } } : {}) } }
      }
    }
  }
}

test('journal : groupé par jour, compteur « Bloqués », filtres, « Autoriser » pré-remplit le contact', async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  const api = journalApi()
  await mockApi(page, api.handlers)
  await page.goto('/espace/journal')
  // Un seul jour (NAR-233) : aujourd'hui à l'ouverture, nommé par le sélecteur et la liste.
  await expect(page.getByRole('button', { name: 'Choisir le jour, Aujourd’hui' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Aujourd’hui' })).toBeVisible()
  // Aujourd'hui : « today », décidé par le serveur (horloge du téléphone jamais crue) ; hier n'y est
  // jamais (NAR-244).
  expect(api.days.every((d) => d === 'today')).toBe(true)
  await expect(page.getByText('Appel de Mamie')).toHaveCount(0)
  await expect(page.getByText('numéro masqué · n’a pas sonné')).toBeVisible()
  await expect(page.getByText('Appel de Maman')).toBeVisible()
  await expect(page.getByText('2 min 14 s')).toBeVisible()

  // Tuiles du jour (NAR-175) : toucher « Bloqués » filtre, le retoucher revient à « Tout ».
  const blockedTile = page.getByRole('button', { name: /^2 Bloqués$/ })
  await expect(blockedTile).toBeVisible()
  // Information toujours visible (NAR-235) : comment filtrer, puis comment tout réafficher.
  await expect(page.getByText('Touchez une case pour filtrer le journal.')).toBeVisible()
  await blockedTile.click()
  await expect(blockedTile).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Touchez à nouveau la case pour tout afficher.')).toBeVisible()
  await expect(page.getByText('Appel de Maman')).toHaveCount(0)
  expect(api.queries).toContain('blocked')
  // Nombres gardés après le filtre (pas redemandés), filtre actif annoncé.
  await expect(blockedTile).toHaveText(/^2/)
  // Annoncé aux lecteurs d'écran seulement (NAR-243) : ni « Filtre : » ni « Tout afficher » à l'écran.
  await expect(page.getByRole('status').filter({ hasText: 'Filtre : Bloqués' })).toHaveClass(/visually-hidden/)
  await expect(page.getByRole('button', { name: 'Tout afficher' })).toHaveCount(0)
  await blockedTile.click()
  await expect(blockedTile).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText('Appel de Maman')).toBeVisible()
  await blockedTile.click()
  await expect(page.getByText('Appel de Maman')).toHaveCount(0)

  // Un seul « Autoriser » : le numéro masqué ne peut pas devenir un contact.
  await expect(page.getByRole('link', { name: 'Autoriser ce numéro' })).toHaveCount(1)
  await page.getByRole('link', { name: 'Autoriser ce numéro' }).click()
  await expect(page).toHaveURL(new RegExp(`/contact/nouveau\\?phone=%2B261329876543$`))
  await expect(page.getByLabel('Numéro de téléphone')).toHaveValue('+261 32 98 765 43')
})

test('journal : un contact (member) ne voit pas « Autoriser »', async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  await mockApi(page, journalApi('member').handlers)
  await page.goto('/espace/journal')
  await expect(page.getByText('numéro masqué · n’a pas sonné')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Autoriser ce numéro' })).toHaveCount(0)
})

test('tuiles : rien de coupé sur un petit écran (320 px)', async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  await page.setViewportSize({ width: 320, height: 700 })
  await mockApi(page, journalApi().handlers)
  await page.goto('/espace/journal')
  for (const label of ['Appels', 'Bloqués', 'Messages', 'Sorties du verrou']) {
    const tile = page.getByRole('button', { name: new RegExp(`${label}$`) })
    await expect(tile).toBeVisible()
    const box = await tile.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(320)
  }
  const allow = await page.getByRole('link', { name: 'Autoriser ce numéro' }).boundingBox()
  expect(allow!.x + allow!.width).toBeLessThanOrEqual(320)
  // Aucun défilement horizontal de la page.
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth)).toBe(true)
})

// NAR-231 : à 360 px (et 320), le numéro d'un appel bloqué tient sur une ligne ; « Autoriser ce numéro »
// passe dessous, sur toute la largeur.
for (const width of [360, 320]) {
  test(`appel bloqué à ${width} px : numéro sur une seule ligne, « Autoriser » dessous`, async ({ page }) => {
    await page.clock.setFixedTime(NOW)
    await page.setViewportSize({ width, height: 800 })
    await mockApi(page, journalApi().handlers)
    await page.goto('/espace/journal')
    const number = page.locator('.item .number', { hasText: '+261 32 98 765 43' })
    await expect(number).toBeVisible()
    const lineHeight = await number.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
    expect((await number.boundingBox())!.height).toBeLessThan(lineHeight * 1.5)
    // Séparateur dans le texte (copier-coller), numéro jamais sur l'heure.
    await expect(number.locator('..')).toHaveText('+261 32 98 765 43 · n’a pas sonné')
    const nb = (await number.boundingBox())!
    const time = (await number.locator('xpath=ancestor::li[1]').locator('time').boundingBox())!
    // Le numéro ne passe jamais sous l'heure (qui est au-dessus, à hauteur du titre) ni hors de la carte.
    expect(nb.y >= time.y + time.height || nb.x + nb.width <= time.x).toBe(true)
    expect(nb.x + nb.width).toBeLessThanOrEqual(width - 16)
    const allow = await page.getByRole('link', { name: 'Autoriser ce numéro' }).boundingBox()
    expect(allow!.y).toBeGreaterThan((await number.boundingBox())!.y)
    expect(allow!.height).toBeGreaterThanOrEqual(48)
  })
}

test('contact bloqué pendant une plage « école » (NAR-176) : nommé, sans « Autoriser ce numéro »', async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  const item = { id: '6f1c2b1e-0000-4000-8000-000000000409', kind: 'call_blocked', at: ago(0.1), contactId: '6f1c2b1e-0000-4000-8000-000000000203', name: 'Mamie', phone: '+261321234567', durationS: null }
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] }),
    [`GET /api/children/${FY.id}/journal`]: () => ({ body: { items: [item], next: null, today: { calls: 0, blocked: 1, messages: 0, unlocks: 0 } } })
  })
  await page.goto('/espace/journal')
  await expect(page.getByText('Appel de Mamie bloqué')).toBeVisible()
  await expect(page.getByText('pendant une plage horaire · n’a pas sonné')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Autoriser ce numéro' })).toHaveCount(0)
})

test('appel laissé passer par la fenêtre des secours (NAR-196) : marqué, numéro masqué nommé, sans « Autoriser »', async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  const items = [
    { id: '6f1c2b1e-0000-4000-8000-000000000410', kind: 'call_in', at: ago(0.1), contactId: null, name: null, phone: '+261329876543', durationS: 95, emergencyWindow: true },
    { id: '6f1c2b1e-0000-4000-8000-000000000411', kind: 'call_in', at: ago(0.2), contactId: null, name: null, phone: null, durationS: null, emergencyWindow: true }
  ]
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] }),
    [`GET /api/children/${FY.id}/journal`]: () => ({ body: { items, next: null, today: { calls: 2, blocked: 0, messages: 0, unlocks: 0 } } })
  })
  await page.goto('/espace/journal')
  await expect(page.getByText('Appel de numéro masqué')).toBeVisible()
  await expect(page.getByText('laissé passer : appel aux secours dans les 30 min · 1 min 35 s')).toBeVisible()
  await expect(page.getByText('laissé passer : appel aux secours dans les 30 min', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Autoriser ce numéro' })).toHaveCount(0)
})

// NAR-231 : une icône par tuile ; « Aujourd'hui » défile dans sa carte, les jours suivants restent après.
test('tuiles avec icône ; liste du jour défilable', async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  await page.setViewportSize({ width: 360, height: 800 })
  const many = Array.from({ length: 30 }, (_, n) => ({
    id: `6f1c2b1e-0000-4000-8000-0000000005${String(n).padStart(2, '0')}`, kind: 'call_in', at: ago(0.01 * (n + 1)), contactId: 'c1', name: 'Maman', phone: '+261341234567', durationS: 60
  }))
  const api = journalApi()
  api.handlers[`GET /api/children/${FY.id}/journal`] = () => ({ body: { items: [...many, ITEMS[2]], next: null, today: { calls: 30, blocked: 0, messages: 0, unlocks: 0 } } })
  await mockApi(page, api.handlers)
  await page.goto('/espace/journal')
  await expect(page.locator('.summary .tile svg')).toHaveCount(4)
  await expect(page.getByRole('button', { name: /^30 Appels$/ })).toBeVisible()
  const today = page.getByRole('list', { name: 'Aujourd’hui' })
  await expect(today).toHaveAttribute('tabindex', '0')
  const sizes = await today.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }))
  expect(sizes.scroll).toBeGreaterThan(sizes.client)
  expect(sizes.client).toBeLessThanOrEqual(440)
  // Liste et page au bout : la dernière ligne du jour reste au-dessus de la barre d'onglets.
  await today.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight))
  const last = await today.locator('li').last().boundingBox()
  const bar = await page.getByRole('navigation').last().boundingBox()
  expect(last!.y + last!.height).toBeLessThanOrEqual(bar!.y)
  // Un autre filtre : la liste du jour repart en haut.
  await page.evaluate(() => window.scrollTo(0, 0))
  await today.evaluate((el) => { el.scrollTop = 300 })
  await page.getByRole('button', { name: /Appels$/ }).click()
  await expect.poll(() => page.getByRole('list', { name: 'Aujourd’hui' }).evaluate((el) => el.scrollTop)).toBe(0)
  // Tuile active : coche dans la pastille.
  await expect(page.getByRole('button', { name: /Appels$/ })).toHaveAttribute('aria-pressed', 'true')
  // Titre des tuiles retiré de l'écran, gardé pour les lecteurs d'écran.
  await expect(page.getByText('Aujourd’hui en bref')).toHaveClass(/visually-hidden/)
})

// NAR-233 : sélecteur de jour. ‹ › changent de jour (› désactivé aujourd'hui), le calendrier aussi ;
// liste et nombres sont ceux du jour choisi ; jamais demain ni au-delà de 90 jours.
test('sélecteur de jour : jour précédent, calendrier, bornes', async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  await page.setViewportSize({ width: 360, height: 800 })
  const yesterdayItem = { id: '6f1c2b1e-0000-4000-8000-000000000409', kind: 'call_out', at: ago(24), contactId: 'c1', name: 'Papa', phone: '+261331234567', durationS: 30 }
  const days: string[] = []
  const api = journalApi()
  api.handlers[`GET /api/children/${FY.id}/journal`] = (req: { url(): string }) => {
    const day = new URL(req.url()).searchParams.get('day') ?? ''
    days.push(day)
    const wanted = day === 'today' ? '2026-11-18' : day
    const items = [...ITEMS, yesterdayItem].filter((i) => !wanted || dayOf(i.at) === wanted)
    return { body: { items, next: null, today: { calls: items.filter((i) => i.kind !== 'call_blocked').length, blocked: items.filter((i) => i.kind === 'call_blocked').length, messages: 0, unlocks: 0 } } }
  }
  await mockApi(page, api.handlers)
  await page.goto('/espace/journal')
  const picker = page.getByRole('group', { name: 'Jour affiché' })
  const next = picker.getByRole('button', { name: 'Jour suivant' })
  const prev = picker.getByRole('button', { name: 'Jour précédent' })
  await expect(next).toBeDisabled()
  await expect(page.getByText('Appel à Papa')).toHaveCount(0)
  for (const b of [prev, next, picker.getByRole('button', { name: /^Choisir le jour/ })]) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(48)

  await prev.click()
  await expect(picker.getByRole('button', { name: 'Choisir le jour, Hier' })).toBeVisible()
  await expect(page.getByText('Appel à Papa')).toBeVisible()
  await expect(page.getByText('Appel de Maman')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^1 Appels$/ })).toBeVisible()
  await expect(page.getByText('Ce jour en bref')).toHaveCount(1)
  expect(days).toContain('2026-11-17')
  await expect(next).toBeEnabled()

  // Calendrier natif : un jour sans rien, puis les bornes du champ.
  const field = picker.getByLabel('Jour', { exact: true })
  await expect(field).toHaveAttribute('max', '2026-11-18')
  await expect(field).toHaveAttribute('min', '2026-08-21')
  // Retour à aujourd'hui par › : « today » envoyé (le jour du serveur).
  await next.click()
  await expect(picker.getByRole('button', { name: 'Choisir le jour, Aujourd’hui' })).toBeVisible()
  expect(days.at(-1)).toBe('today')
  await prev.click()
  await expect(picker.getByRole('button', { name: 'Choisir le jour, Hier' })).toBeVisible()
  // La liste porte le même nom que le sélecteur.
  await expect(page.getByRole('list', { name: 'Hier' })).toBeVisible()
  await field.fill('2026-11-10')
  await expect(picker.getByRole('button', { name: /^Choisir le jour, / })).not.toHaveAccessibleName(/Hier|Aujourd’hui/)
  await expect(page.getByText('Rien ce jour-là.')).toBeVisible()
  await field.fill('2026-08-21')
  await expect(prev).toBeDisabled()
})

// Revue NAR-233 : passé minuit, l'écran resté ouvert suit le nouveau jour (› de nouveau grisé).
test('sélecteur de jour : minuit passé, « Aujourd’hui » suit', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-18T20:58:00Z') }) // 23:58 à Antananarivo
  const api = journalApi()
  await mockApi(page, api.handlers)
  await page.goto('/espace/journal')
  const picker = page.getByRole('group', { name: 'Jour affiché' })
  await expect(picker.getByRole('button', { name: 'Choisir le jour, Aujourd’hui' })).toBeVisible()
  const field = picker.getByLabel('Jour', { exact: true })
  await expect(field).toHaveAttribute('max', '2026-11-18')
  const before = api.days.length
  await page.clock.runFor(3 * 60_000)
  await expect(field).toHaveAttribute('max', '2026-11-19')
  await expect(picker.getByRole('button', { name: 'Choisir le jour, Aujourd’hui' })).toBeVisible()
  await expect(picker.getByRole('button', { name: 'Jour suivant' })).toBeDisabled()
  // Aujourd'hui relu au serveur (toujours « today »).
  await expect.poll(() => api.days.length).toBeGreaterThan(before)
  expect(api.days.at(-1)).toBe('today')
})

// NAR-244 (revue) : « Voir plus » redemande la date rendue par le serveur, jamais « today » : passé
// minuit, « today » serait un autre jour et la fin de la journée affichée serait perdue.
test('« Voir plus » : la date retenue par le serveur, jamais « today » de nouveau', async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  const asked: string[] = []
  const api = journalApi()
  api.handlers[`GET /api/children/${FY.id}/journal`] = (req: { url(): string }) => {
    const u = new URL(req.url())
    asked.push(`${u.searchParams.get('day') ?? ''}|${u.searchParams.get('before') ? 'suite' : 'début'}`)
    if (u.searchParams.get('before')) return { body: { items: [ITEMS[2]], next: null, day: '2026-11-18' } }
    return { body: { items: ITEMS.slice(0, 2), next: `${ITEMS[1].at}_${ITEMS[1].id}`, day: '2026-11-18', today: { calls: 1, blocked: 2, messages: 0, unlocks: 0 } } }
  }
  await mockApi(page, api.handlers)
  await page.goto('/espace/journal')
  await page.getByRole('button', { name: 'Voir plus' }).click()
  await expect(page.getByText('Appel de Maman')).toBeVisible()
  expect(asked[0]).toBe('today|début')
  expect(asked.filter((a) => a.endsWith('suite'))).toEqual(['2026-11-18|suite'])
})
