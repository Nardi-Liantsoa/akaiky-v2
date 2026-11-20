<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import type { Child } from '../../api/children'
import AllowedAppsCard from '../../components/settings/AllowedAppsCard.vue'
import ContactsCard from '../../components/settings/ContactsCard.vue'
import MessageTemplatesCard from '../../components/settings/MessageTemplatesCard.vue'
import ParentCodeCard from '../../components/settings/ParentCodeCard.vue'
import ScheduleCard from '../../components/settings/ScheduleCard.vue'
import SosCard from '../../components/settings/SosCard.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'
import { useT } from '../../composables/useT'
import { contactErrorText } from '../../lib/contactErrors'
import { contacts, loadContacts } from '../../store/contacts'

// Page d'une section de Réglages (NAR-185) : la carte de la section, inchangée ; son
// titre devient celui de la page (h1, :level="1" transmis à SectionCard).
defineProps<{ child: Child }>()
const t = useT()
const route = useRoute()
const section = computed(() => route.meta.settingsSection)
</script>

<template>
  <div class="section-page">
    <template v-if="section === 'contacts'">
      <StatusBlock
        v-if="contacts.status === 'error'" state="error"
        :text="`${t.contacts.loadError} ${contactErrorText(contacts.error, t)}`" @retry="loadContacts(child.id, true)"
      />
      <!-- Liste de cet enfant, ou celle d'avant estompée pendant le chargement (pas de clignement). -->
      <template v-else>
        <!-- Relecture en échec : la liste affichée peut être périmée, on le dit. -->
        <StatusBlock
          v-if="contacts.error && contacts.childId === child.id" state="error"
          :text="`${t.contacts.loadError} ${contactErrorText(contacts.error, t)}`" @retry="loadContacts(child.id, true)"
        />
        <ContactsCard class="page-card" :level="1" :child-id="child.id" />
      </template>
    </template>
    <AllowedAppsCard v-else-if="section === 'apps'" class="page-card" :level="1" :child-id="child.id" />
    <ParentCodeCard v-else-if="section === 'parentCode'" class="page-card" :level="1" :child="child" />
    <ScheduleCard v-else-if="section === 'schedules'" class="page-card" :level="1" :child-id="child.id" />
    <SosCard v-else-if="section === 'sos'" class="page-card" :level="1" :child="child" />
    <MessageTemplatesCard v-else-if="section === 'templates'" class="page-card" :level="1" :child-id="child.id" />
  </div>
</template>

<style scoped>
/* La carte ouvre la page : pas de marge de séparation avec une carte précédente. */
.section-page .page-card {
  margin-top: 0;
}
</style>
