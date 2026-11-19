import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'

async function render(props: { name: IconName, size?: number, label?: string }) {
  return renderToString(createSSRApp({ render: () => h(AppIcon, props) }))
}

describe('AppIcon', () => {
  it('décorative par défaut : cachée aux lecteurs d’écran, sans rôle ni nom', async () => {
    const html = await render({ name: 'phone' })
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('role=')
    expect(html).not.toContain('aria-label')
  })

  it('avec un libellé : image nommée, plus cachée', async () => {
    const html = await render({ name: 'blocked', label: 'Appel bloqué' })
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Appel bloqué"')
    expect(html).not.toContain('aria-hidden')
  })

  it('dessine les formes de l’icône nommée, 24 px par défaut', async () => {
    const html = await render({ name: 'clock' })
    expect(html).toContain('width="24" height="24"')
    expect(html).toContain('<circle cx="12" cy="12" r="9"')
    expect(html).toContain('<path d="M12 7v5l3 2"')
  })

  it('la hauteur suit le cadre d’une icône non carrée', async () => {
    const html = await render({ name: 'battery', size: 22 })
    expect(html.toLowerCase()).toContain('viewbox="0 0 24 12"')
    expect(html).toContain('width="22" height="11"')
  })
})
