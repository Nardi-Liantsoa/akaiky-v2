<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { disableAdminUser, enableAdminUser, listAdminUsers, type AdminAccount } from '../../api/admin'
import { useConfirm } from '../../composables/useConfirm'
import { locale, useT } from '../../composables/useT'
import { adminErrorText } from '../../lib/adminErrors'
import { errorText } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { auth } from '../../store/auth'
import AppButton from '../../components/ui/AppButton.vue'
import ConfirmSheet from '../../components/ui/ConfirmSheet.vue'
import SectionCard from '../../components/ui/SectionCard.vue'

// Comptes vus par l'équipe (NAR-144) et leur désactivation (NAR-199) : adresse (jamais le
// numéro d'un compte par téléphone), dates, MFA, état. Désactiver passe par la feuille de
// confirmation commune ; réactiver rend seulement l'accès (rien n'est perdu) et part tout de
// suite. Jamais sur son propre compte (le serveur refuse aussi : self_disable).
const emit = defineEmits<{ changed: [] }>()
const t = useT()
const users = ref<AdminAccount[]>([])
const loadError = ref('')
const actionError = ref('')
const busy = ref(false)
const confirming = useConfirm<AdminAccount>()

async function load() {
  try {
    users.value = await listAdminUsers()
    loadError.value = ''
  } catch (e) { loadError.value = errorText(e, t.value) }
}
onMounted(load)

const label = (u: AdminAccount) => u.email ?? t.value.admin.smsAccount
const isMe = (u: AdminAccount) => u.id === auth.user?.id

async function run(task: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  actionError.value = ''
  try {
    await task()
    confirming.close()
  } catch (e) {
    // Refus montré dans la feuille si elle est ouverte, sinon au-dessus de la liste.
    actionError.value = adminErrorText(e, t.value)
  } finally {
    busy.value = false
    // L'état affiché est relu dans tous les cas (un refus vient souvent d'un changement fait
    // ailleurs), et le journal d'audit de la page aussi.
    await load()
    emit('changed')
  }
}
function disable() {
  const u = confirming.target.value
  if (u) void run(() => disableAdminUser(u.id))
}
// Réactivation sans feuille : le bouton est désactivé pendant l'appel (le navigateur lui retire
// alors le focus), il le reprend ensuite s'il est toujours là.
async function enable(u: AdminAccount, event: Event) {
  const el = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  await run(() => enableAdminUser(u.id))
  await nextTick()
  if (el?.isConnected) el.focus()
}
function closeSheet() {
  confirming.close()
  actionError.value = ''
}
</script>

<template>
  <SectionCard :title="t.admin.users">
    <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>
    <p v-if="actionError && !confirming.target.value" class="error" role="alert">{{ actionError }}</p>
    <div class="admin-scroll">
      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ t.admin.email }}</th><th>{{ t.admin.created }}</th><th>{{ t.admin.verified }}</th><th>{{ t.admin.mfa }}</th>
            <th>{{ t.admin.state }}</th><th>{{ t.admin.actions }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td class="lead-cell">{{ label(u) }}<span v-if="u.is_admin"> · {{ t.admin.adminBadge }}</span><span v-if="isMe(u)"> ({{ t.admin.you }})</span></td>
            <td :data-label="t.admin.created">{{ formatDateTime(u.created_at, locale) }}</td>
            <td :data-label="t.admin.verified">{{ u.verified ? t.admin.yes : t.admin.no }}</td>
            <td :data-label="t.admin.mfa">{{ u.mfa ? t.admin.yes : t.admin.no }}</td>
            <td :data-label="t.admin.state"><span class="state" :class="{ 'is-disabled': u.disabled_at }">{{ u.disabled_at ? t.admin.accountStates.disabled : t.admin.accountStates.active }}</span></td>
            <td class="actions-cell">
              <!-- Un seul bouton par ligne, dont le libellé change : l'élément reste le même, le focus
                   clavier y reste après l'action (deux boutons en v-if/v-else le renverraient au haut de la page). -->
              <AppButton v-if="u.disabled_at || !isMe(u)" variant="ghost" small :disabled="busy" @click="u.disabled_at ? enable(u, $event) : confirming.ask(u, $event)">
                {{ u.disabled_at ? t.admin.enable : t.admin.disable }}
              </AppButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <ConfirmSheet
      v-if="confirming.target.value" id="admin-disable"
      :title="t.admin.disableTitle(label(confirming.target.value))"
      :items="t.admin.disableItems" :confirm="t.admin.disableConfirm"
      :busy="busy" :error="actionError" :opener="confirming.opener.value" @close="closeSheet" @confirm="disable"
    />
  </SectionCard>
</template>

<style scoped>
.state {
  font-weight: 700;
}
.state.is-disabled {
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--warning-bg);
  color: var(--warning-ink);
}
</style>
