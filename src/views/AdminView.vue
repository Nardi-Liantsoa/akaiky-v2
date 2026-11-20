<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api/http'
import { useT, locale } from '../composables/useT'
import { errorText } from '../lib/errors'
import { formatDateTime } from '../lib/format'
import SectionCard from '../components/ui/SectionCard.vue'
import StatsPanel from './admin/StatsPanel.vue'
import FamiliesPanel from './admin/FamiliesPanel.vue'
import DevicesPanel from './admin/DevicesPanel.vue'

// Back-office de l'équipe (web seulement, administrateurs MFA ; NAR-144) : statistiques,
// familles, téléphones, puis comptes et journal d'audit. Sans prénom, numéro, position ni
// journal d'appels : l'API ne les envoie pas (server/src/routes/admin.js).
// Compte à numéro (NAR-136) : email null, numéro jamais envoyé à l'équipe (sms_account seul).
interface Account { id: string, email: string | null, name: string, is_admin: boolean, created_at: string, email_verified_at: string | null, sms_account: boolean, verified: boolean, mfa: boolean }
interface Entry { at: string, action: string, target: string | null, actor: string | null }

const t = useT()
const users = ref<Account[]>([])
const audit = ref<Entry[]>([])
const error = ref('')

onMounted(async () => {
  try {
    ;[users.value, audit.value] = await Promise.all([api.get<Account[]>('/admin/users'), api.get<Entry[]>('/admin/audit')])
  } catch (e) { error.value = errorText(e, t.value) }
})
</script>

<template>
  <main class="page wide admin">
    <h1>{{ t.admin.title }}</h1>
    <p class="help">{{ t.admin.lead }}</p>

    <StatsPanel />
    <FamiliesPanel />
    <DevicesPanel />

    <SectionCard :title="t.admin.users">
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="admin-scroll">
        <table class="admin-table">
          <thead><tr><th>{{ t.admin.email }}</th><th>{{ t.admin.created }}</th><th>{{ t.admin.verified }}</th><th>{{ t.admin.mfa }}</th></tr></thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td>{{ u.email ?? t.admin.smsAccount }}<span v-if="u.is_admin"> · admin</span></td>
              <td>{{ formatDateTime(u.created_at, locale) }}</td>
              <td>{{ u.verified ? t.admin.yes : t.admin.no }}</td>
              <td>{{ u.mfa ? t.admin.yes : t.admin.no }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <SectionCard :title="t.admin.audit">
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
