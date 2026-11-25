<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getChildStatus, type AlertKind, type DeviceStatusInfo } from '../../api/devices'
import { locale, useT } from '../../composables/useT'
import { relativeTime } from '../../lib/format'
import AppIcon from '../ui/AppIcon.vue'
import type { IconName } from '../ui/icons'

// État du téléphone sur la carte de l'enfant (NAR-147, maquette écran 6) : bandeau par
// alerte ouverte, tuiles Batterie · Réseau · Carte SIM. Relu chaque minute et au retour au
// premier plan ; pendant une relecture, le contenu connu reste affiché (estompé seulement
// s'il appartient à un autre enfant), jamais de clignotement.
// NAR-193 : un seul bandeau (le plus grave) ; « +N » (bouton à aria-expanded) déplie les autres.
// NAR-192 : chaque bandeau et chaque tuile en défaut portent une icône (jamais la couleur
// seule) ; le dernier passage est dans la ligne d'état de la carte, qui reçoit les alertes
// lues ici (`alerts`) pour sa pastille, sans second chargement : `null` tant que l'état
// n'est pas lu, après un échec (jamais un « Tout va bien » périmé) et sans aucun relevé
// (« Pas encore de nouvelles » ne vaut pas « Tout va bien »). Pendant le premier
// chargement, la hauteur des tuiles est réservée : la carte ne saute pas.
const props = defineProps<{ childId: string, name: string }>()
const emit = defineEmits<{ alerts: [kinds: AlertKind[] | null] }>()
const t = useT()
const devices = ref<DeviceStatusInfo[]>([])
const status = ref<'loading' | 'ready' | 'error'>('loading')
const loadedFor = ref<string | null>(null)
const reloading = ref(false)
const now = ref(new Date())
let generation = 0

async function load() {
  const mine = ++generation
  const childId = props.childId
  try {
    const res = await getChildStatus(childId)
    if (mine !== generation) return
    devices.value = res.devices
    loadedFor.value = childId
    status.value = 'ready'
    emit('alerts', res.devices.some((d) => d.statusAt) ? res.devices.flatMap((d) => d.alerts.map((a) => a.kind)) : null)
  } catch {
    if (mine !== generation) return
    emit('alerts', null)
    // Relevés d'un autre enfant : jamais affichés. Sinon les derniers connus restent.
    if (loadedFor.value !== childId) { devices.value = []; status.value = 'error' }
  } finally {
    // Relecture plus récente en cours : c'est elle qui lèvera `reloading`.
    if (mine === generation) { now.value = new Date(); reloading.value = false }
  }
}
watch(() => props.childId, () => {
  // Montage ou autre enfant : les alertes connues (ancien téléphone, autre enfant) ne valent plus.
  emit('alerts', null)
  reloading.value = true
  void load()
}, { immediate: true })
const timer = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60_000)
const onVisible = () => { if (document.visibilityState === 'visible') void load() }
document.addEventListener('visibilitychange', onVisible)
onBeforeUnmount(() => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); generation++ })

// Les plus graves d'abord : silence, carte SIM, batterie.
const ORDER: AlertKind[] = ['silent', 'sim_absent', 'battery_low']
// Rouge : le téléphone ne répond plus ; jaune : batterie faible, carte SIM absente.
const BANNER: Record<AlertKind, { icon: IconName, tone: 'alert' | 'warn' }> = {
  silent: { icon: 'cross', tone: 'alert' },
  sim_absent: { icon: 'sim', tone: 'warn' },
  battery_low: { icon: 'warning', tone: 'warn' }
}
const alerts = computed(() => devices.value
  .flatMap((d) => d.alerts.map((a) => ({ ...a, deviceId: d.id })))
  .filter((a) => ORDER.includes(a.kind))
  .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)))
