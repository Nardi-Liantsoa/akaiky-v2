<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import LoadError from '../../components/family/LoadError.vue'
import ChildAvatar from '../../components/parent/ChildAvatar.vue'
import ChildSwitcher from '../../components/parent/ChildSwitcher.vue'
import BackLink from '../../components/ui/BackLink.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'
import { DESKTOP, useMediaQuery } from '../../composables/useMediaQuery'
import { useT } from '../../composables/useT'
import SettingsView from './SettingsView.vue'
import { sectionTitle, SETTINGS_SECTIONS } from '../../lib/settingsSections'
import { children, loadChildren, selectedChild } from '../../store/children'
import { loadContacts } from '../../store/contacts'
import { canManage, family, loadFamily } from '../../store/family'

// Cadre de Réglages (NAR-185), commun au résumé et aux pages de section : enfant affiché
// (sélecteur en haut, même sélection partout), un seul bloc de chargement pour la famille
// puis les enfants, contacts de l'enfant (résumé, section Contacts, alerte des plages).
const t = useT()
const route = useRoute()
const router = useRouter()
// Ordinateur (NAR-223, maquette 05) : maître/détail. La liste des sections reste montée à
// gauche (rien n'est relu en changeant de section), la section ouverte à droite ; chaque
// section garde son adresse. « Réglages » seul ouvre la première section, sans entrée
// d'historique de plus. Téléphone et tablette : une page par section, comme avant.
const desktop = useMediaQuery(DESKTOP)
watch(() => [desktop.value, route.name] as const, ([wide, name]) => {
  if (wide && name === 'reglages') void router.replace({ name: SETTINGS_SECTIONS[0].route })
}, { immediate: true })
const current = computed(selectedChild)
const section = computed(() => route.meta.settingsSection)
// Page d'une section : sa carte porte le h1. Tant qu'elle n'est pas affichée (chargement,
// erreur, aucun enfant), le cadre le pose lui-même : un h1 par page, toujours.
const showsCard = computed(() => family.status === 'ready' && children.status === 'ready' && !!current.value)
const heading = computed(() => (section.value ? sectionTitle(section.value, t.value) : t.value.parent.settings.title))

onMounted(() => { void loadFamily() })
watch(() => family.status, (s) => { if (s === 'ready') void loadChildren(true) }, { immediate: true })
// Contacts de l'enfant sélectionné, relus à chaque arrivée dans Réglages et à chaque changement d'enfant.
watch(() => current.value?.id, (id) => { if (id) void loadContacts(id, true) }, { immediate: true })
</script>

<template>
  <LoadError v-if="family.status === 'error'" />
  <!-- Un seul arbre pour le téléphone et l'ordinateur (NAR-223) : passer 1024 px (tablette
       tournée) ne recrée ni la liste ni la section ouverte, la saisie en cours reste. -->
  <section v-else class="settings" :class="{ desktop }">
    <header v-if="desktop" class="head">
      <h1>{{ t.parent.settings.title }}</h1>
      <span v-if="showsCard && current" class="head-switch"><ChildSwitcher v-if="children.items.length > 1" /><span v-else class="only-child"><ChildAvatar :name="current.firstName" :color="current.avatarColor" :size="32" />{{ current.firstName }}</span></span>
    </header>
    <!-- Téléphone : sélecteur d'enfant à droite du titre (ou du retour dans une section), sur la
         même ligne, comme sur ordinateur et dans le journal (NAR-231). -->
    <template v-else>
      <div v-if="section" class="head back-row">
        <BackLink :to="{ name: 'reglages' }" :label="t.parent.settings.back" :aria-label="t.parent.settings.backLabel" />
        <span v-if="showsCard && current" class="head-switch"><ChildSwitcher v-if="children.items.length > 1" /><span v-else class="only-child"><ChildAvatar :name="current.firstName" :color="current.avatarColor" :size="32" />{{ current.firstName }}</span></span>
      </div>
      <div v-if="!section" class="head">
        <h1>{{ heading }}</h1>
        <span v-if="showsCard && current" class="head-switch"><ChildSwitcher v-if="children.items.length > 1" /><span v-else class="only-child"><ChildAvatar :name="current.firstName" :color="current.avatarColor" :size="32" />{{ current.firstName }}</span></span>
      </div>
      <h1 v-else-if="!showsCard">{{ heading }}</h1>
    </template>
    <StatusBlock v-if="family.status === 'ready' && children.status === 'error'" state="error" :text="t.children.loadError" @retry="loadChildren(true)" />
    <template v-else-if="family.status === 'ready' && children.status === 'ready'">
      <StatusBlock v-if="!children.items.length" state="empty" card :text="t.contacts.noChild">
        <template v-if="canManage()" #action>
          <RouterLink class="btn" :to="{ name: 'enfant-nouveau' }">{{ t.children.add }}</RouterLink>
        </template>
      </StatusBlock>
      <div v-else-if="current" class="body">
        <div v-if="desktop" class="master"><SettingsView :child="current" /></div>
        <div class="detail">
          <RouterView v-if="!desktop || route.name !== 'reglages'" :child="current" v-bind="section ? { level: desktop ? 2 : 1 } : {}" />
        </div>
      </div>
    </template>
    <StatusBlock v-else state="loading" fill />
  </section>
</template>

<style scoped>
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  /* Un vrai écart entre le sélecteur d'enfant et les cartes (NAR-232). */
  margin-bottom: var(--space-5);
}
.head h1 {
  margin: 0;
}
/* Un seul enfant : son nom à la place du sélecteur (Réglages dit toujours de qui il s'agit). */
.only-child {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 800;
}
.head-switch {
  margin-left: auto;
}
.head-switch :deep(.switch) {
  margin-bottom: 0;
}
.back-row {
  margin-bottom: var(--space-5);
}
.back-row :deep(.back) {
  margin: 0;
}
.desktop .body {
  display: grid;
  grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
  align-items: start;
  gap: var(--space-5);
}
.master {
  position: sticky;
  /* Tablette native : sous la barre d'état. */
  top: calc(var(--space-5) + var(--safe-top));
}
.back-row + h1 {
  margin: 0 0 var(--space-4);
}
</style>
