import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, h, type Component } from 'vue'
import { renderToString, type SSRContext } from 'vue/server-renderer'
import { MESSAGES } from '../../i18n/messages'

// Textes en français, sans le module de langue (qui touche document et localStorage).
vi.mock('../../composables/useT', () => ({ useT: () => computed(() => MESSAGES.fr) }))

// La feuille lit document (élément actif, verrou de défilement de la pile) dès sa
// création : un document minimal suffit au rendu serveur, sans DOM simulé.
beforeAll(() => {
  vi.stubGlobal('HTMLElement', class {})
  vi.stubGlobal('document', { activeElement: null, addEventListener: () => {}, removeEventListener: () => {}, body: { style: {} } })
})

// Rendu serveur de Vue : la feuille est téléportée dans <body>, son HTML arrive dans
// ctx.teleports. onMounted n'y est pas joué : c'est l'état à l'insertion.
async function render(props: Record<string, unknown>, slots: Record<string, () => unknown> = {}) {
  const { default: ConfirmSheet } = await import('./ConfirmSheet.vue')
  const ctx: SSRContext = {}
  const page = await renderToString(createSSRApp({ render: () => h(ConfirmSheet as Component, props, slots) }), ctx)
  const html = (ctx.teleports?.body ?? '').replace(/<!--[^>]*-->/g, '').replace(/ data-v-[0-9a-f]+/g, '')
  return { page: page.replace(/<!--[^>]*-->/g, ''), html }
}
const textOf = (html: string) => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
const buttons = (html: string) => [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attrs, text]) => ({ attrs, text: text.trim() }))

const base = { title: 'Retirer Fy ?', confirm: 'Confirmer : retirer cet enfant', items: ['ses contacts ;', 'ses téléphones.'] }

afterEach(async () => {
  // Pile vidée entre deux tests (chaque rendu y inscrit sa feuille).
  const { closeAllSheets } = await import('../../composables/useSheetStack')
  closeAllSheets()
  vi.resetModules()
})

describe('ConfirmSheet', () => {
  it('rendue dans <body>, jamais sur place : alertdialog modal nommé par le titre', async () => {
    const { page, html } = await render(base)
    expect(page).toBe('')
    expect(html).toMatch(/<div class="sheet" role="alertdialog" aria-modal="true" aria-label="Retirer Fy \?" tabindex="-1">/)
    expect(html).toContain('<h2>Retirer Fy ?</h2>')
  })

  it('conséquences en liste, bouton danger puis « Annuler », sans « Fermer »', async () => {
    const { html } = await render(base)
    expect(html).toMatch(/<ul class="items"[^>]*><li[^>]*>ses contacts ;<\/li><li[^>]*>ses téléphones\.<\/li><\/ul>/)
    const [danger, cancel, ...rest] = buttons(html)
    expect(rest).toEqual([])
    expect(danger.text).toBe('Confirmer : retirer cet enfant')
    expect(danger.attrs).toContain('type="submit"')
    expect(danger.attrs).toContain('btn-danger')
    expect(danger.attrs).not.toContain('disabled')
    expect(cancel.text).toBe('Annuler')
    expect(cancel.attrs).toContain('btn-ghost')
    expect(textOf(html)).not.toContain('Fermer')
  })

  it('sans mot de passe demandé : aucun champ', async () => {
    const { html } = await render(base)
    expect(html).not.toContain('<input')
  })

  it('mot de passe demandé : champ étiqueté, bouton désactivé tant qu’il est vide', async () => {
    const { html } = await render({ ...base, requirePassword: true, id: 'delete-family' })
    expect(html).toContain('<label for="delete-family-password">Votre mot de passe</label>')
    expect(html).toMatch(/<input id="delete-family-password"[^>]*type="password"[^>]*autocomplete="current-password"/)
    const danger = buttons(html).find((b) => b.text === base.confirm)
    expect(danger?.attrs).toMatch(/disabled/)
    expect(danger?.attrs).toContain('form="delete-family-form"')
    expect(html).toContain('<form id="delete-family-form"')
  })

  it('erreur affichée dans la feuille, en role="alert"', async () => {
    const { html } = await render({ ...base, requirePassword: true, error: 'Mot de passe incorrect.' })
    expect(html).toMatch(/<p class="error" role="alert"[^>]*>Mot de passe incorrect\.<\/p>/)
  })

  it('occupée : boutons désactivés, libellé d’attente, aria-busy', async () => {
    const { html } = await render({ ...base, busy: true })
    const [danger, cancel] = buttons(html)
    expect(danger.text).toBe('Un instant…')
    expect(danger.attrs).toMatch(/disabled/)
    expect(cancel.attrs).toMatch(/disabled/)
    expect(html).toMatch(/<form[^>]*aria-busy="true"/)
  })

  it('inscrite dans la pile : Échap / retour Android la ferment (close), jamais confirm', async () => {
    const onClose = vi.fn(), onConfirm = vi.fn()
    await render({ ...base, onClose, onConfirm })
    const { closeTopSheet, openSheets } = await import('../../composables/useSheetStack')
    expect(openSheets()).toBe(1)
    expect(closeTopSheet()).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('occupée : Échap / retour Android ne la ferment pas', async () => {
    const onClose = vi.fn()
    await render({ ...base, busy: true, onClose })
    const { closeTopSheet } = await import('../../composables/useSheetStack')
    expect(closeTopSheet()).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('contenu en plus (slot) placé avant les boutons', async () => {
    const { html } = await render(base, { default: () => h('p', { class: 'extra' }, 'Cédez d’abord ce rôle.') })
    expect(html.indexOf('Cédez d’abord ce rôle.')).toBeGreaterThan(-1)
    expect(html.indexOf('Cédez d’abord ce rôle.')).toBeLessThan(html.indexOf(base.confirm))
  })
})
