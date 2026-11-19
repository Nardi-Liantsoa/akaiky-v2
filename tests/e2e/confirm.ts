import { expect, type Locator, type Page, type Request } from '@playwright/test'

// Feuille de confirmation commune (NAR-184) : alertdialog nommé par son titre.
export const confirmSheet = (page: Page, title?: string | RegExp) => page.getByRole('alertdialog', title ? { name: title } : {})

// Les trois façons de refermer sans rien supprimer : « Annuler », Échap, toucher le fond.
export type CloseWay = 'cancel' | 'escape' | 'backdrop'
export async function closeSheet(page: Page, how: CloseWay) {
  if (how === 'cancel') await confirmSheet(page).getByRole('button', { name: 'Annuler', exact: true }).click()
  else if (how === 'escape') await page.keyboard.press('Escape')
  // Le fond couvre tout l'écran au-dessus de la feuille (posée en bas) : coin haut gauche.
  else await page.mouse.click(4, 4)
  await expect(confirmSheet(page)).toHaveCount(0)
}

// Une requête témoin, envoyée par la page et attendue : toute requête partie avant elle
// (un DELETE fautif lancé à la fermeture) est déjà passée par le routage de mockApi.
async function settle(page: Page) {
  await page.evaluate(() => fetch('/api/__e2e-settle').then(() => undefined, () => undefined))
}

// Ouvre la feuille par son bouton, la referme des trois façons : à chaque fois, rien
// n'est parti (aucun appel qui correspond à isDelete) et le focus revient au bouton.
export async function cancelEveryWay(page: Page, opener: Locator, calls: Request[], isDelete: (r: Request) => boolean) {
  for (const how of ['cancel', 'escape', 'backdrop'] as const) {
    await opener.click()
    await expect(confirmSheet(page)).toBeVisible()
    await settle(page)
    expect(calls.filter(isDelete), `rien d'envoyé à l'ouverture (${how})`).toHaveLength(0)
    await closeSheet(page, how)
    await expect(opener, `focus rendu au bouton (${how})`).toBeFocused()
    await settle(page)
    expect(calls.filter(isDelete), `rien d'envoyé après ${how}`).toHaveLength(0)
  }
}