// Autres alertes repliées par défaut ; repliées aussi pour un autre enfant ou s'il n'en reste qu'une.
const showAll = ref(false)
watch(() => props.childId, () => { showAll.value = false })
watch(() => alerts.value.length, (n) => { if (n < 2) showAll.value = false })
const stale = computed(() => reloading.value && loadedFor.value !== props.childId)
const ago = (iso: string | null) => relativeTime(iso, t.value, locale.value, now.value)
const battery = (d: DeviceStatusInfo) => d.batteryPct === null ? t.value.phoneState.unknown : t.value.phoneState.percent(d.batteryPct)
const network = (d: DeviceStatusInfo) => d.network && d.network !== 'unknown' ? t.value.phoneState.networks[d.network] : t.value.phoneState.unknown
const lowBattery = (d: DeviceStatusInfo) => d.batteryPct !== null && d.batteryPct < 15 && !d.charging
// Titre du bandeau (maquette 01) : « Batterie faible · 12 % » quand le relevé est connu.
function alertTitle(a: { kind: AlertKind, deviceId: string }) {
  const title = t.value.phoneState.alerts[a.kind]
  const pct = a.kind === 'battery_low' ? devices.value.find((d) => d.id === a.deviceId)?.batteryPct : null
  return pct === null || pct === undefined ? title : `${title} · ${t.value.phoneState.percent(pct)}`
}
</script>

<template>
  <!-- Premier chargement : même gabarit que l'état chargé (actions, puis pastilles vides cachées
       aux lecteurs d'écran) : la carte ne bouge pas quand l'état arrive. -->
  <div v-if="status === 'loading'" class="phone-state">
    <slot name="actions" />
    <div class="device" aria-hidden="true">
      <dl class="tiles placeholder">
        <div v-for="i in 3" :key="i" class="tile">
          <dd>&nbsp;</dd>
        </div>
      </dl>
    </div>
  </div>
  <section
    v-else-if="devices.length || status === 'error'" class="phone-state" :class="{ stale }" :aria-busy="reloading"
    :aria-label="t.phoneState.label(name)"
  >
    <p v-if="status === 'error'" class="unavailable">{{ t.phoneState.loadError }}</p>
    <!-- NAR-193 : un seul bandeau, l'alerte la plus grave ; « +N » déplie les autres. -->
    <div v-if="alerts.length" class="alerts">
      <div class="top">
        <div v-for="a in alerts.slice(0, 1)" :key="`${a.deviceId}-${a.kind}`" class="banner" :class="BANNER[a.kind].tone" role="alert">
          <AppIcon :name="BANNER[a.kind].icon" :size="22" class="icon" />
          <span class="text">
            <strong>{{ alertTitle(a) }}</strong>
            <span class="since">{{ t.phoneState.since(ago(a.openedAt)) }}. {{ t.phoneState.hints[a.kind] }}</span>
          </span>
        </div>
        <button
          v-if="alerts.length > 1" type="button" class="more-alerts" :aria-expanded="showAll" :aria-controls="`alerts-${childId}`"
          @click="showAll = !showAll"
        >
          <!-- Nommé « +2 autres alertes » : le texte visible fait partie du nom. -->
          <span>+{{ alerts.length - 1 }}</span>
          <span class="visually-hidden">{{ ` ${t.phoneState.moreAlerts(alerts.length - 1)}` }}</span>
          <AppIcon name="chevron-right" :size="18" class="chevron" />
        </button>
      </div>
      <ul v-if="alerts.length > 1" v-show="showAll" :id="`alerts-${childId}`" class="others">
        <li v-for="a in alerts.slice(1)" :key="`${a.deviceId}-${a.kind}`" class="banner" :class="BANNER[a.kind].tone">
          <AppIcon :name="BANNER[a.kind].icon" :size="22" class="icon" />
          <span class="text">
            <strong>{{ alertTitle(a) }}</strong>
            <span class="since">{{ t.phoneState.since(ago(a.openedAt)) }}. {{ t.phoneState.hints[a.kind] }}</span>
          </span>
        </li>
      </ul>
    </div>
    <!-- Actions de la carte (Appeler, Message ; maquette 01, NAR-227) : sous le bandeau, au-dessus des pastilles. -->
    <slot name="actions" />
    <div v-for="d in devices" :key="d.id" class="device">
      <p v-if="devices.length > 1 && d.model" class="model">{{ d.model }}</p>
      <template v-if="d.statusAt">
        <!-- Pastilles compactes (maquette 01, NAR-227) : icône et valeur ; le libellé reste lu (dt).
             Pastille en défaut : en rouge, comme la maquette ; le bandeau d'alerte au-dessus la nomme en toutes lettres. -->
        <dl class="tiles">
          <div class="tile" :class="{ low: lowBattery(d) }">
            <dt class="visually-hidden">{{ t.phoneState.battery }}</dt>
            <dd><AppIcon name="battery" :size="18" class="icon" />{{ battery(d) }}<span v-if="d.charging" class="extra"> · {{ t.phoneState.charging }}</span></dd>
          </div>
          <div class="tile" :class="{ low: d.network === 'none' }">
            <dt class="visually-hidden">{{ t.phoneState.network }}</dt>
            <dd><AppIcon name="signal" :size="18" class="icon" />{{ network(d) }}</dd>
          </div>
          <div class="tile" :class="{ low: d.simState === 'absent' }">
            <dt class="visually-hidden">{{ t.phoneState.sim }}</dt>
            <dd><AppIcon name="sim" :size="18" class="icon" />{{ t.phoneState.simChip[d.simState ?? 'unknown'] }}</dd>
          </div>
        </dl>
      </template>
      <p v-else class="seen">{{ t.phoneState.noSignal }}</p>
    </div>
  </section>
  <!-- Pas encore de relevé : la carte garde ses actions (Appeler, Message). -->
  <slot v-else name="actions" />
