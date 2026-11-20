import { expect, type Page } from '@playwright/test'

// Réglages (NAR-185) : résumé d'abord, puis la page d'une section par sa ligne.
export const summary = (page: Page) => page.getByRole('navigation', { name: 'Sections des réglages' })
export const row = (page: Page, title: string) => summary(page).getByRole('link', { name: new RegExp(`^${title}`) })

export async function openSection(page: Page, title: string) {
  await page.goto('/espace/reglages')
  await row(page, title).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
}
