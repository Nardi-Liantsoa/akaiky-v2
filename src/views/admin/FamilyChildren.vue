<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { listAdminFamilyChildren, requestNewParentCode, shortId, type AdminChild } from '../../api/admin'
import { useConfirm } from '../../composables/useConfirm'
import { locale, useT } from '../../composables/useT'
import { adminErrorText } from '../../lib/adminErrors'
import { errorText } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import AppButton from '../../components/ui/AppButton.vue'
import ConfirmSheet from '../../components/ui/ConfirmSheet.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'

// Enfants d'une famille vus par l'équipe (NAR-200) : référence, date, code défini, demande en
// cours. Seule action : demander un nouveau code parent, après la vérification d'identité
// (HANDOFF.md), confirmée par la feuille commune. Jamais le prénom ni le numéro.
const props = defineProps<{ familyId: string }>()
const t = useT()
const items = ref<AdminChild[]>([])
const loaded = ref(false)
const error = ref<unknown>(null)
async function reload() {
  error.value = null
  try {
    items.value = await listAdminFamilyChildren(props.familyId)
  } catch (e) {
    error.value = e
  } finally {
    loaded.value = true
  }
}
onMounted(reload)

const confirming = useConfirm<AdminChild>()
const busy = ref(false)
const actionError = ref('')
async function request() {
  const kid = confirming.target.value
  if (!kid || busy.value) return
  busy.value = true
  actionError.value = ''
  try {
    await requestNewParentCode(kid.id)
    confirming.close()
  } catch (e) {
    actionError.value = adminErrorText(e, t.value)
  } finally {
    busy.value = false
    await reload()
  }
}
function closeSheet() {
  confirming.close()
  actionError.value = ''
}
</script>

<template>
  <div class="family-children">
    <StatusBlock v-if="error && !items.length" state="error" :text="errorText(error, t)" @retry="reload" />
    <StatusBlock v-else-if="!loaded" state="loading" />
    <StatusBlock v-else-if="!items.length" state="empty" :text="t.admin.kids.empty" />
    <table v-else class="admin-table">
      <thead>
        <tr>
          <th>{{ t.admin.kids.ref }}</th><th>{{ t.admin.kids.created }}</th><th>{{ t.admin.kids.code }}</th>
          <th>{{ t.admin.kids.request }}</th><th>{{ t.admin.actions }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="k in items" :key="k.id">
          <td><code :title="k.id">{{ shortId(k.id) }}</code></td>
          <td>{{ formatDateTime(k.createdAt, locale) }}</td>
          <td>{{ k.codeSet ? t.admin.kids.codeSet : t.admin.kids.codeNotSet }}</td>
          <td>{{ k.newCodeRequestedAt ? t.admin.kids.requestedOn(formatDateTime(k.newCodeRequestedAt, locale)) : '—' }}</td>
          <td>
            <AppButton v-if="k.codeSet && !k.newCodeRequestedAt" variant="ghost" small :disabled="busy" @click="confirming.ask(k, $event)">
              {{ t.admin.kids.ask }}
            </AppButton>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="error && items.length" class="error" role="alert">{{ errorText(error, t) }}</p>
    <p v-if="actionError && !confirming.target.value" class="error" role="alert">{{ actionError }}</p>
    <ConfirmSheet
      v-if="confirming.target.value" id="admin-new-code"
      :title="t.admin.kids.askTitle(shortId(confirming.target.value.id))"
      :items="t.admin.kids.askItems" :confirm="t.admin.kids.ask"
      :busy="busy" :error="actionError" :opener="confirming.opener.value" @close="closeSheet" @confirm="request"
    />
  </div>
</template>

<style scoped>
.family-children {
  padding: var(--space-2) 0;
}
</style>
