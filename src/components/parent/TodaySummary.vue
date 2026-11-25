<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { getJournal, type JournalToday } from '../../api/journal'
import { useT } from '../../composables/useT'
import { selectChild } from '../../store/children'
import AppIcon from '../ui/AppIcon.vue'

// Ligne « Aujourd'hui · 3 appels, 1 bloqué › » de la carte enfant (maquette 01, NAR-227) :
// nombres du jour lus avec le journal (une lecture, limit 1), relus au retour au premier plan
// et toutes les 2 minutes tant que la page est visible (une lecture agrégée par carte : pas
// plus souvent) ; le lien ouvre le journal de CET enfant. Relecture en échec : la ligne
// reste, sans nombres (le lien vers le journal marche toujours).
const props = defineProps<{ childId: string }>()
const t = useT()
const today = ref<JournalToday | null>(null)
let generation = 0
async function load() {
  const mine = ++generation
  const page = await getJournal(props.childId, { limit: 1, counts: true }).catch(() => null)
  if (mine === generation && page?.today) today.value = page.today
}
watch(() => props.childId, () => { today.value = null; void load() }, { immediate: true })
const timer = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 120_000)
const onVisible = () => { if (document.visibilityState === 'visible') void load() }
document.addEventListener('visibilitychange', onVisible)
onBeforeUnmount(() => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) })
</script>

<template>
  <RouterLink class="today-line" :to="{ name: 'journal' }" @click="selectChild(childId)">
    <span>{{ today ? t.parent.log.todayLine(today.calls, today.blocked) : t.parent.log.todayTitle }}</span>
    <AppIcon name="chevron-right" :size="20" />
  </RouterLink>
</template>

<style scoped>
.today-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: var(--tap);
  margin-top: var(--space-2);
  border-top: 1px solid var(--border);
  color: var(--text-soft);
  font-weight: 800;
  text-decoration: none;
}
.today-line:hover {
  color: var(--text);
}
.today-line:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
</style>
