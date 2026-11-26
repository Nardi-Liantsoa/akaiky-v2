// Moteur de carte (NAR-205), chargé à la demande (import dynamique) : MapLibre 6, le
// protocole PMTiles et le style de MapLibre n'entrent pas dans le bundle de démarrage.
// Worker servi par notre origine (fichier du build) : aucun blob, la CSP reste inchangée.
import { AttributionControl, Map, Marker, addProtocol, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { Protocol } from 'pmtiles'

let ready = false
export function prepareEngine() {
  if (ready) return
  setWorkerUrl(workerUrl)
  addProtocol('pmtiles', new Protocol().tile)
  ready = true
}
export { AttributionControl, Map, Marker }
