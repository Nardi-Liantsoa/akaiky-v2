<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import LoadError from '../../components/family/LoadError.vue'
import ChildPicker from '../../components/parent/ChildPicker.vue'
import ContactsCard from '../../components/settings/ContactsCard.vue'
import { useT } from '../../composables/useT'
import { contactErrorText } from '../../lib/contactErrors'
import { children, loadChildren, selectedChild } from '../../store/children'
import { contacts, loadContacts } from '../../store/contacts'
import { canManage, family, loadFamily } from '../../store/family'

const t = useT()
const current = computed(selectedChild)
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
      <button class="btn btn-ghost" type="button" @click="loadChildren(true)">{{ t.errors.retry }}</button>
    </div>
    <template v-else-if="children.status === 'ready'">
      <div v-if="!children.items.length" class="card empty">
        <p>{{ t.contacts.noChild }}</p>
        <RouterLink v-if="canManage()" class="btn" :to="{ name: 'enfant-nouveau' }">{{ t.children.add }}</RouterLink>
      </div>
      <template v-else-if="current">
        <ChildPicker v-if="children.items.length > 1" />
        <div v-if="contacts.status === 'error'" class="error" role="alert">
          <p>{{ t.contacts.loadError }} {{ contactErrorText(contacts.error, t) }}</p>
          <button class="btn btn-ghost" type="button" @click="loadContacts(current.id, true)">{{ t.errors.retry }}</button>
        </div>
        <template v-else-if="contacts.status === 'ready' && contacts.childId === current.id">
          <!-- Relecture en échec : la liste affichée peut être périmée, on le dit. -->
          <div v-if="contacts.error" class="error" role="alert">
            <p>{{ t.contacts.loadError }} {{ contactErrorText(contacts.error, t) }}</p>
            <button class="btn btn-ghost" type="button" @click="loadContacts(current.id, true)">{{ t.errors.retry }}</button>
          </div>
          <ContactsCard :child-id="current.id" />
        </template>
        <p v-else class="loading" role="status"><span class="visually-hidden">{{ t.family.loading }}</span></p>
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
  font-size: 2rem;
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
