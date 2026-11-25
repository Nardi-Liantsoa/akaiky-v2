import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'
import { row, summary } from './settings'

// Réglages en résumé (NAR-185) : une ligne par section avec son état réel, une page par
// section, retour au résumé (contrôle de retour et retour de l'historique, celui du
// bouton Android), enfant affiché gardé partout.
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: '2026-11-12T10:00:00Z', remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false }
const TIANA = { ...FY, id: '6f1c2b1e-0000-4000-8000-000000000102', firstName: 'Tiana', avatarColor: 'green', parentCodeSetAt: null, sosSiren: true }
const contact = (childId: string, n: number) => ({ id: `6f1c2b1e-0000-4000-8000-0000000002${n}${childId.slice(-1)}`, childId, name: `Contact ${n}`, phone: `+26134000000${n}`, position: n, avatarColor: 'blue', memberUserId: null, memberRole: null })
const contactsOf = (childId: string, n: number) => ({ body: { version: 1, max: 6, country: 'MG', contacts: Array.from({ length: n }, (_, i) => contact(childId, i + 1)) } })
const base = {
  ...me,
  'GET /api/families/me': () => ({ body: FAMILY }),
  'GET /api/children': () => ({ body: [FY] }),
  [`GET /api/children/${FY.id}/contacts`]: () => contactsOf(FY.id, 3),
  [`GET /api/children/${FY.id}/apps`]: () => ({
    body: {
      max: 4,
      inventory: [{ package: 'cam', label: 'Appareil photo', icon: null, allowed: true }, { package: 'calc', label: 'Calculatrice', icon: null, allowed: true }],
      allowed: [{ package: 'cam', label: 'Appareil photo', position: 1 }, { package: 'calc', label: 'Calculatrice', position: 2 }]
    }
  }),
  [`GET /api/children/${FY.id}/schedules`]: () => ({ body: [{ id: '6f1c2b1e-0000-4000-8000-000000000301', label: 'École', days: 31, startMin: 480, endMin: 960, enabled: true }] }),
  [`GET /api/children/${FY.id}/message-templates`]: () => ({ body: [{ slot: 1, text: null }, { slot: 2, text: 'Viens me chercher' }, { slot: 3, text: null }, { slot: 4, text: null }] }),
  [`GET /api/children/${TIANA.id}/contacts`]: () => contactsOf(TIANA.id, 1)
}
const tabs = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Navigation principale' })

test('le résumé montre l’état réel de chaque section, et tient sans défiler à 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await mockApi(page, base)
  await page.goto('/espace/reglages')
  await expect(page.getByRole('heading', { level: 1, name: 'Réglages' })).toBeVisible()
  const expected = [
    ['Contacts autorisés', '3 sur 6'],
    ['Applications autorisées', '2 sur 4 · Appareil photo, Calculatrice'],
    ['Code parent', 'Défini le 12 novembre'],
    ['Plages horaires', 'École · Lun–Ven 8:00–16:00'],
    ['SOS', 'Sirène désactivée'],
    ['Messages rapides', '1 sur 4 personnalisé']
  ]
  const links = summary(page).getByRole('link')
  await expect(links).toHaveCount(6)
  for (const [i, [title, text]] of expected.entries()) {
    await expect(links.nth(i)).toContainText(title)
    await expect(links.nth(i)).toContainText(text)
  }
  // Six lignes d'au moins 48 px, toutes au-dessus de la barre d'onglets, sans défilement.
  const bar = (await tabs(page).boundingBox())!
  for (const box of await links.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))) {
    expect(box.height).toBeGreaterThanOrEqual(48)
    expect(box.bottom).toBeLessThanOrEqual(bar.y)
  }
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)
})

