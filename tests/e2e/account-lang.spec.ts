import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

// Langue des courriels (NAR-211) : le compte suit la langue de l'app.
const base = {
  'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }),
  'GET /api/families/me': () => ({ body: FAMILY }),
  'GET /api/families/me/invitations': () => ({ body: [] }),
  'GET /api/auth/security': () => ({ body: { devices: [], mfaEnabled: false, recoveryCodesRemaining: 0 } }),
  'GET /api/auth/app-sessions': () => ({ body: [] }),
  'PUT /api/auth/me/lang': (req: { postDataJSON(): { lang: string } }) => ({ body: { lang: req.postDataJSON().lang } })
}
const langPuts = (calls: { method(): string, url(): string, postDataJSON(): unknown }[]) =>
  calls.filter((r) => r.method() === 'PUT' && r.url().endsWith('/api/auth/me/lang')).map((r) => r.postDataJSON())

test('même langue que l’app : rien n’est envoyé ; changement de langue : envoyé une fois', async ({ page }) => {
  const calls = await mockApi(page, { ...base, 'GET /api/auth/me': () => ({ body: { user: USER } }) })
  await page.goto('/espace/compte/securite')
  await expect(page.getByRole('heading', { name: 'Mon compte', level: 1 })).toBeVisible()
  expect(langPuts(calls)).toEqual([])
  await page.getByRole('region', { name: 'Langue et session' }).getByLabel('Langue').selectOption('mg')
  await expect.poll(() => langPuts(calls)).toEqual([{ lang: 'mg' }])
})

test('nouvel appareil (langue seulement devinée) : l’app prend la langue du compte, sans rien envoyer', async ({ page }) => {
  const calls = await mockApi(page, { ...base, 'GET /api/auth/me': () => ({ body: { user: { ...USER, lang: 'en' } } }) })
  await page.goto('/espace/famille')
  await expect(page.getByRole('heading', { name: 'Family', exact: true })).toBeVisible()
  expect(langPuts(calls)).toEqual([])
})

test('langue choisie sur cet appareil, autre que celle du compte : envoyée au compte', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('akaiky-v2.lang', 'fr') } catch { /* stockage indisponible */ } })
  const calls = await mockApi(page, { ...base, 'GET /api/auth/me': () => ({ body: { user: { ...USER, lang: 'mg' } } }) })
  await page.goto('/espace/famille')
  await expect(page.getByRole('heading', { name: 'Famille', exact: true })).toBeVisible()
  await expect.poll(() => langPuts(calls)).toEqual([{ lang: 'fr' }])
})

test('changements rapides : envoyés un par un, le dernier choix gagne', async ({ page }) => {
  const calls = await mockApi(page, { ...base, 'GET /api/auth/me': () => ({ body: { user: USER } }) })
  await page.goto('/espace/compte/securite')
  // Le nom de la carte change avec la langue : le seul menu de la page.
  const select = page.getByRole('combobox')
  await select.selectOption('mg')
  await select.selectOption('en')
  await expect.poll(() => langPuts(calls).at(-1)).toEqual({ lang: 'en' })
})

test('appareil partagé : la langue reprise d’un compte n’est pas gardée comme un choix', async ({ page }) => {
  let user = { ...USER, lang: 'en' }
  const calls = await mockApi(page, { ...base, 'GET /api/auth/me': () => ({ body: { user } }) })
  await page.goto('/espace/famille')
  await expect(page.getByRole('heading', { name: 'Family', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('akaiky-v2.lang'))).toBeNull()
  // Un autre compte, en malgache, sur le même appareil : il reprend le sien, rien n'est envoyé.
  user = { ...USER, id: '6f1c2b1e-0000-4000-8000-000000000009', lang: 'mg' }
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Fianakaviana', exact: true })).toBeVisible()
  expect(langPuts(calls)).toEqual([])
})

test('envoi refusé (429) : retenté plus tard', async ({ page }) => {
  await page.clock.install()
  let refuse = true
  const calls = await mockApi(page, {
    ...base,
    'GET /api/auth/me': () => ({ body: { user: USER } }),
    'PUT /api/auth/me/lang': (req: { postDataJSON(): { lang: string } }) => refuse ? { status: 429, body: { error: '…' } } : { body: { lang: req.postDataJSON().lang } }
  })
  await page.goto('/espace/compte/securite')
  await page.getByRole('combobox').selectOption('en')
  await expect.poll(() => langPuts(calls).length).toBe(1)
  refuse = false
  await page.clock.runFor(31_000)
  await expect.poll(() => langPuts(calls)).toEqual([{ lang: 'en' }, { lang: 'en' }])
})
