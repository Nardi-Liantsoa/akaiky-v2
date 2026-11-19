<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getChildStatus, type AlertKind, type DeviceStatusInfo } from '../../api/devices'
import { locale, useT } from '../../composables/useT'
import { relativeTime } from '../../lib/relativeTime'

// État du téléphone sur la carte de l'enfant (NAR-147, maquette écran 6) : bandeau par
// alerte ouverte, tuiles Batterie · Réseau · Carte SIM, « Vu il y a 2 minutes ». Relu chaque
// minute et au retour au premier plan ; pendant une relecture, le contenu connu reste
// affiché (estompé seulement s'il appartient à un autre enfant), jamais de clignotement.
const props = defineProps<{ childId: string, name: string }>()
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
  } catch {
    if (mine !== generation) return
    // Relevés d'un autre enfant : jamais affichés. Sinon les derniers connus restent.
    if (loadedFor.value !== childId) { devices.value = []; status.value = 'error' }
  } finally {
    // Relecture plus récente en cours : c'est elle qui lèvera `reloading`.
    if (mine === generation) { now.value = new Date(); reloading.value = false }
  }
}
watch(() => props.childId, () => {
  reloading.value = true
  void load()
}, { immediate: true })
const timer = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60_000)
const onVisible = () => { if (document.visibilityState === 'visible') void load() }
document.addEventListener('visibilitychange', onVisible)
onBeforeUnmount(() => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); generation++ })

// Les plus graves d'abord : silence, carte SIM, batterie.
const ORDER: AlertKind[] = ['silent', 'sim_absent', 'battery_low']
const alerts = computed(() => devices.value
  .flatMap((d) => d.alerts.map((a) => ({ ...a, deviceId: d.id })))
  .filter((a) => ORDER.includes(a.kind))
  .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)))
const stale = computed(() => reloading.value && loadedFor.value !== props.childId)
const ago = (iso: string | null) => relativeTime(iso, t.value, locale.value, now.value)
const battery = (d: DeviceStatusInfo) => d.batteryPct === null ? t.value.phoneState.unknown : t.value.phoneState.percent(d.batteryPct)
const network = (d: DeviceStatusInfo) => d.network && d.network !== 'unknown' ? t.value.phoneState.networks[d.network] : t.value.phoneState.unknown
const sim = (d: DeviceStatusInfo) => t.value.phoneState.sims[d.simState ?? 'unknown']
</script>

<template>
  <section
    v-if="devices.length || status === 'error'" class="phone-state" :class="{ stale }" :aria-busy="reloading"
    :aria-label="t.phoneState.label(name)"
  >
    <p v-if="status === 'error'" class="unavailable">{{ t.phoneState.loadError }}</p>
    <ul v-if="alerts.length" class="alerts">
      <li v-for="a in alerts" :key="`${a.deviceId}-${a.kind}`" class="banner" :class="a.kind === 'battery_low' ? 'warn' : 'alert'" role="alert">
        <strong>{{ t.phoneState.alerts[a.kind](name) }}</strong>
        <span class="since">{{ t.phoneState.since(ago(a.openedAt)) }}</span>
      </li>
    </ul>
    <div v-for="d in devices" :key="d.id" class="device">
      <p v-if="devices.length > 1 && d.model" class="model">{{ d.model }}</p>
      <template v-if="d.statusAt">
        <dl class="tiles">
          <div class="tile" :class="{ low: d.batteryPct !== null && d.batteryPct < 15 && !d.charging }">
            <dt>{{ t.phoneState.battery }}</dt>
            <dd>{{ battery(d) }}<span v-if="d.charging" class="extra"> · {{ t.phoneState.charging }}</span></dd>
          </div>
          <div class="tile" :class="{ low: d.network === 'none' }">
            <dt>{{ t.phoneState.network }}</dt>
            <dd>{{ network(d) }}</dd>
          </div>
          <div class="tile" :class="{ low: d.simState === 'absent' }">
            <dt>{{ t.phoneState.sim }}</dt>
            <dd>{{ sim(d) }}</dd>
          </div>
        </dl>
        <p class="seen">{{ t.phoneState.seen(ago(d.statusAt)) }}</p>
      </template>
      <p v-else class="seen">{{ t.phoneState.noSignal }}</p>
    </div>
  </section>
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
.alerts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.banner {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  color: var(--ink);
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
  min-width: 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
}
.tile dt {
  color: var(--ink-mute);
  font-size: 0.8rem;
  font-weight: 800;
}
.tile dd {
  margin: 2px 0 0;
  color: var(--ink);
  font-weight: 900;
  overflow-wrap: anywhere;
}
.tile.low dd {
  color: var(--sos);
}
.extra {
  font-weight: 700;
  font-size: 0.85rem;
}
</style>
