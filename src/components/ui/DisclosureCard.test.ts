import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import DisclosureCard from './DisclosureCard.vue'

const render = (props: { title: string, summary?: string, open?: boolean }) =>
  renderToString(createSSRApp({ render: () => h(DisclosureCard, props, () => 'contenu') }))

describe('DisclosureCard', () => {
  it('<details> natif : titre et résumé dans <summary>, contenu dessous', async () => {
    const html = await render({ title: 'Membres et invitations', summary: '2 membres' })
    expect(html).toMatch(/<details class="card disclosure"[^>]*>/)
    expect(html).toMatch(/<summary[^>]*>.*<h2 class="title"[^>]*>Membres et invitations<\/h2>.*2 membres.*<\/summary>/s)
    expect(html).toContain('contenu')
    expect(html).not.toMatch(/<details[^>]* open/)
  })
  it('open : dépliée au premier affichage', async () => {
    expect(await render({ title: 'Membres', open: true })).toMatch(/<details[^>]* open/)
  })
})
