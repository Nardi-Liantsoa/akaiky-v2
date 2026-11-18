<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { locale, useT } from '../../composables/useT'
import { formatClock, formatLongDate } from '../../lib/format'
import type { DeviceStatus } from '../../native/akaikyDevice'

// Heure et date en grand, réseau et batterie (maquette écran 1). Valeurs natives
// relues par le parent de ce composant ; l'heure avance ici, chaque seconde utile.
const props = defineProps<{ status: DeviceStatus | null }>()
const t = useT()
const now = ref(new Date())
// Mise à jour au changement de minute, et dès que l'écran revient au premier plan.
let tick: ReturnType<typeof setTimeout> | undefined
function schedule() {
  now.value = new Date()
  clearTimeout(tick)
  tick = setTimeout(schedule, 60_000 - (now.value.getTime() % 60_000) + 50)
}
const onVisible = () => { if (document.visibilityState === 'visible') schedule() }
onMounted(() => { schedule(); document.addEventListener('visibilitychange', onVisible) })
onBeforeUnmount(() => { clearTimeout(tick); document.removeEventListener('visibilitychange', onVisible) })

const network = computed(() => {
  const n = props.status?.network
  // Sans réseau de données, rien d'affiché : les appels passent quand même par la SIM,
  // un « Pas de réseau » ferait croire le contraire.
  return n === 'wifi' ? t.value.child.status.wifi : n === 'cellular' ? t.value.child.status.cellular : ''
})
</script>

<template>
  <header class="status">
    <div class="system" aria-live="off">
      <span v-if="network" class="network">{{ network }}</span>
      <span v-if="status?.battery !== undefined" class="battery" :class="{ low: status.battery < 15 }">
        <svg viewBox="0 0 24 12" width="22" height="11" aria-hidden="true"><rect x="0.5" y="0.5" width="20" height="11" rx="2.5" fill="none" stroke="currentColor" /><rect x="21" y="3.5" width="2.5" height="5" rx="1" fill="currentColor" /><rect x="2" y="2" :width="Math.max(1, (status.battery / 100) * 17)" height="8" rx="1.5" fill="currentColor" /></svg>
        {{ t.child.status.battery(status.battery) }}
      </span>
    </div>
    <p class="clock">{{ formatClock(now) }}</p>
    <p class="date">{{ formatLongDate(now, locale) }}</p>
  </header>
</template>

<style scoped>
.status {
  text-align: center;
}
.system {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  font-size: 0.9rem;
  font-weight: 800;
  color: var(--text-soft);
}
.battery {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.battery.low {
  color: var(--sos);
}
.clock {
  margin: 8px 0 0;
  font-size: 4.2rem;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.date {
  margin: 4px 0 0;
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--text-soft);
}
</style>
