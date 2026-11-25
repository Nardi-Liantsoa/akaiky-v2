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

test('compte gardé dans une autre langue : l’app envoie la sienne à l’ouverture', async ({ page }) => {
  const calls = await mockApi(page, { ...base, 'GET /api/auth/me': () => ({ body: { user: { ...USER, lang: 'mg' } } }) })
  await page.goto('/espace/famille')
  await expect(page.getByRole('heading', { name: 'Famille', exact: true })).toBeVisible()
  await expect.poll(() => langPuts(calls)).toEqual([{ lang: 'fr' }])
})
