import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'
// NAR-234 : Android, la barre d'état recouvre la WebView. Le greffon SystemBars de Capacitor pose
// --safe-area-inset-top (ici 32 px) ; env() peut rester à 0 sur une WebView ancienne.
test('barre d’état Android : le titre passe sous elle', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 })
  await mockApi(page, { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }), 'GET /api/families/me': () => ({ body: FAMILY }), 'GET /api/children': () => ({ body: [] }) })
  await page.goto('/espace/reglages')
  const h1 = page.getByRole('heading', { level: 1 })
  await expect(h1).toBeVisible()
  // Web et iOS (sans la variable) : 24 px ; Android : 24 px sous la barre.
  const before = (await h1.boundingBox())!.y
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-area-inset-top', '32px'))
  await expect.poll(async () => (await h1.boundingBox())!.y).toBe(before + 32)
})
