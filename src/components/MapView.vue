<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { API_BASE } from '../api/base'
import { locale } from '../composables/useT'
import { colorToken, initial, type AvatarColor } from '../lib/avatar'
import { MAP_SOURCE, OSM_ATTRIBUTION, accuracyRadius, apiAbsolute, buildStyle, initialZoom, rewriteFontUrl } from '../lib/mapStyle'

// Carte de la position d'un enfant (NAR-205) : fond OpenStreetMap auto-hébergé, pastille de
// l'enfant et cercle de précision. Aucune requête vers un tiers (tuiles, polices : notre API).
// Impossible (WebGL2 absent, vieux WebView, carte non installée sur le serveur, délai) :
// `unavailable`, l'écran garde la position en texte.
// attribution : coin de la mention OpenStreetMap (en haut quand une carte la recouvre en bas, SOS).
const props = withDefaults(defineProps<{ lat: number, lng: number, accuracyM: number, name: string, color: AvatarColor, label: string, attribution?: 'top-right' | 'bottom-right' }>(), { attribution: 'bottom-right' })
const emit = defineEmits<{ unavailable: [] }>()
const box = ref<HTMLDivElement | null>(null)
const LOAD_TIMEOUT_MS = 15_000
const POINT = 'child'

let map: MapLibreMap | null = null
let marker: MapLibreMarker | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let failed = false
let loaded = false
function fail() {
  if (failed) return
  failed = true
  clearTimeout(timer)
  emit('unavailable')
}
const point = () => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [props.lng, props.lat] } })

function hasWebGl2(): boolean {
  try { return !!document.createElement('canvas').getContext('webgl2') } catch { return false }
}

onMounted(async () => {
  if (!box.value || !hasWebGl2()) { fail(); return }
  let engine: typeof import('../lib/mapEngine')
  try { engine = await import('../lib/mapEngine') } catch { fail(); return }
  if (!box.value) return
  engine.prepareEngine()
  const api = apiAbsolute(Capacitor.isNativePlatform() ? API_BASE : '/api', window.location.href)
  timer = setTimeout(fail, LOAD_TIMEOUT_MS)
  try {
    map = new engine.Map({
      container: box.value,
      style: buildStyle(api, locale.value),
      center: [props.lng, props.lat],
      zoom: initialZoom(props.accuracyM),
      maxZoom: 18,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      transformRequest: (url) => ({ url: rewriteFontUrl(url) })
    })
  } catch { fail(); return }
  // Attribution OpenStreetMap toujours visible (licence ODbL), jamais repliée.
  map.addControl(new engine.AttributionControl({ compact: false, customAttribution: OSM_ATTRIBUTION }), props.attribution)
  // Pas d'icônes (aucun sprite) : une image vide plutôt qu'un avertissement par symbole.
  map.on('styleimagemissing', (e) => { if (map && !map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) }) })
  map.on('error', (e) => {
    const status = (e.error as { status?: number } | undefined)?.status
    // Fond de carte illisible (fichier absent, refusé, réseau) avant tout affichage, WebGL perdu :
    // position en texte. Une tuile manquante après coup (zone hors de l'extrait) n'arrête rien.
    const source = (e as { sourceId?: string }).sourceId === MAP_SOURCE
    if (status === 404 || status === 403 || (source && !loaded) || !map?.isStyleLoaded()) fail()
  })
  map.on('load', () => {
    if (!map) return
    loaded = true
    clearTimeout(timer)
    map.addSource(POINT, { type: 'geojson', data: point() })
    // Couleur du jeton --sos (le style de MapLibre ne lit pas les variables CSS).
    const sos = getComputedStyle(document.documentElement).getPropertyValue('--sos').trim() || 'red'
    map.addLayer({
      id: 'accuracy', type: 'circle', source: POINT,
      paint: { 'circle-radius': accuracyRadius(props.accuracyM, props.lat), 'circle-color': sos, 'circle-opacity': 0.16, 'circle-stroke-color': sos, 'circle-stroke-opacity': 0.55, 'circle-stroke-width': 2 }
    })
    const pin = document.createElement('span')
    pin.className = 'map-pin'
    pin.textContent = initial(props.name)
    pin.style.background = colorToken(props.color)
    pin.setAttribute('aria-hidden', 'true')
    marker = new engine.Marker({ element: pin }).setLngLat([props.lng, props.lat]).addTo(map)
  })
})

// Nouvelle position (SOS : toutes les 30 s) : pastille et cercle suivent ; recentrée si elle sort de la vue.
watch(() => [props.lat, props.lng, props.accuracyM] as const, () => {
  if (!map || !map.getSource(POINT)) return
  ;(map.getSource(POINT) as GeoJSONSource).setData(point())
  map.setPaintProperty('accuracy', 'circle-radius', accuracyRadius(props.accuracyM, props.lat))
  marker?.setLngLat([props.lng, props.lat])
  if (!map.getBounds().contains([props.lng, props.lat])) map.easeTo({ center: [props.lng, props.lat] })
})

onBeforeUnmount(() => { clearTimeout(timer); map?.remove(); map = null })
</script>

<template>
  <div ref="box" class="map-view" role="img" :aria-label="label" />
</template>

<style scoped>
.map-view {
  width: 100%;
  height: 100%;
  min-height: 220px;
}
.map-view :deep(.map-pin) {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 3px solid var(--on-color);
  box-shadow: var(--shadow-float);
  color: var(--on-color);
  font-weight: 800;
  font-size: 18px;
}
.map-view :deep(.maplibregl-ctrl-attrib) {
  font-size: 11px;
}
</style>
