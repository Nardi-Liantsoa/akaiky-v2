import { describe, expect, it } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ToggleSwitch from './ToggleSwitch.vue'

// Rendu serveur de Vue : le HTML produit est celui que monte le navigateur, sans DOM simulé.
async function html(props: Record<string, unknown>) {
  const out = await renderToString(createSSRApp({ render: () => h(ToggleSwitch as Component, { label: 'Sirène pendant un SOS', ...props }) }))
  return out.replace(/<!--[^>]*-->/g, '').replace(/ data-v-[0-9a-f]+/g, '')
}
const buttonTag = (out: string) => out.match(/<button[^>]*>/)?.[0] ?? ''
const attr = (tag: string, name: string) => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1]

// Le clic (v-model contrôlé, désactivé) est joué par les e2e sos-settings et schedules :
// les composants compilés pour le rendu serveur ne se montent pas sans navigateur.

describe('ToggleSwitch', () => {
  it('bouton role="switch", type="button", aria-checked suit la valeur', async () => {
    const off = buttonTag(await html({ modelValue: false }))
    expect(attr(off, 'role')).toBe('switch')
    expect(attr(off, 'type')).toBe('button')
    expect(attr(off, 'aria-checked')).toBe('false')
    expect(attr(buttonTag(await html({ modelValue: true })), 'aria-checked')).toBe('true')
  })

  it('nommé par son libellé visible, dans le bouton ; dessin décoratif', async () => {
    const out = await html({ modelValue: false })
    expect(out).toMatch(/<button[^>]*><span class="switch-label">Sirène pendant un SOS<\/span><span class="track" aria-hidden="true">/)
    expect(attr(buttonTag(out), 'aria-label')).toBeUndefined()
  })

  it('libellé caché : réservé aux lecteurs d’écran, toujours le nom du bouton', async () => {
    const out = await html({ modelValue: true, hideLabel: true, label: 'Plage « École » active' })
    const label = out.match(/<button[^>]*><span class="([^"]*)">([^<]*)<\/span>/)
    expect(label?.[1].split(' ').sort()).toEqual(['switch-label', 'visually-hidden'])
    expect(label?.[2]).toBe('Plage « École » active')
  })

  it('description reliée par aria-describedby ; aucune sans description', async () => {
    const out = await html({ modelValue: false, description: 'Sonne fort pendant 2 minutes.' })
    const id = attr(buttonTag(out), 'aria-describedby')
    expect(id).toBeTruthy()
    expect(out).toContain(`<p id="${id}" class="help switch-description">Sonne fort pendant 2 minutes.</p>`)
    expect(attr(buttonTag(await html({ modelValue: false })), 'aria-describedby')).toBeUndefined()
  })

  it('désactivé : attribut disabled sur le bouton', async () => {
    expect(buttonTag(await html({ modelValue: false, disabled: true }))).toMatch(/ disabled(=""|\s|>)/)
    expect(buttonTag(await html({ modelValue: false }))).not.toContain('disabled')
  })

  it('attributs passés au bouton, pas au cadre', async () => {
    const out = await html({ modelValue: false, 'data-test': 'siren' })
    expect(attr(buttonTag(out), 'data-test')).toBe('siren')
    expect(out.match(/^<div[^>]*>/)?.[0]).not.toContain('data-test')
  })
})
