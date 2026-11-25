<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { locale } from '../../composables/useT'
import { formatClock, formatLongDate } from '../../lib/format'

// Heure et date (maquette allégée, NAR-237) : 44 px, alignées à gauche ; ni réseau ni batterie,
// déjà dans la barre système. L'emplacement par défaut se place à droite (cadenas du code parent).
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

</script>

<template>
  <header class="status">
    <div>
      <p class="clock">{{ formatClock(now) }}</p>
      <p class="date">{{ formatLongDate(now, locale) }}</p>
    </div>
    <slot />
  </header>
</template>

<style scoped>
.status {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.clock {
  margin: 0;
  font-size: 2.75rem;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.date {
  margin: 4px 0 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-soft);
}
</style>
