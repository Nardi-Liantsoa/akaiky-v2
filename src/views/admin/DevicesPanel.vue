<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { listAdminDevices, revokeAdminDevice, shortId, type AdminDevice } from '../../api/admin'
import { useConfirm } from '../../composables/useConfirm'
import { usePagedList } from '../../composables/usePagedList'
import { locale, useT } from '../../composables/useT'
import { adminErrorText } from '../../lib/adminErrors'
import { errorText } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import AppButton from '../../components/ui/AppButton.vue'
import ConfirmSheet from '../../components/ui/ConfirmSheet.vue'
import SectionCard from '../../components/ui/SectionCard.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'

// Téléphones vus par l'équipe (NAR-144) : modèle, versions, derniers signaux et état.
// Retrait d'un téléphone (NAR-199), confirmé par la feuille commune : la même révocation que
// celle d'un gestionnaire de la famille ; la liste est relue ensuite (première page).
const emit = defineEmits<{ changed: [] }>()
const t = useT()
const list = usePagedList(listAdminDevices)
onMounted(list.reload)
const when = (iso: string | null) => iso ? formatDateTime(iso, locale.value) : t.value.admin.never
const modelOf = (d: AdminDevice) => d.model || t.value.admin.devices.unknownModel
const confirming = useConfirm<AdminDevice>()
const busy = ref(false)
const actionError = ref('')
async function revoke() {
  const d = confirming.target.value
  if (!d || busy.value) return
  busy.value = true
  actionError.value = ''
  try {
    await revokeAdminDevice(d.id)
    confirming.close()
  } catch (e) {
    actionError.value = adminErrorText(e, t.value)
  } finally {
    busy.value = false
    await list.reload()
    emit('changed')
  }
}
function closeSheet() {
  confirming.close()
  actionError.value = ''
}
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
              <th>{{ t.admin.actions }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in list.items.value" :key="d.id">
              <td class="lead-cell">{{ modelOf(d) }}</td>
              <td :data-label="t.admin.devices.versions">{{ d.osVersion || '—' }} · {{ d.appVersion || '—' }}</td>
              <td :data-label="t.admin.devices.family"><code :title="d.familyId">{{ shortId(d.familyId) }}</code></td>
              <td :data-label="t.admin.devices.lastSignal">{{ when(d.statusAt) }}</td>
              <td :data-label="t.admin.devices.lastSeen">{{ when(d.lastSeenAt) }}</td>
              <td :data-label="t.admin.devices.state"><span class="state" :class="`is-${d.state}`">{{ t.admin.devices.states[d.state] }}</span></td>
              <td class="actions-cell">
                <AppButton v-if="d.state !== 'revoked'" variant="ghost" small :disabled="busy" @click="confirming.ask(d, $event)">{{ t.admin.revoke }}</AppButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="list.error.value" class="error" role="alert">{{ errorText(list.error.value, t) }}</p>
      <AppButton v-if="list.next.value" variant="ghost" :disabled="list.loading.value" @click="list.more">{{ t.admin.more }}</AppButton>
    </template>
    <p v-if="actionError && !confirming.target.value" class="error" role="alert">{{ actionError }}</p>
    <ConfirmSheet
      v-if="confirming.target.value" id="admin-revoke"
      :title="t.admin.revokeTitle(modelOf(confirming.target.value))"
      :items="t.admin.revokeItems" :confirm="t.admin.revokeConfirm"
      :busy="busy" :error="actionError" :opener="confirming.opener.value" @close="closeSheet" @confirm="revoke"
    />
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
