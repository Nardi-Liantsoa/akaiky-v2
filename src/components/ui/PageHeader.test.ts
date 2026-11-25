import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory, createRouter } from 'vue-router'
import PageHeader from './PageHeader.vue'

async function render(props: { title?: string }, aside?: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/espace', name: 'espace', component: { render: () => null } }] })
  await router.push('/espace')
  const app = createSSRApp({ render: () => h(PageHeader, { back: { name: 'espace' }, backLabel: 'Retour à l’accueil', ...props }, aside ? { aside: () => aside } : undefined) })
  app.use(router)
  return renderToString(app)
}

describe('PageHeader', () => {
  it('flèche de retour : vrai lien nommé, sans texte visible ; titre en h1', async () => {
    const html = await render({ title: 'Ajouter un enfant' })
    expect(html).toMatch(/<a href="\/espace" class="back" aria-label="Retour à l’accueil"[^>]*>/)
    expect(html).not.toMatch(/<span>Accueil<\/span>/)
    expect(html).toMatch(/<h1 class="title"[^>]*>Ajouter un enfant<\/h1>/)
  })

  it('sans titre (chargement) : pas de h1, la flèche reste', async () => {
    const html = await render({})
    expect(html).not.toContain('<h1')
    expect(html).toContain('aria-label="Retour à l’accueil"')
  })

  it('emplacement à droite pour le sélecteur d’enfant', async () => {
    expect(await render({ title: 'Contacts' }, 'Fy ▾')).toMatch(/<div class="aside"[^>]*>.*Fy ▾/)
  })
})
