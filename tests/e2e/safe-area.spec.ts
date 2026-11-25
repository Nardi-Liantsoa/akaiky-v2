import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

// NAR-234 : la barre d'état Android recouvre la WebView (main.ts). La coque parent garde 24 px
// sous la zone sûre du haut, lue dans env() ou dans --safe-area-inset-top (greffon SystemBars).
const api = {
  'GET /api/auth/me': () => ({ body: { user: USER } }),
  'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }),
  'GET /api/families/me': () => ({ body: FAMILY }),
  'GET /api/children': () => ({ body: [] })
}
const setInset = (page: import('@playwright/test').Page, px: number) =>
  page.evaluate((v) => document.documentElement.style.setProperty('--safe-area-inset-top', `${v}px`), px)

test('téléphone : 24 px en haut sans barre, 24 px sous la barre d’état sinon', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 })
  await mockApi(page, api)
  await page.goto('/espace/reglages')
  const shell = page.locator('.shell')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(shell).toHaveCSS('padding-top', '24px')
  await setInset(page, 32)
  await expect(shell).toHaveCSS('padding-top', '56px')
})

test('ordinateur ou tablette : la colonne collante de Réglages reste sous la barre d’état', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockApi(page, { ...api, 'GET /api/children': () => ({ body: [{ id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false }] }) })
  await page.goto('/espace/reglages')
  const master = page.locator('.master')
  await expect(master).toHaveCSS('top', '24px')
  await setInset(page, 32)
  await expect(master).toHaveCSS('top', '56px')
  await expect(page.locator('.shell')).toHaveCSS('padding-top', '56px')
})
