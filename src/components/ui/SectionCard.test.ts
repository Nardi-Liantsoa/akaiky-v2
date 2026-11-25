import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SectionCard from './SectionCard.vue'

const render = (props: { title: string, level?: 1 | 2, icon?: 'bell' }) => renderToString(createSSRApp({ render: () => h(SectionCard, props, () => 'contenu') }))

describe('SectionCard', () => {
  it('titre en h2 par défaut, qui nomme la section', async () => {
    const html = await render({ title: 'SOS' })
    const id = html.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(html).toMatch(new RegExp(`<h2 id="${id}" class="section-title"[^>]*>(<!--v-if-->)?SOS</h2>`))
  })

  it('level 1 : titre de la page (section de Réglages ouverte seule)', async () => {
    const html = await render({ title: 'SOS', level: 1 })
    expect(html).toMatch(/<h1 id="[^"]+" class="section-title"[^>]*>(<!--v-if-->)?SOS<\/h1>/)
    expect(html).not.toContain('<h2')
  })

  it('icon : pastille décorative avant le titre, le nom de la section reste le texte (NAR-228)', async () => {
    const html = await render({ title: 'Notifications', icon: 'bell' })
    expect(html).toMatch(/<h2[^>]*><span class="title-icon" aria-hidden="true"[^>]*><svg[^>]*>.*<\/svg><\/span>Notifications<\/h2>/s)
  })
})
