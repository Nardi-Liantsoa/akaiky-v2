import { layers, namedFlavor } from '@protomaps/basemaps'
import type { StyleSpecification, ExpressionSpecification } from 'maplibre-gl'

// Style du fond de carte auto-hébergé (NAR-205) : tuiles OpenStreetMap de Madagascar (PMTiles,
// Protomaps) et polices servies par notre API (/api/map/…). Aucune URL d'un tiers : ni tuile,
// ni police, ni icône (pas de sprite). L'attribution OpenStreetMap est posée par la carte.
export const MAP_SOURCE = 'protomaps'
export const OSM_ATTRIBUTION = '© OpenStreetMap'

// Noms des polices du style → dossiers servis par l'API (sans espace : un chemin d'API
// encodé, %20, est refusé par le serveur).
const FONTS: Record<string, string> = {
  'Noto Sans Regular': 'noto-sans-regular',
  'Noto Sans Medium': 'noto-sans-medium',
  'Noto Sans Italic': 'noto-sans-italic'
}

// Adresse absolue de l'API (web : la même origine ; natif : l'origine compilée).
export function apiAbsolute(apiBase: string, here: string): string {
  return new URL(apiBase.endsWith('/') ? apiBase : `${apiBase}/`, here).href.replace(/\/$/, '')
}

// Langue des noms : malgache et français prennent les noms français (sinon le nom local).
export const labelLang = (locale: string) => (locale === 'en' ? 'en' : 'fr')

export function buildStyle(api: string, locale: string): StyleSpecification {
  return {
    version: 8,
    glyphs: `${api}/map/fonts/{fontstack}/{range}.pbf`,
    sources: {
      [MAP_SOURCE]: { type: 'vector', url: `pmtiles://${api}/map/tiles.pmtiles`, attribution: OSM_ATTRIBUTION }
    },
    layers: layers(MAP_SOURCE, namedFlavor('light'), { lang: labelLang(locale) }) as StyleSpecification['layers']
  }
}

// Requête de police : le nom (encodé par MapLibre) remplacé par son dossier ; plusieurs
// polices (« A,B ») : la première connue. Toute autre URL est rendue telle quelle.
export function rewriteFontUrl(url: string): string {
  const m = /\/map\/fonts\/([^/]+)\/(\d+-\d+\.pbf)$/.exec(url)
  if (!m) return url
  let stack: string
  try { stack = decodeURIComponent(m[1]) } catch { return url }
  const dir = stack.split(',').map((s) => FONTS[s.trim()]).find(Boolean)
  return dir ? url.slice(0, m.index) + `/map/fonts/${dir}/${m[2]}` : url
}

// Rayon du cercle de précision en pixels, selon le zoom : la précision (mètres) divisée par
// la taille d'un pixel à cette latitude (tuiles de 512 px).
export function accuracyRadius(meters: number, lat: number): ExpressionSpecification {
  const metersPerPixelZ0 = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 512
  const r0 = Math.max(0, meters) / metersPerPixelZ0
  return ['interpolate', ['exponential', 2], ['zoom'], 0, r0, 24, r0 * 2 ** 24]
}

// Zoom de départ : assez près pour la rue, assez loin pour que le cercle tienne à l'écran.
export function initialZoom(accuracyM: number): number {
  if (accuracyM <= 50) return 16
  if (accuracyM <= 200) return 15
  if (accuracyM <= 1000) return 13
  return 11
}
