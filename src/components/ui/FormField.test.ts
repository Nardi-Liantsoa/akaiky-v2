import { describe, expect, it } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import FormField, { type FieldControl } from './FormField.vue'

// Rendu serveur de Vue : le HTML produit est celui que monte le navigateur, sans DOM simulé.
// Le champ est fourni par l'emplacement, comme dans les écrans (v-bind="control").
async function render(props: Record<string, unknown>) {
  const out = await renderToString(createSSRApp({
    render: () => h(FormField as Component, { label: 'Adresse e-mail', ...props }, {
      default: ({ control }: { control: FieldControl }) => h('input', { ...control, class: 'input', type: 'email', autocomplete: 'email' })
    })
  }))
  return out.replace(/<!--[^>]*-->/g, '').replace(/ data-v-[0-9a-f]+/g, '')
}
const inputTag = (out: string) => out.match(/<input[^>]*>/)?.[0] ?? ''
const attr = (tag: string, name: string) => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1]

describe('FormField', () => {
  it('libellé relié au champ par for/id ; attributs du champ gardés', async () => {
    const out = await render({ id: 'email' })
    expect(out).toContain('<label for="email">Adresse e-mail</label>')
    const input = inputTag(out)
    expect(attr(input, 'id')).toBe('email')
    expect(attr(input, 'autocomplete')).toBe('email')
    expect(attr(input, 'aria-describedby')).toBeUndefined()
    expect(attr(input, 'aria-invalid')).toBeUndefined()
  })

  it('sans id fourni : un id généré relie quand même libellé et champ', async () => {
    const out = await render({})
    const id = attr(inputTag(out), 'id')
    expect(id).toBeTruthy()
    expect(out).toContain(`<label for="${id}">`)
  })

  it('aide reliée par aria-describedby, sans aria-invalid', async () => {
    const out = await render({ id: 'password', help: '8 caractères au moins.' })
    expect(attr(inputTag(out), 'aria-describedby')).toBe('password-help')
    expect(attr(inputTag(out), 'aria-invalid')).toBeUndefined()
    expect(out).toContain('<p id="password-help" class="field-help">8 caractères au moins.</p>')
  })

  it('erreur : aria-invalid et aria-describedby vers l’aide puis l’erreur', async () => {
    const out = await render({ id: 'template-1', help: 'Texte court.', error: '40 caractères au plus.' })
    const input = inputTag(out)
    expect(attr(input, 'aria-invalid')).toBe('true')
    expect(attr(input, 'aria-describedby')).toBe('template-1-help template-1-error')
    expect(out).toContain('<p id="template-1-error" class="field-error">40 caractères au plus.</p>')
    expect(out.match(/^<div class="([^"]*)"/)?.[1].split(' ')).toEqual(['field', 'invalid'])
  })

  it('libellé, champ, aide puis erreur, dans cet ordre', async () => {
    const out = await render({ id: 'x', help: 'Aide', error: 'Erreur' })
    expect(out.indexOf('<label')).toBeLessThan(out.indexOf('<input'))
    expect(out.indexOf('<input')).toBeLessThan(out.indexOf('field-help'))
    expect(out.indexOf('field-help')).toBeLessThan(out.indexOf('field-error'))
  })
})
