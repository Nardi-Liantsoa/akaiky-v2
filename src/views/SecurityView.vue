<script setup lang="ts">
import AppIcon from '../components/ui/AppIcon.vue'
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { api, ApiError } from '../api/http'
import DeleteConfirm from '../components/account/DeleteConfirm.vue'
import { isAdmin, logout } from '../store/auth'
import { notice } from '../store/notice'
import { useT, locale } from '../composables/useT'
import { errorText } from '../lib/errors'
import { formatDateTime } from '../lib/format'
import { family, loadFamily } from '../store/family'
import AccountSection from '../components/parent/AccountSection.vue'
import NotificationsCard from '../components/parent/NotificationsCard.vue'
import { pushState } from '../lib/parentPush'
import AppButton from '../components/ui/AppButton.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import SectionCard from '../components/ui/SectionCard.vue'

interface Device { id: string, label: string | null, last_used_at?: string, last_seen_at?: string, current: boolean }
interface Security { devices: Device[], mfaEnabled: boolean, recoveryCodesRemaining: number }

const t = useT()
const state = ref<Security | null>(null)
const apps = ref<Device[]>([])
const code = ref('')
const codes = ref<string[]>([])
const busy = ref(false)
const error = ref('')

// Même format que le reste de l'app, mois malgaches compris (NAR-212).
const date = (d?: string) => d ? formatDateTime(d, locale.value) : ''

async function run(task: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await task() } catch (e) { error.value = errorText(e, t.value) } finally { busy.value = false }
}

async function fetchAll() {
  ;[state.value, apps.value] = await Promise.all([api.get<Security>('/auth/security'), api.get<Device[]>('/auth/app-sessions')])
}
const load = () => run(fetchAll)
const revokeDevice = (id: string) => run(async () => { await api.del(`/auth/devices/${id}`); await fetchAll() })
const revokeApp = (id: string) => run(async () => { await api.del(`/auth/app-sessions/${id}`); await fetchAll() })
const regenerate = () => run(async () => {
  codes.value = (await api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { code: code.value.trim() })).recoveryCodes
  code.value = ''
})

// Suppression du compte, mot de passe redemandé. Un parent principal doit d'abord
// céder ce rôle ou supprimer la famille (409) : on le lui explique. Le dernier
// administrateur doit en nommer un autre (409 last_admin).
const router = useRouter()
const deleting = ref(false)
const deleteError = ref('')
const mustTransfer = ref(false)
async function removeAccount(password: string) {
  if (deleting.value) return
  deleting.value = true
  deleteError.value = ''
  mustTransfer.value = false
  try {
    await api.del('/auth/me', { password })
  } catch (e) {
    if (e instanceof ApiError && e.code === 'owner_must_transfer_or_delete') mustTransfer.value = true
    else if (e instanceof ApiError && e.code === 'last_admin') deleteError.value = t.value.deletion.lastAdmin
    else deleteError.value = e instanceof ApiError && e.code === 'wrong_password' ? t.value.deletion.wrongPassword : errorText(e, t.value)
    deleting.value = false
    return
  }
  // Compte effacé côté serveur (sessions comprises) : déconnexion locale, même hors ligne.
  notice.value = 'accountDeleted'
  try { await logout() } catch { /* session déjà effacée par le serveur */ }
  deleting.value = false
  await router.replace({ name: 'connexion' })
}
function resetDelete() {
  deleteError.value = ''
  mustTransfer.value = false
}

onMounted(() => { load(); void loadFamily() })
</script>

