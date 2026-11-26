import { describe, expect, it } from 'vitest'
import { accuracyRadius, apiAbsolute, buildStyle, initialZoom, labelLang, rewriteFontUrl } from './mapStyle'

describe('buildStyle', () => {
  it('tuiles et polices de notre API seulement, aucune autre origine', () => {
    const style = buildStyle('https://api.akaiky.test/api', 'fr')
    expect(style.glyphs).toBe('https://api.akaiky.test/api/map/fonts/{fontstack}/{range}.pbf')
    expect(style.sources.protomaps).toMatchObject({ type: 'vector', url: 'pmtiles://https://api.akaiky.test/api/map/tiles.pmtiles' })
    expect(style.sprite).toBeUndefined()
    const urls = JSON.stringify(style).match(/https?:\/\/[^"\s]+/g) ?? []
    expect(urls.every((u) => u.startsWith('https://api.akaiky.test/'))).toBe(true)
    expect(style.layers.length).toBeGreaterThan(10)
  })
})

describe('apiAbsolute', () => {
  it('web : même origine ; natif : origine compilée', () => {
    expect(apiAbsolute('/api', 'https://akaiky.mg/espace/sos/1')).toBe('https://akaiky.mg/api')
    expect(apiAbsolute('https://akaiky.mg/api', 'https://localhost/')).toBe('https://akaiky.mg/api')
  })
})

describe('rewriteFontUrl', () => {
  it('nom de police encodé → dossier sans espace ; liste : la première connue ; autre URL inchangée', () => {
    expect(rewriteFontUrl('https://a.test/api/map/fonts/Noto%20Sans%20Regular/0-255.pbf')).toBe('https://a.test/api/map/fonts/noto-sans-regular/0-255.pbf')
    expect(rewriteFontUrl('https://a.test/api/map/fonts/Inconnue%2CNoto%20Sans%20Italic/256-511.pbf')).toBe('https://a.test/api/map/fonts/noto-sans-italic/256-511.pbf')
    expect(rewriteFontUrl('https://a.test/api/map/fonts/Inconnue/0-255.pbf')).toBe('https://a.test/api/map/fonts/Inconnue/0-255.pbf')
    expect(rewriteFontUrl('https://a.test/api/map/tiles.pmtiles')).toBe('https://a.test/api/map/tiles.pmtiles')
    expect(rewriteFontUrl('https://a.test/api/map/fonts/%E0%A4%A/0-255.pbf')).toBe('https://a.test/api/map/fonts/%E0%A4%A/0-255.pbf')
  })
})

describe('accuracyRadius', () => {
  it('15 m à Antananarivo, zoom 16 : environ 13 px (1,13 m par pixel, tuiles de 512 px)', () => {
    const expr = accuracyRadius(15, -18.91) as [string, unknown, unknown, number, number, number, number]
    const r16 = expr[4] * 2 ** 16
    expect(r16).toBeGreaterThan(12.5)
    expect(r16).toBeLessThan(14)
    expect(expr[6]).toBeCloseTo(expr[4] * 2 ** 24)
  })
})

describe('zoom et langue', () => {
  it('zoom selon la précision ; noms français pour mg et fr', () => {
    expect([initialZoom(10), initialZoom(150), initialZoom(800), initialZoom(5000)]).toEqual([16, 15, 13, 11])
    expect([labelLang('mg'), labelLang('fr'), labelLang('en')]).toEqual(['fr', 'fr', 'en'])
  })
})
