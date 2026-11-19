import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import AppButton from './AppButton.vue'

// Rendu serveur de Vue : le HTML produit est celui que monte le navigateur, sans DOM simulé.
async function render(props: Record<string, unknown> = {}, label = 'Valider') {
  const html = await renderToString(createSSRApp({ render: () => h(AppButton, props, () => label) }))
  const tag = html.match(/^<button[^>]*>/)?.[0] ?? ''
  const classes = (tag.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean)
  return { html, tag, classes }
}

describe('AppButton', () => {
  it('est un <button type="button"> par défaut, avec le contenu de l’emplacement', async () => {
    const { html, tag, classes } = await render()
    expect(tag).toContain('type="button"')
    expect(classes).toEqual(['btn'])
    expect(html.replace(/<!--[^>]*-->/g, '')).toContain('>Valider</button>')
  })

  it('garde le type demandé', async () => {
    expect((await render({ type: 'submit' })).tag).toContain('type="submit"')
  })

  it.each([
    ['ghost', 'btn-ghost'],
    ['danger', 'btn-danger'],
    ['link', 'btn-link'],
    ['danger-link', 'btn-danger-link']
  ])('variante %s : classe %s en plus de .btn', async (variant, cls) => {
    const { classes } = await render({ variant })
    expect(classes).toEqual(['btn', cls])
  })

  it('petite taille et pleine largeur se combinent avec une variante', async () => {
    const { classes } = await render({ variant: 'danger', small: true, block: true })
    expect(classes).toEqual(['btn', 'btn-danger', 'btn-small', 'btn-block'])
  })

  it('désactivé : attribut disabled posé, absent sinon', async () => {
    expect((await render({ disabled: true })).tag).toMatch(/\sdisabled(\s|>|=)/)
    expect((await render()).tag).not.toMatch(/\sdisabled/)
  })

  it('transmet les attributs non déclarés (nom accessible, état)', async () => {
    const { tag } = await render({ 'aria-label': 'Fermer', 'aria-expanded': 'false' })
    expect(tag).toContain('aria-label="Fermer"')
    expect(tag).toContain('aria-expanded="false"')
  })
})
