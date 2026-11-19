import { expect, test, type Request } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

// Textes des messages rapides (NAR-173) : Réglages, gestionnaire et contact.
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false }
const base = `/api/children/${FY.id}/message-templates`

function templatesApi(initial: Record<number, string | null> = {}) {
  const texts: Record<number, string | null> = { 1: null, 2: null, 3: null, 4: null, ...initial }
  const puts: { slot: number, text: string | null }[] = []
  const handlers: Record<string, (req: Request) => { status?: number, body?: unknown }> = {
    'GET /api/auth/me': () => ({ body: { user: USER } }),
    'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }),
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] }),
    [`GET /api/children/${FY.id}/contacts`]: () => ({ body: { version: 1, max: 6, country: 'MG', contacts: [] } }),
    [`GET ${base}`]: () => ({ body: [1, 2, 3, 4].map((slot) => ({ slot, text: texts[slot] })) })
  }
  for (const slot of [1, 2, 3, 4]) {
    handlers[`PUT ${base}/${slot}`] = (req) => {
      const { text } = req.postDataJSON()
      texts[slot] = text
      puts.push({ slot, text })
      return { body: { slot, text } }
    }
  }
  return { handlers, puts }
}

test('le gestionnaire modifie un texte, puis le remet par défaut ; seul ce qui change part', async ({ page }) => {
  const api = templatesApi({ 3: 'Bus en retard' })
  await mockApi(page, api.handlers)
  await page.goto('/espace/reglages')
  await expect(page.getByRole('heading', { name: 'Messages rapides' })).toBeVisible()
  const save = page.getByRole('button', { name: 'Enregistrer les messages' })
  await expect(save).toBeDisabled()
  await expect(page.getByLabel('Message 3')).toHaveValue('Bus en retard')
  // Gestionnaire : le champ seul, pas le texte en lecture seule en plus.
  await expect(page.locator('#template-3')).toHaveCount(1)
  await expect(page.locator('.readonly')).toHaveCount(0)
  await expect(page.getByLabel('Message 2')).toHaveAttribute('placeholder', 'Viens me chercher')

  await page.getByLabel('Message 2').fill('Viens me chercher à l’école')
  await save.click()
  await expect(page.getByText('Enregistré. Le téléphone l’affichera')).toBeVisible()
  expect(api.puts).toEqual([{ slot: 2, text: 'Viens me chercher à l’école' }])

  // « Texte par défaut » vide le champ ; enregistré, il envoie null.
  await page.getByRole('listitem').filter({ has: page.getByLabel('Message 3') }).getByRole('button', { name: 'Texte par défaut' }).click()
  await expect(page.getByLabel('Message 3')).toHaveValue('')
  await save.click()
  await expect.poll(() => api.puts.at(-1)).toEqual({ slot: 3, text: null })
  // Plus de 40 caractères (comptés comme le serveur) : signalé, enregistrement bloqué.
  await page.getByLabel('Message 1').fill('x'.repeat(41))
  await expect(page.getByText('Entre 1 et 40 caractères.')).toBeVisible()
  await expect(save).toBeDisabled()
  await page.getByLabel('Message 1').fill('😀'.repeat(40))
  await expect(page.getByText('Entre 1 et 40 caractères.')).toHaveCount(0)
  await expect(save).toBeEnabled()
})

test('un contact de famille voit les textes sans pouvoir les modifier', async ({ page }) => {
  const api = templatesApi({ 1: 'Arrivé à la maison' })
  await mockApi(page, { ...api.handlers, 'GET /api/families/me': () => ({ body: { ...FAMILY, role: 'member' } }) })
  await page.goto('/espace/reglages')
  await expect(page.getByText('Arrivé à la maison')).toBeVisible()
  await expect(page.getByText('Tout va bien')).toBeVisible()
  await expect(page.getByRole('textbox', { name: /^Message / })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Enregistrer les messages' })).toHaveCount(0)
})

test('Réglages : la carte des messages ne chevauche pas « Code parent »', async ({ page }) => {
  await mockApi(page, templatesApi().handlers)
  await page.goto('/espace/reglages')
  await expect(page.getByLabel('Message 4')).toBeVisible()
  const code = await page.locator('#code-parent').boundingBox()
  const messages = await page.locator('#messages-rapides').boundingBox()
  expect(messages!.y - (code!.y + code!.height)).toBeGreaterThanOrEqual(12)
})
