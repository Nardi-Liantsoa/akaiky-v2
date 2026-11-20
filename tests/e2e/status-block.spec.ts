import { expect, test, type Page } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

// Bloc d'état commun (NAR-183) : chargement visible et annoncé une fois, erreur de
// chargement avec « Réessayer », une seule erreur à la fois sur les applications.
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false }
const CONTACTS = { version: 1, max: 6, country: 'MG', contacts: [] }
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const base = {
  ...me,
  'GET /api/families/me': () => ({ body: FAMILY }),
  'GET /api/children': () => ({ body: [FY] }),
  [`GET /api/children/${FY.id}/contacts`]: () => ({ body: CONTACTS }),
  [`GET /api/children/${FY.id}/devices`]: () => ({ body: [] }),
  [`GET /api/children/${FY.id}/journal`]: () => ({ body: { items: [], next: null, today: { calls: 0, blocked: 0, messages: 0, unlocks: 0 } } })
}

// Réponse retenue jusqu'à l'ouverture de la barrière (API lente).
function gate() {
  let open = () => {}
  const opened = new Promise<void>((resolve) => { open = resolve })
  return { opened, open: () => open() }
}
const loading = (page: Page) => page.getByRole('status').filter({ hasText: 'Chargement…' })

test('accueil lent : un seul indicateur, visible et annoncé, gardé de la famille aux enfants', async ({ page }) => {
  const familyGate = gate()
  const childrenGate = gate()
  const calls = await mockApi(page, {
    ...base,
    'GET /api/families/me': async () => { await familyGate.opened; return { body: FAMILY } },
    'GET /api/children': async () => { await childrenGate.opened; return { body: [FY] } }
  })
  await page.goto('/espace')
  await expect(loading(page)).toBeVisible()
  await expect(loading(page)).toHaveCount(1)
  await expect(loading(page).getByText('Chargement…')).toBeVisible()
  // Indicateur visuel (décoratif pour les lecteurs d'écran), animé hors réduction des animations.
  const spinner = loading(page).locator('[aria-hidden="true"]')
  await expect(spinner).toBeVisible()
  expect(await spinner.evaluate((el) => getComputedStyle(el).animationName)).not.toBe('none')
  // Le même nœud reste en place quand la famille arrive et que les enfants chargent :
  // aucune seconde annonce.
  await loading(page).evaluate((el) => { el.setAttribute('data-repere', '1') })
  expect(calls.some((r) => r.url().endsWith('/api/children'))).toBe(false)
  familyGate.open()
  // Famille arrivée : la liste des enfants est demandée (et retenue).
  await expect.poll(() => calls.some((r) => r.url().endsWith('/api/children'))).toBe(true)
  await expect(page.getByRole('heading', { name: 'Accueil', level: 1 })).toBeVisible()
  await expect(loading(page)).toHaveCount(1)
  await expect(loading(page)).toHaveAttribute('data-repere', '1')
  childrenGate.open()
  await expect(loading(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Fy / })).toBeVisible()
})

test('animations réduites : l’indicateur de chargement est immobile', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const childrenGate = gate()
  await mockApi(page, { ...base, 'GET /api/children': async () => { await childrenGate.opened; return { body: [FY] } } })
  await page.goto('/espace')
  const spinner = loading(page).locator('[aria-hidden="true"]')
  await expect(spinner).toBeVisible()
  expect(await spinner.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  childrenGate.open()
  await expect(loading(page)).toHaveCount(0)
})

for (const [name, path, ready] of [
  ['Journal', '/espace/journal', 'Les appels, messages et alertes apparaîtront ici.'],
  ['Réglages', '/espace/reglages', 'Contacts autorisés'],
  ['Appairage', `/espace/enfant/${FY.id}/telephone`, 'Téléphones appairés'],
  ['fiche enfant', `/espace/enfant/${FY.id}`, 'Prénom'],
  ['fiche contact', `/espace/reglages/enfant/${FY.id}/contact/nouveau`, 'Nom affiché']
] as const) {
  test(`${name} lent : indicateur et texte visibles, annoncés une fois`, async ({ page }) => {
    const childrenGate = gate()
    await mockApi(page, { ...base, 'GET /api/children': async () => { await childrenGate.opened; return { body: [FY] } } })
    await page.goto(path)
    await expect(loading(page)).toBeVisible()
    await expect(loading(page)).toHaveCount(1)
    await expect(loading(page).getByText('Chargement…')).toBeVisible()
    await expect(loading(page).locator('[aria-hidden="true"]')).toBeVisible()
    childrenGate.open()
    await expect(loading(page)).toHaveCount(0)
    await expect(page.getByText(ready, { exact: true }).first()).toBeVisible()
  })
}