test('résumés en cours de chargement puis en échec : « Chargement… », « Indisponible », un seul « Réessayer »', async ({ page }) => {
  let release!: () => void
  const slow = new Promise<void>((r) => { release = r })
  let fail = true
  await mockApi(page, {
    ...base,
    [`GET /api/children/${FY.id}/apps`]: async () => { await slow; return base[`GET /api/children/${FY.id}/apps`]() },
    [`GET /api/children/${FY.id}/schedules`]: () => (fail ? { status: 503, body: { error: 'Occupé.' } } : base[`GET /api/children/${FY.id}/schedules`]()),
    [`GET /api/children/${FY.id}/message-templates`]: () => (fail ? { status: 503, body: { error: 'Occupé.' } } : base[`GET /api/children/${FY.id}/message-templates`]())
  })
  await page.goto('/espace/reglages')
  await expect(row(page, 'Applications autorisées')).toContainText('Chargement…')
  await expect(summary(page).getByRole('list')).toHaveAttribute('aria-busy', 'true')
  await expect(row(page, 'Plages horaires')).toContainText('Indisponible')
  await expect(row(page, 'Messages rapides')).toContainText('Indisponible')
  const alert = page.getByRole('alert')
  await expect(alert).toHaveCount(1)
  await expect(alert).toContainText('Résumé indisponible : Plages horaires, Messages rapides.')
  release()
  await expect(row(page, 'Applications autorisées')).toContainText('2 sur 4')
  await expect(summary(page).getByRole('list')).toHaveAttribute('aria-busy', 'false')

  fail = false
  await alert.getByRole('button', { name: 'Réessayer' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(row(page, 'Plages horaires')).toContainText('École · Lun–Ven 8:00–16:00')
  await expect(row(page, 'Messages rapides')).toContainText('1 sur 4 personnalisé')
})

test('ouvrir une section, revenir (contrôle de retour, puis retour de l’historique) : l’enfant choisi est gardé', async ({ page }) => {
  await mockApi(page, { ...base, 'GET /api/children': () => ({ body: [FY, TIANA] }) })
  await page.goto('/espace/reglages')
  await expect(row(page, 'Contacts autorisés')).toContainText('3 sur 6')
  // Tiana choisie sur le résumé : ses propres états.
  await page.getByRole('button', { name: /Enfant affiché : Fy/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Tiana/ }).click()
  await expect(page.getByRole('button', { name: /Enfant affiché : Tiana/ })).toBeVisible()
  await expect(row(page, 'Contacts autorisés')).toContainText('1 sur 6')
  await expect(row(page, 'SOS')).toContainText('Sirène activée')
  await expect(row(page, 'Code parent')).toContainText('Pas encore défini')

  // Section SOS : page dédiée, Réglages reste l'onglet actif, Tiana toujours affichée.
  await row(page, 'SOS').click()
  await expect(page).toHaveURL(/\/espace\/reglages\/sos$/)
  await expect(page.getByRole('heading', { level: 1, name: 'SOS' })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Sirène pendant un SOS' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('button', { name: /Enfant affiché : Tiana/ })).toBeVisible()
  await expect(tabs(page).getByRole('link', { name: 'Réglages' })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('link', { name: 'Retour aux réglages' }).click()
  await expect(page).toHaveURL(/\/espace\/reglages$/)
  await expect(page.getByRole('button', { name: /Enfant affiché : Tiana/ })).toBeVisible()
  await expect(row(page, 'SOS')).toContainText('Sirène activée')
  // Le contrôle de retour est un retour dans l'historique (pas de doublon empilé) : la
  // section est devant, et non derrière.
  await page.goForward()
  await expect(page).toHaveURL(/\/espace\/reglages\/sos$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/espace\/reglages$/)

  // Retour de l'historique (bouton retour d'Android) : même résumé, même enfant ; Fy
  // choisie sur la page de section reste choisie au retour.
  await row(page, 'Plages horaires').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Plages horaires' })).toBeVisible()
  await page.getByRole('button', { name: /Enfant affiché : Tiana/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Fy/ }).click()
  await expect(page.getByRole('button', { name: /Enfant affiché : Fy/ })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/espace\/reglages$/)
  await expect(page.getByRole('button', { name: /Enfant affiché : Fy/ })).toBeVisible()
  await expect(row(page, 'Plages horaires')).toContainText('École · Lun–Ven 8:00–16:00')
})

test('une section ouverte par son adresse : le retour mène au résumé, sans quitter Réglages', async ({ page }) => {
  await mockApi(page, base)
  await page.goto('/espace/reglages/applications')
  await expect(page.getByRole('heading', { level: 1, name: 'Applications autorisées' })).toBeVisible()
  await expect(page.getByText('✓ Appareil photo')).toBeVisible()
  await page.getByRole('link', { name: 'Retour aux réglages' }).click()
  await expect(page).toHaveURL(/\/espace\/reglages$/)
  await expect(summary(page).getByRole('link')).toHaveCount(6)
})

test('page de section sans enfant : un seul h1, au nom de la section', async ({ page }) => {
  await mockApi(page, { ...base, 'GET /api/children': () => ({ body: [] }) })
  await page.goto('/espace/reglages/plages')
  await expect(page.getByText('Ajoutez d’abord un enfant pour régler son téléphone.')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1, name: 'Plages horaires' })).toBeVisible()
})
