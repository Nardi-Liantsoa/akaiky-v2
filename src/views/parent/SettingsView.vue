<script setup lang="ts">
import { computed, nextTick, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { RouterLink } from 'vue-router'
import LoadError from '../../components/family/LoadError.vue'
import ChildSwitcher from '../../components/parent/ChildSwitcher.vue'
import ContactsCard from '../../components/settings/ContactsCard.vue'
import ParentCodeCard from '../../components/settings/ParentCodeCard.vue'
import MessageTemplatesCard from '../../components/settings/MessageTemplatesCard.vue'
import ScheduleCard from '../../components/settings/ScheduleCard.vue'
import SosCard from '../../components/settings/SosCard.vue'
import AllowedAppsCard from '../../components/settings/AllowedAppsCard.vue'
import { useT } from '../../composables/useT'
import { contactErrorText } from '../../lib/contactErrors'
import { children, loadChildren, selectedChild } from '../../store/children'
import { contacts, loadContacts } from '../../store/contacts'
import { canManage, family, loadFamily } from '../../store/family'
import AppButton from '../../components/ui/AppButton.vue'

const t = useT()
const current = computed(selectedChild)
// Arrivée par « ⋯ › Code parent » (NAR-174) : la carte du code est amenée à l'écran.
const route = useRoute()
watch(() => [route.hash, children.status] as const, async ([hash, status]) => {
  if (hash !== '#code-parent' || status !== 'ready') return
  await nextTick()
  const card = document.getElementById('code-parent')
  card?.scrollIntoView({ block: 'start' })
  card?.focus({ preventScroll: true })
}, { immediate: true })
onMounted(() => { void loadFamily() })
watch(() => family.status, (s) => { if (s === 'ready') void loadChildren(true) }, { immediate: true })
// Contacts de l'enfant sélectionné, relus à chaque arrivée et à chaque changement d'enfant.
watch(() => current.value?.id, (id) => { if (id) void loadContacts(id, true) }, { immediate: true })
</script>

<template>
  <LoadError v-if="family.status === 'error'" />
  <section v-else-if="family.status === 'ready'">
    <p v-if="current" class="over">{{ t.contacts.phoneOf(current.firstName) }}</p>
    <h1>{{ t.parent.settings.title }}</h1>
    <div v-if="children.status === 'error'" class="error" role="alert">
      <p>{{ t.children.loadError }}</p>
      <AppButton variant="ghost" @click="loadChildren(true)">{{ t.errors.retry }}</AppButton>
    </div>
    <template v-else-if="children.status === 'ready'">
      <div v-if="!children.items.length" class="card empty">
        <p>{{ t.contacts.noChild }}</p>
        <RouterLink v-if="canManage()" class="btn" :to="{ name: 'enfant-nouveau' }">{{ t.children.add }}</RouterLink>
      </div>
      <template v-else-if="current">
        <ChildSwitcher v-if="children.items.length > 1" />
        <div v-if="contacts.status === 'error'" class="error" role="alert">
          <p>{{ t.contacts.loadError }} {{ contactErrorText(contacts.error, t) }}</p>
          <AppButton variant="ghost" @click="loadContacts(current.id, true)">{{ t.errors.retry }}</AppButton>
        </div>
        <!-- Liste de cet enfant, ou celle d'avant estompée pendant le chargement (pas de clignement). -->
        <template v-else>
          <!-- Relecture en échec : la liste affichée peut être périmée, on le dit. -->
          <div v-if="contacts.error && contacts.childId === current.id" class="error" role="alert">
            <p>{{ t.contacts.loadError }} {{ contactErrorText(contacts.error, t) }}</p>
            <AppButton variant="ghost" @click="loadContacts(current.id, true)">{{ t.errors.retry }}</AppButton>
          </div>
          <ContactsCard :child-id="current.id" />
        </template>
        <AllowedAppsCard :child-id="current.id" />
        <ParentCodeCard :child="current" />
        <ScheduleCard :child-id="current.id" />
        <SosCard :child="current" />
        <MessageTemplatesCard :child-id="current.id" />
      </template>
    </template>
    <p v-else class="loading" role="status"><span class="visually-hidden">{{ t.family.loading }}</span></p>
  </section>
  <p v-else class="loading" role="status"><span class="visually-hidden">{{ t.family.loading }}</span></p>
</template>

<style scoped>
.over {
  margin: 8px 0 0;
  color: var(--text-soft);
  font-weight: 700;
}
h1 {
  margin: 0 0 16px;
}
.empty p {
  margin: 0 0 16px;
  color: var(--text-soft);
}
.loading {
  min-height: 30vh;
  margin: 0;
}
</style>
