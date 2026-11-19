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
import StatusBlock from '../../components/ui/StatusBlock.vue'

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
  <!-- Un seul bloc de chargement pour la famille puis les enfants : annoncé une fois. -->
  <section v-else>
    <p v-if="current" class="over">{{ t.contacts.phoneOf(current.firstName) }}</p>
    <h1>{{ t.parent.settings.title }}</h1>
    <StatusBlock v-if="family.status === 'ready' && children.status === 'error'" state="error" :text="t.children.loadError" @retry="loadChildren(true)" />
    <template v-else-if="family.status === 'ready' && children.status === 'ready'">
      <StatusBlock v-if="!children.items.length" state="empty" card :text="t.contacts.noChild">
        <template v-if="canManage()" #action>
          <RouterLink class="btn" :to="{ name: 'enfant-nouveau' }">{{ t.children.add }}</RouterLink>
        </template>
      </StatusBlock>
      <template v-else-if="current">
        <ChildSwitcher v-if="children.items.length > 1" />
        <StatusBlock
          v-if="contacts.status === 'error'" state="error"
          :text="`${t.contacts.loadError} ${contactErrorText(contacts.error, t)}`" @retry="loadContacts(current.id, true)"
        />
        <!-- Liste de cet enfant, ou celle d'avant estompée pendant le chargement (pas de clignement). -->
        <template v-else>
          <!-- Relecture en échec : la liste affichée peut être périmée, on le dit. -->
          <StatusBlock
            v-if="contacts.error && contacts.childId === current.id" state="error"
            :text="`${t.contacts.loadError} ${contactErrorText(contacts.error, t)}`" @retry="loadContacts(current.id, true)"
          />
          <ContactsCard :child-id="current.id" />
        </template>
        <AllowedAppsCard :child-id="current.id" />
        <ParentCodeCard :child="current" />
        <ScheduleCard :child-id="current.id" />
        <SosCard :child="current" />
        <MessageTemplatesCard :child-id="current.id" />
      </template>
    </template>
    <StatusBlock v-else state="loading" fill />
  </section>
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
</style>
