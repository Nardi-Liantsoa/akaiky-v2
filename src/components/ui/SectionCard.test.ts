import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SectionCard from './SectionCard.vue'

const render = (props: { title: string, level?: 1 | 2 }) => renderToString(createSSRApp({ render: () => h(SectionCard, props, () => 'contenu') }))

describe('SectionCard', () => {
  it('titre en h2 par défaut, qui nomme la section', async () => {
    const html = await render({ title: 'SOS' })
    const id = html.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(html).toMatch(new RegExp(`<h2 id="${id}" class="section-title"[^>]*>SOS</h2>`))
  })

  it('level 1 : titre de la page (section de Réglages ouverte seule)', async () => {
    const html = await render({ title: 'SOS', level: 1 })
    expect(html).toMatch(/<h1 id="[^"]+" class="section-title"[^>]*>SOS<\/h1>/)
    expect(html).not.toContain('<h2')
  })
})