test('accueil : erreur de chargement, puis « Réessayer » affiche les enfants', async ({ page }) => {
  let fail = true
  await mockApi(page, { ...base, 'GET /api/children': () => (fail ? { status: 500, body: { error: 'Erreur.' } } : { body: [FY] }) })
  await page.goto('/espace')
  const alert = page.getByRole('alert').filter({ hasText: 'Impossible de charger les enfants.' })
  await expect(alert).toBeVisible()
  fail = false
  await alert.getByRole('button', { name: 'Réessayer' }).click()
  await expect(alert).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Fy / })).toBeVisible()
})

// Depuis NAR-185, chaque carte a sa page (le résumé a son propre bandeau : settings-summary.spec.ts).
test('réglages : chaque section en échec propose « Réessayer », même présentation, une seule erreur par carte', async ({ page }) => {
  let fail = true
  const failing = () => ({ status: 503, body: { error: 'Occupé.' } })
  await mockApi(page, {
    ...base,
    [`GET /api/children/${FY.id}/apps`]: () => (fail ? failing() : { body: { max: 4, inventory: [], allowed: [] } }),
    [`GET /api/children/${FY.id}/schedules`]: () => (fail ? failing() : { body: [] }),
    [`GET /api/children/${FY.id}/message-templates`]: () => (fail ? failing() : { body: [1, 2, 3, 4].map((slot) => ({ slot, text: null })) })
  })
  const looks: string[] = []
  for (const [path, title, text, ready] of [
    ['applications', 'Applications autorisées', 'Applications indisponibles pour le moment.', 'Le téléphone n’a pas encore envoyé la liste de ses applications.'],
    ['plages', 'Plages horaires', 'Impossible de charger les plages horaires.', 'Aucune plage pour l’instant.'],
    ['messages', 'Messages rapides', 'Impossible de charger les messages rapides.', 'Message 1']
  ] as const) {
    fail = true
    await page.goto(`/espace/reglages/${path}`)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    const alert = page.getByRole('alert').filter({ hasText: text })
    // Une seule erreur sur la page (applications : jamais chargement et action empilés).
    await expect(alert).toHaveCount(1)
    await expect(page.getByRole('alert')).toHaveCount(1)
    const button = alert.getByRole('button', { name: 'Réessayer' })
    looks.push(await button.evaluate((el) => {
      const s = getComputedStyle(el)
      return [el.className, s.backgroundColor, s.borderColor, s.color, s.minHeight].join('|')
    }))
    fail = false
    await button.click()
    await expect(alert).toHaveCount(0)
    await expect(page.getByText(ready).first()).toBeVisible()
  }
  expect(new Set(looks).size).toBe(1)
})

test('journal : erreur de chargement, puis « Réessayer » relit le journal', async ({ page }) => {
  let fail = true
  await mockApi(page, {
    ...base,
    [`GET /api/children/${FY.id}/journal`]: () => (fail
      ? { status: 500, body: { error: 'Erreur.' } }
      : { body: { items: [], next: null, today: { calls: 0, blocked: 0, messages: 0, unlocks: 0 } } })
  })
  await page.goto('/espace/journal')
  const alert = page.getByRole('alert').filter({ hasText: 'Impossible de charger le journal.' })
  await expect(alert).toBeVisible()
  fail = false
  await alert.getByRole('button', { name: 'Réessayer' }).click()
  await expect(alert).toHaveCount(0)
  await expect(page.getByText('Les appels, messages et alertes apparaîtront ici.')).toBeVisible()
})
