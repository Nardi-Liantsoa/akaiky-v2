<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { listAdminAudit, type AdminAuditEntry } from '../api/admin'
import { useT, locale } from '../composables/useT'
import { errorText } from '../lib/errors'
import { formatDateTime } from '../lib/format'
import SectionCard from '../components/ui/SectionCard.vue'
import StatsPanel from './admin/StatsPanel.vue'
import FamiliesPanel from './admin/FamiliesPanel.vue'
import DevicesPanel from './admin/DevicesPanel.vue'
import UsersPanel from './admin/UsersPanel.vue'

// Back-office de l'équipe (web seulement, administrateurs MFA ; NAR-144) : statistiques,
// familles, téléphones, puis comptes et journal d'audit. Sans prénom, numéro, position ni
// journal d'appels : l'API ne les envoie pas (server/src/routes/admin.js).
// Actions (NAR-199) : retirer un téléphone (DevicesPanel), désactiver ou réactiver un compte
// (UsersPanel) ; chacune relit le journal d'audit, qui en garde la trace.
const t = useT()
const audit = ref<AdminAuditEntry[]>([])
const error = ref('')
const stats = ref<InstanceType<typeof StatsPanel> | null>(null)
const families = ref<InstanceType<typeof FamiliesPanel> | null>(null)

async function loadAudit() {
  try {
    audit.value = await listAdminAudit()
    error.value = ''
  } catch (e) { error.value = errorText(e, t.value) }
}
onMounted(loadAudit)
function deviceChanged() {
  void stats.value?.reload()
  void families.value?.reload()
  void loadAudit()
}
</script>

<template>
  <main class="page wide admin">
    <h1>{{ t.admin.title }}</h1>
    <p class="help">{{ t.admin.lead }}</p>

    <StatsPanel ref="stats" />
    <FamiliesPanel ref="families" />
    <DevicesPanel @changed="deviceChanged" />

    <UsersPanel @changed="loadAudit" />

    <SectionCard :title="t.admin.audit">
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="admin-scroll">
        <table class="admin-table">
          <thead><tr><th>{{ t.admin.when }}</th><th>{{ t.admin.action }}</th><th>{{ t.admin.actor }}</th></tr></thead>
          <tbody>
            <tr v-for="(a, i) in audit" :key="i">
              <td>{{ formatDateTime(a.at, locale) }}</td>
              <td>{{ a.action }}</td>
              <td>{{ a.actor || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>
  </main>
</template>

<style scoped>
.wide {
  max-width: 1100px;
}
.admin {
  display: grid;
  gap: var(--space-4);
}
.admin h1,
.admin > .help {
  margin: 0;
}
</style>

<style>
/* Tableaux du back-office (NAR-144), partagés par les panneaux de src/views/admin/. */
.admin-scroll {
  overflow-x: auto;
  margin-bottom: var(--space-3);
}
.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
.admin-table th,
.admin-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  white-space: nowrap;
}
.admin-table th {
  color: var(--text-mute);
  font-weight: 500;
}
</style>
