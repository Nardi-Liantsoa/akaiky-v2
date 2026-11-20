<script setup lang="ts">
import { onMounted } from 'vue'
import { listAdminDevices, shortId } from '../../api/admin'
import { usePagedList } from '../../composables/usePagedList'
import { locale, useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import AppButton from '../../components/ui/AppButton.vue'
import SectionCard from '../../components/ui/SectionCard.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'

// Téléphones vus par l'équipe (NAR-144) : modèle, versions, derniers signaux et état.
const t = useT()
const list = usePagedList(listAdminDevices)
onMounted(list.reload)
const when = (iso: string | null) => iso ? formatDateTime(iso, locale.value) : t.value.admin.never
</script>

<template>
  <SectionCard :title="t.admin.devices.title" :help="t.admin.devices.help">
    <StatusBlock v-if="list.error.value && !list.items.value.length" state="error" :text="errorText(list.error.value, t)" @retry="list.reload" />
    <StatusBlock v-else-if="!list.loaded.value" state="loading" />
    <StatusBlock v-else-if="!list.items.value.length" state="empty" :text="t.admin.devices.empty" />
    <template v-else>
      <div class="admin-scroll">
        <table class="admin-table">
          <thead>
            <tr>
              <th>{{ t.admin.devices.model }}</th><th>{{ t.admin.devices.versions }}</th><th>{{ t.admin.devices.family }}</th>
              <th>{{ t.admin.devices.lastSignal }}</th><th>{{ t.admin.devices.lastSeen }}</th><th>{{ t.admin.devices.state }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in list.items.value" :key="d.id">
              <td>{{ d.model || t.admin.devices.unknownModel }}</td>
              <td>{{ d.osVersion || '—' }} · {{ d.appVersion || '—' }}</td>
              <td><code :title="d.familyId">{{ shortId(d.familyId) }}</code></td>
              <td>{{ when(d.statusAt) }}</td>
              <td>{{ when(d.lastSeenAt) }}</td>
              <td><span class="state" :class="`is-${d.state}`">{{ t.admin.devices.states[d.state] }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="list.error.value" class="error" role="alert">{{ errorText(list.error.value, t) }}</p>
      <AppButton v-if="list.next.value" variant="ghost" :disabled="list.loading.value" @click="list.more">{{ t.admin.more }}</AppButton>
    </template>
  </SectionCard>
</template>

<style scoped>
.state {
  font-weight: 700;
}
.state.is-silent {
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--warning-bg);
  color: var(--warning-ink);
}
.state.is-revoked {
  color: var(--text-soft);
}
</style>
