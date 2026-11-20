import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, h, type Component } from 'vue'
import { renderToString, type SSRContext } from 'vue/server-renderer'
import { MESSAGES } from '../../i18n/messages'

// Textes en français, sans le module de langue (qui touche document et localStorage).
vi.mock('../../composables/useT', () => ({ useT: () => computed(() => MESSAGES.fr) }))

// Document minimal (élément actif, pile des feuilles) : rendu serveur sans DOM simulé.
beforeAll(() => {
  vi.stubGlobal('HTMLElement', class {})
  vi.stubGlobal('document', { activeElement: null, addEventListener: () => {}, removeEventListener: () => {}, body: { style: {} } })
})

async function render(props: Record<string, unknown>) {
  const { default: ChildSheet } = await import('./ChildSheet.vue')
  const ctx: SSRContext = {}
  await renderToString(createSSRApp({ render: () => h(ChildSheet as Component, props, { default: () => h('p', 'contenu') }) }), ctx)
  return (ctx.teleports?.body ?? '').replace(/<!--[^>]*-->/g, '').replace(/ data-v-[0-9a-f]+/g, '')
}
const buttons = (html: string) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, inner]) => ({ attrs, inner }))

afterEach(async () => {
  const { closeAllSheets } = await import('../../composables/useSheetStack')
  closeAllSheets()
  vi.resetModules()
})

describe('ChildSheet', () => {
  it('par défaut (sélecteur d’enfant) : grand bouton « Fermer » en bas, pas de ×', async () => {
    const html = await render({ title: 'Enfants de la famille' })
    const [close, ...rest] = buttons(html)
    expect(rest).toEqual([])
    expect(close.inner.trim()).toBe('Fermer')
    expect(close.attrs).toContain('btn-ghost')
    expect(html).not.toContain('close-icon')
    expect(html).toContain('<h2>Enfants de la famille</h2>')
  })

  it('closeIcon (menu « ⋯ ») : × nommé « Fermer » dans l’en-tête, plus de grand bouton', async () => {
    const html = await render({ title: 'Actions pour Fy', closeIcon: true })
    const [close, ...rest] = buttons(html)
    expect(rest).toEqual([])
    expect(close.attrs).toContain('class="close-icon"')
    expect(close.attrs).toContain('aria-label="Fermer"')
    expect(close.attrs).toContain('type="button"')
    // Icône du jeu commun, sans texte visible.
    expect(close.inner).toMatch(/^\s*<svg[\s\S]*<\/svg>\s*$/)
    // Titre et × dans le même en-tête, avant le contenu.
    expect(html).toMatch(/<div class="head"><h2>Actions pour Fy<\/h2><button[^>]*class="close-icon"[\s\S]*<\/div><p>contenu<\/p>/)
    expect(html).not.toContain('btn-ghost')
  })
})