</template>

<style scoped>
.phone-state {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 8px 0 4px;
  transition: opacity 0.15s;
}
.stale {
  opacity: 0.45;
  pointer-events: none;
}
.alerts,
.others {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.top {
  display: flex;
  align-items: stretch;
  gap: 8px;
}
.top .banner {
  flex: 1;
  min-width: 0;
}
/* « +N » : cible ≥ 48 px, chevron vers le bas replié, vers le haut déplié. */
.more-alerts {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: var(--tap);
  min-height: var(--tap);
  padding: 0 8px 0 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}
.more-alerts .chevron {
  transform: rotate(90deg);
  transition: transform 0.15s;
}
.more-alerts[aria-expanded='true'] .chevron {
  transform: rotate(-90deg);
}
.more-alerts:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
.banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  color: var(--ink);
}
.banner .text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.banner .icon {
  flex: none;
  margin-top: 1px;
}
.banner.alert .icon {
  color: var(--sos);
}
.banner.warn .icon {
  color: var(--warning-ink);
}
.banner.alert {
  background: color-mix(in srgb, var(--sos) 14%, var(--surface-card));
  box-shadow: inset 4px 0 0 var(--sos);
}
.banner.warn {
  background: var(--tint-butter);
  box-shadow: inset 4px 0 0 var(--accent-yellow);
}
.since,
.seen,
.unavailable,
.model {
  color: var(--ink-soft);
  font-size: 0.9rem;
  font-weight: 700;
}
.seen,
.unavailable,
.model {
  margin: 0;
}
.device {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}
.tile {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 40px;
  padding: 6px 4px;
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
}
.tile dd {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: var(--ink);
  font-size: 0.95rem;
  font-weight: 800;
  white-space: nowrap;
}
.tile.low dd {
  color: var(--sos);
}
.tile dd .icon {
  flex: none;
  margin-right: 4px;
}
.extra {
  font-weight: 700;
  font-size: 0.85rem;
}
</style>
