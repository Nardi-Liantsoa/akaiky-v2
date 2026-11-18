import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null }
const MSG = '6f1c2b1e-0000-4000-8000-000000000301'

test('accueil parent, « Aujourd’hui » : le message rapide de l’enfant s’affiche et est marqué comme vu', async ({ page }) => {
  let readBy: { name: string, readAt: string }[] = []
  const calls = await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] }),
    [`GET /api/children/${FY.id}/journal`]: () => ({ body: { items: [{ id: MSG, kind: 'message', at: new Date().toISOString(), slot: 1, readBy, readByMe: readBy.length > 0 }], next: null, counts: { blocked: 0 } } }),
    [`POST /api/messages/${MSG}/read`]: () => { readBy = [{ name: 'Alice', readAt: new Date().toISOString() }]; return { body: { ok: true } } }
  })
  await page.goto('/espace')
  await expect(page.getByRole('heading', { name: 'Aujourd’hui' })).toBeVisible()
  await expect(page.getByText('Je suis arrivé')).toBeVisible()
  await expect(page.getByText('Vu par Alice')).toBeVisible()
  await expect.poll(() => calls.filter((r) => r.method() === 'POST' && r.url().endsWith(`/messages/${MSG}/read`)).length).toBe(1)
})

test('accueil parent : rien aujourd’hui', async ({ page }) => {
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] }),
    [`GET /api/children/${FY.id}/journal`]: () => ({ body: { items: [], next: null, counts: { blocked: 0 } } })
  })
  await page.goto('/espace')
  await expect(page.getByText('Rien aujourd’hui pour l’instant.')).toBeVisible()
})
