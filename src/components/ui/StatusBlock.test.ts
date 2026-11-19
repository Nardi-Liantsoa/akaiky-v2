import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { MESSAGES } from '../../i18n/messages'
import StatusBlock from './StatusBlock.vue'

// Textes en français, sans le module de langue (qui touche document et localStorage).
vi.mock('../../composables/useT', () => ({ useT: () => computed(() => MESSAGES.fr) }))

// Rendu serveur de Vue : le HTML produit est celui que monte le navigateur, sans DOM
// simulé. onMounted n'y est pas joué : c'est exactement l'état à l'insertion.
async function render(component: Component, props: Record<string, unknown>, slots: Record<string, () => unknown> = {}) {
  const html = await renderToString(createSSRApp({ render: () => h(component, props, slots) }))
  return html.replace(/<!--[^>]*-->/g, '')
}
const rootTag = (html: string) => html.match(/^<div[^>]*>/)?.[0] ?? ''
const classesOf = (tag: string) => (tag.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean)
const textOf = (html: string) => html.replace(/<[^>]*>/g, '')

afterEach(() => { vi.doUnmock('./AppButton.vue'); vi.resetModules() })

describe('StatusBlock', () => {
  it('chargement : zone role="status", anneau décoratif et texte par défaut', async () => {
    const html = await render(StatusBlock, { state: 'loading' })
    expect(rootTag(html)).toContain('role="status"')
    expect(html).toMatch(/<span class="spinner"[^>]*aria-hidden="true"/)
    expect(textOf(html)).toBe('Chargement…')
  })

  it('chargement : zone présente mais texte pas encore visible à l’insertion (annoncé ensuite, une fois)', async () => {
    const html = await render(StatusBlock, { state: 'loading' })
    const label = html.match(/<span class="([^"]*label[^"]*)"/)?.[1] ?? ''
    expect(label.split(' ').sort()).toEqual(['label', 'pending'])
  })

  it('chargement : texte fourni et hauteur réservée de page', async () => {
    const html = await render(StatusBlock, { state: 'loading', text: 'Un instant', fill: true })
    expect(textOf(html)).toBe('Un instant')
    expect(classesOf(rootTag(html))).toEqual(expect.arrayContaining(['status-block', 'is-loading', 'fill']))
  })

  it('erreur : role="alert", message, bandeau .error et « Réessayer » en bouton secondaire', async () => {
    const html = await render(StatusBlock, { state: 'error', text: 'Impossible de charger les enfants.' })
    expect(rootTag(html)).toContain('role="alert"')
    expect(classesOf(rootTag(html))).toContain('error')
    expect(html).toContain('<p class="label"')
    expect(textOf(html)).toContain('Impossible de charger les enfants.')
    const button = html.match(/<button[^>]*>([^<]*)<\/button>/)
    expect(button?.[1]).toBe('Réessayer')
    expect(classesOf(button?.[0] ?? '')).toEqual(['btn', 'btn-ghost'])
    expect(button?.[0]).toContain('type="button"')
  })

  it('erreur : « Réessayer » émet retry', async () => {
    // Bouton remplacé par un double qui garde son écouteur de clic.
    const clicks: (() => void)[] = []
    vi.doMock('./AppButton.vue', () => ({
      default: defineComponent({
        inheritAttrs: false,
        setup(_, { attrs, slots }) {
          if (typeof attrs.onClick === 'function') clicks.push(attrs.onClick as () => void)
          return () => h('button', slots.default?.())
        }
      })
    }))
    const { default: Fresh } = await import('./StatusBlock.vue')
    const onRetry = vi.fn()
    await render(Fresh, { state: 'error', text: 'Erreur', onRetry })
    expect(clicks).toHaveLength(1)
    clicks[0]()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('vide : texte sans rôle annoncé, ni bouton, ni action', async () => {
    const html = await render(StatusBlock, { state: 'empty', text: 'Aucune plage pour l’instant.' })
    expect(rootTag(html)).not.toContain('role=')
    expect(textOf(html)).toBe('Aucune plage pour l’instant.')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('class="action"')
  })

  it('vide : action facultative sous le texte, carte à la demande', async () => {
    const html = await render(StatusBlock, { state: 'empty', text: 'Aucun enfant.', card: true }, { action: () => h('a', { href: '/espace/enfant/nouveau' }, 'Ajouter un enfant') })
    expect(classesOf(rootTag(html))).toContain('card')
    expect(html).toMatch(/<p class="label"[^>]*>Aucun enfant\.<\/p><div class="action"[^>]*><a href="\/espace\/enfant\/nouveau">Ajouter un enfant<\/a><\/div>/)
  })
})
