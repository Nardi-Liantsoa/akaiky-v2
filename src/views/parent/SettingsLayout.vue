<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import LoadError from '../../components/family/LoadError.vue'
import ChildSwitcher from '../../components/parent/ChildSwitcher.vue'
import BackLink from '../../components/ui/BackLink.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'
import { useT } from '../../composables/useT'
import { sectionTitle } from '../../lib/settingsSections'
import { children, loadChildren, selectedChild } from '../../store/children'
import { loadContacts } from '../../store/contacts'
import { canManage, family, loadFamily } from '../../store/family'

// Cadre de Réglages (NAR-185), commun au résumé et aux pages de section : enfant affiché
// (sélecteur en haut, même sélection partout), un seul bloc de chargement pour la famille
// puis les enfants, contacts de l'enfant (résumé, section Contacts, alerte des plages).
const t = useT()
const route = useRoute()
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
  <section v-else class="settings">
    <BackLink v-if="section" :to="{ name: 'reglages' }" :label="t.parent.settings.back" :aria-label="t.parent.settings.backLabel" />
    <p v-if="current" class="over">{{ t.contacts.phoneOf(current.firstName) }}</p>
    <h1 v-if="!section || !showsCard">{{ heading }}</h1>
    <StatusBlock v-if="family.status === 'ready' && children.status === 'error'" state="error" :text="t.children.loadError" @retry="loadChildren(true)" />
    <template v-else-if="family.status === 'ready' && children.status === 'ready'">
      <StatusBlock v-if="!children.items.length" state="empty" card :text="t.contacts.noChild">
        <template v-if="canManage()" #action>
          <RouterLink class="btn" :to="{ name: 'enfant-nouveau' }">{{ t.children.add }}</RouterLink>
        </template>
      </StatusBlock>
      <template v-else-if="current">
        <ChildSwitcher v-if="children.items.length > 1" />
        <RouterView :child="current" />
      </template>
    </template>
    <StatusBlock v-else state="loading" fill />
  </section>
</template>

<style scoped>
.over {
  margin: var(--space-2) 0 0;
  color: var(--text-soft);
  font-weight: 700;
}
.back + .over {
  margin: 0 0 var(--space-3);
}
h1 {
  margin: 0 0 var(--space-4);
}
</style>
