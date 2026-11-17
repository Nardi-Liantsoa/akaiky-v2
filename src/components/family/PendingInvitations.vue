<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { cancelInvitation, listInvitations, type Invitation } from '../../api/families'
import { locale, useT } from '../../composables/useT'
import { familyErrorText } from '../../lib/familyErrors'
import { formatDay } from '../../lib/format'

const props = defineProps<{ refresh: number }>()
const t = useT()
const items = ref<Invitation[]>([])
const busy = ref(false)
const error = ref('')

async function load() {
  error.value = ''
  try { items.value = await listInvitations() } catch (e) { error.value = familyErrorText(e, t.value) }
}
async function cancel(id: string) {
  if (busy.value) return
  busy.value = true
  try { await cancelInvitation(id) } catch (e) { error.value = familyErrorText(e, t.value) }
  await load()
  busy.value = false
}

onMounted(load)
watch(() => props.refresh, load)
</script>

<template>
  <section v-if="items.length || error">
    <h2 class="section">{{ t.family.pendingTitle }}</h2>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <ul v-if="items.length" class="card list">
      <li v-for="i in items" :key="i.id">
        <span class="who">
          <span class="email" data-selectable>{{ i.email }}</span>
          <span class="meta">{{ t.family.roles[i.role] }} · {{ t.family.expires(formatDay(i.expiresAt, locale)) }}</span>
        </span>
        <button class="btn btn-ghost small" type="button" :disabled="busy" @click="cancel(i.id)">{{ t.family.cancelInvite }}</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.section {
  margin: 28px 0 12px;
  font-size: 1.15rem;
  font-weight: 800;
}
.list {
  list-style: none;
  margin: 0;
  padding: 8px 24px;
}
.list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.list li:last-child {
  border-bottom: none;
}
.who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.email {
  font-weight: 800;
  overflow-wrap: anywhere;
}
.meta {
  color: var(--text-soft);
  font-size: 0.9rem;
}
.small {
  min-height: 40px;
  padding: 6px 14px;
  font-size: 0.9rem;
}
</style>
