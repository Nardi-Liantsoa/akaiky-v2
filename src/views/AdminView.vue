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
              <td :data-label="t.admin.when">{{ formatDateTime(a.at, locale) }}</td>
              <td class="lead-cell">{{ a.action }}</td>
              <td :data-label="t.admin.actor">{{ a.actor || '—' }}</td>
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
/* Téléphone et petite tablette (NAR-224, maquette 06) : une carte par ligne au lieu du
 * tableau, qui forçait la largeur et faisait dézoomer la page. Première cellule en titre,
 * autres en paires libellé / valeur (data-label), action en bouton pleine largeur. Même
 * gabarit que le tableau : aucune donnée de plus ni de moins. */
@media (max-width: 767px) {
  .admin-scroll {
    overflow: visible;
  }
  .admin-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .admin-table,
  .admin-table tbody,
  .admin-table tr,
  .admin-table td {
    display: block;
    width: 100%;
  }
  .admin-table tr {
    margin-bottom: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .admin-table td {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-1) 0;
    border: 0;
    white-space: normal;
    overflow-wrap: anywhere;
    text-align: right;
  }
  .admin-table td::before {
    content: attr(data-label);
    flex: none;
    color: var(--text-soft);
    text-align: left;
  }
  .admin-table td.lead-cell {
    display: block;
    padding-bottom: var(--space-2);
    font-size: 1rem;
    font-weight: 800;
    text-align: left;
  }
  .admin-table td.actions-cell:empty,
  .admin-table td.actions-cell:not(:has(*)) {
    display: none;
  }
  .admin-table td.actions-cell {
    padding-top: var(--space-2);
  }
  .admin-table td.actions-cell .btn {
    width: 100%;
  }
  /* Enfants d'une famille, dépliés sous sa carte : la liste imbriquée garde son propre gabarit. */
  .admin-table tr:has(> td.nested-cell) {
    padding: 0;
    border: 0;
    background: none;
  }
  .admin-table td.nested-cell {
    display: block;
    text-align: left;
  }
}
</style>
