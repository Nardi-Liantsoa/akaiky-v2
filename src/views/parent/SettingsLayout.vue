<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import LoadError from '../../components/family/LoadError.vue'
import ChildSwitcher from '../../components/parent/ChildSwitcher.vue'
import AppIcon from '../../components/ui/AppIcon.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'
import { useT } from '../../composables/useT'
import { backTo } from '../../lib/navigation'
import { sectionTitle } from '../../lib/settingsSections'
import { children, loadChildren, selectedChild } from '../../store/children'
import { loadContacts } from '../../store/contacts'
import { canManage, family, loadFamily } from '../../store/family'

// Cadre de Réglages (NAR-185), commun au résumé et aux pages de section : enfant affiché
// (sélecteur en haut, même sélection partout), un seul bloc de chargement pour la famille
// puis les enfants, contacts de l'enfant (résumé, section Contacts, alerte des plages).
const t = useT()
const route = useRoute()
const router = useRouter()
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

// Contrôle de retour d'une section : revient au résumé (comme le retour Android).
const back = () => backTo(router, { name: 'reglages' })
</script>

<template>
  <LoadError v-if="family.status === 'error'" />
  <section v-else class="settings">
    <RouterLink v-if="section" v-slot="{ href }" :to="{ name: 'reglages' }" custom>
      <a :href="href" class="back" :aria-label="t.parent.settings.backLabel" @click.prevent="back">
        <AppIcon name="chevron-left" :size="20" />
        <span>{{ t.parent.settings.back }}</span>
      </a>
    </RouterLink>
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
.back {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--tap);
  margin: calc(-1 * var(--space-2)) 0 0 calc(-1 * var(--space-2));
  padding: 0 var(--space-3) 0 var(--space-1);
  border-radius: var(--radius-pill);
  color: var(--accent);
  font-weight: 800;
  text-decoration: none;
}
.back:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
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