<template>
  <!-- « Mon compte » (NAR-209) : langue, déconnexion, sécurité et suppression du compte, à un seul
       endroit. Dans la coquille parent (onglet Famille) : son <main> l'enveloppe. Retour vers
       Famille, ou vers l'accueil (création de la famille) quand il n'y en a pas. -->
  <section>
    <PageHeader
      :back="family.status !== 'none' ? { name: 'famille' } : { name: 'espace' }"
      :back-label="family.status !== 'none' ? t.parent.family.backLabel : t.parent.home.backLabel" :title="t.parent.account.title"
    />
    <AccountSection on-account-page />
    <!-- App native seulement (NAR-179) : le web n'a pas de notifications. -->
    <NotificationsCard v-if="pushState !== 'off'" />
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <SectionCard v-if="state" :title="t.mfa.title" icon="shield">
      <p>{{ state.mfaEnabled ? t.security.mfaOn : t.security.mfaOff }}</p>
      <template v-if="state.mfaEnabled && isAdmin()">
        <p>{{ t.security.remaining(state.recoveryCodesRemaining) }}</p>
        <form @submit.prevent="regenerate">
          <p class="help">{{ t.security.regenerateLead }}</p>
          <div class="row">
            <input v-model="code" class="input" autocomplete="one-time-code" :aria-label="t.mfa.codeLabel" required />
            <AppButton type="submit" :disabled="busy"><AppIcon name="refresh" :size="20" />{{ t.security.regenerate }}</AppButton>
          </div>
        </form>
        <template v-if="codes.length">
          <p>{{ t.mfa.recoveryLead }}</p>
          <ul class="codes"><li v-for="c in codes" :key="c">{{ c }}</li></ul>
        </template>
      </template>
    </SectionCard>

    <SectionCard v-if="state" :title="t.security.devices" icon="monitor">
      <p v-if="!state.devices.length" class="help">{{ t.security.none }}</p>
      <ul class="devices">
        <li v-for="d in state.devices" :key="d.id">
          <span>{{ d.label }}<em v-if="d.current"> · {{ t.security.current }}</em><br /><small>{{ t.security.lastUsed(date(d.last_used_at)) }}</small></span>
          <AppButton variant="ghost" :disabled="busy" @click="revokeDevice(d.id)"><AppIcon name="cross" :size="18" />{{ t.security.revoke }}</AppButton>
        </li>
      </ul>
      <AppButton v-if="state.devices.length > 1" variant="ghost" :disabled="busy" @click="revokeDevice('all')"><AppIcon name="cross" :size="18" />{{ t.security.revokeAll }}</AppButton>
    </SectionCard>

    <SectionCard v-if="state" :title="t.security.apps" icon="smartphone">
      <p v-if="!apps.length" class="help">{{ t.security.none }}</p>
      <ul class="devices">
        <li v-for="d in apps" :key="d.id">
          <span>{{ d.label || '—' }}<em v-if="d.current"> · {{ t.security.current }}</em><br /><small>{{ t.security.lastUsed(date(d.last_seen_at)) }}</small></span>
          <AppButton variant="ghost" :disabled="busy" @click="revokeApp(d.id)"><AppIcon name="cross" :size="18" />{{ t.security.revoke }}</AppButton>
        </li>
      </ul>
    </SectionCard>

    <DeleteConfirm v-if="state" id="delete-account" :title="t.deletion.accountTitle" :lead="t.deletion.accountLead"
      :items="t.deletion.accountItems" :action="t.deletion.accountAction" :confirm="t.deletion.accountConfirm" :busy="deleting" :error="deleteError"
      @cancel="resetDelete" @confirm="removeAccount">
      <div v-if="mustTransfer" class="error" role="alert">
        <p>{{ t.deletion.ownerMustTransfer }}</p>
        <RouterLink :to="{ name: 'famille' }">{{ t.deletion.toFamily }}</RouterLink>
      </div>
    </DeleteConfirm>
  </section>
</template>

<style scoped>
.error p {
  margin: 0 0 8px;
}
.card {
  margin-bottom: 16px;
}
small {
  color: var(--text-mute);
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.row .input {
  flex: 1 1 180px;
  width: auto;
}
.devices {
  padding: 0;
  margin: 0 0 12px;
  list-style: none;
}
.devices li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.codes {
  columns: 2;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
