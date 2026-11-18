import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Garde-fou de configuration (NAR-161) : la version minimale de WebView exigée par
// Capacitor doit suivre la cible Chrome du bundle. Sinon un WebView entre les deux
// lance l'app et affiche un écran blanc, au lieu de l'écran de repli.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('WebView minimal', () => {
  it('android.minWebViewVersion = cible Chrome du bundle, et au moins 64', () => {
    const chrome = /modernTargets:\s*'[^']*chrome\s*>=\s*(\d+)/.exec(read('../../vite.config.ts'))?.[1]
    const min = /minWebViewVersion:\s*(\d+)/.exec(read('../../capacitor.config.ts'))?.[1]
    expect(chrome).toBeDefined()
    expect(min).toBe(chrome)
    // Plancher de la syntaxe que le bundle garde telle quelle : import() (Chrome 63) et
    // import.meta (Chrome 64), que la compilation (oxc, Vite 8) n'abaisse pas, quelle que soit la cible.
    expect(Number(min)).toBeGreaterThanOrEqual(64)
  })

  it('écran de repli déclaré et présent, sans script', () => {
    const path = /errorPath:\s*'([^']+)'/.exec(read('../../capacitor.config.ts'))?.[1]
    expect(path).toBe('webview.html')
    const html = read(`../../public/${path}`)
    expect(html).not.toMatch(/<script/i)
    for (const lang of ['mg', 'fr', 'en']) expect(html).toMatch(new RegExp(`<section[^>]*\\blang="${lang}"`))
  })
})
