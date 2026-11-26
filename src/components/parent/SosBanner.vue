<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { activeSos, type SosSummary } from '../../api/sos'
import { useT } from '../../composables/useT'
import { shortDuration } from '../../lib/sosTime'
import { children, loadChildren } from '../../store/children'
import { family } from '../../store/family'
import AppIcon from '../ui/AppIcon.vue'

// Alertes SOS en cours de la famille (NAR-249), en haut de chaque onglet de l'app parent :
// relues toutes les 5 s (une requête pour tous les enfants), même sans notification (téléphone
// sans services Google, notifications refusées). Sur l'écran d'une alerte : les autres seulement
// (un second enfant en SOS ne passe jamais inaperçu).
const POLL_MS = 5000
// edge : posé en haut de l'écran plein de l'alerte (sous la barre d'état, avec ses marges).
defineProps<{ edge?: boolean }>()
const t = useT()
const route = useRoute()
const alerts = ref<SosSummary[]>([])
const now = ref(Date.now())
const shown = computed(() => (route.name === 'sos' ? alerts.value.filter((a) => a.id !== String(route.params.id)) : alerts.value))
const nameOf = (childId: string) => children.items.find((c) => c.id === childId)?.firstName ?? '…'

let timer: ReturnType<typeof setInterval> | undefined
async function read() {
  if (!family.data || document.visibilityState !== 'visible') return
  try {
    const { alerts: list } = await activeSos()
    alerts.value = list
    // Enfant pas encore dans la liste chargée (ajouté depuis un autre téléphone) : relue.
    if (list.some((a) => !children.items.some((c) => c.id === a.childId))) void loadChildren(true)
  } catch {
    // Hors ligne : les alertes déjà vues restent affichées.
  }
  now.value = Date.now()
}
// Famille rechargée en échec (hors ligne) : les alertes connues restent ; plus de famille : vidées.
watch(() => family.status, (s) => { if (s === 'ready') void read(); else if (s === 'none') alerts.value = [] })
// Retour au premier plan : relues tout de suite (cible : moins de 3 s entre les apps).
const onVisible = () => { if (document.visibilityState === 'visible') void read() }
onMounted(() => { void read(); timer = setInterval(() => { void read() }, POLL_MS); document.addEventListener('visibilitychange', onVisible) })
onBeforeUnmount(() => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) })
</script>

<template>
  <section v-if="shown.length" class="sos-banners" :class="{ edge }" :aria-label="t.sosAlert.bannerLabel">
    <RouterLink v-for="a in shown" :key="a.id" class="sos-banner" :class="a.status" :to="{ name: 'sos', params: { id: a.id } }" role="alert">
      <AppIcon name="alert-circle" :size="24" />
      <span class="text">
        <strong>{{ t.sosAlert.title(nameOf(a.childId)) }}</strong>
        <span>{{ a.status === 'handled' ? t.sosAlert.handledShort : t.sosAlert.ago(shortDuration(now - Date.parse(a.startedAt), t)) }}</span>
      </span>
      <span class="open">{{ t.sosAlert.open }}<AppIcon name="chevron-right" :size="20" /></span>
    </RouterLink>
  </section>
</template>

<style scoped>
.sos-banners {
  display: grid;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}
.sos-banners.edge {
  margin: 0;
  padding: calc(var(--space-2) + var(--safe-top)) calc(var(--gutter) + var(--safe-right)) var(--space-2) calc(var(--gutter) + var(--safe-left));
  background: var(--bg);
}
.sos-banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--tap);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--sos);
  color: var(--on-color);
  text-decoration: none;
}
.sos-banner.handled {
  background: var(--sos-deep);
}
.text {
  flex: 1;
  min-width: 0;
}
.text strong,
.text span {
  display: block;
}
.text span {
  font-size: var(--fs-small);
}
.open {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  font-weight: 800;
}
</style>
