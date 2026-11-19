<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { RouterLink, useRouter } from 'vue-router'
import { api, ApiError } from '../api/http'
import DeleteConfirm from '../components/account/DeleteConfirm.vue'
import { isAdmin, logout } from '../store/auth'
import { notice } from '../store/notice'
import { useT, locale } from '../composables/useT'
import { errorText } from '../lib/errors'
import { exportFamily } from '../api/families'
import { canManage, family, loadFamily } from '../store/family'
import AppButton from '../components/ui/AppButton.vue'

interface Device { id: string, label: string | null, last_used_at?: string, last_seen_at?: string, current: boolean }
interface Security { devices: Device[], mfaEnabled: boolean, recoveryCodesRemaining: number }

const t = useT()
const state = ref<Security | null>(null)
const apps = ref<Device[]>([])
const code = ref('')
const codes = ref<string[]>([])
const busy = ref(false)
const error = ref('')

const date = (d?: string) => d ? new Date(d).toLocaleString(locale.value === 'mg' ? 'fr' : locale.value) : ''

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

// Export des données de la famille (NAR-178, droit d'accès) : owner et manager.
// Fichier construit par le serveur, enregistré par un lien de téléchargement temporaire.
// Pas d'export dans l'app native : la WebView ignore ce téléchargement (Filesystem/Share
// demanderait une nouvelle coque) ; on renvoie vers la version web.
const nativeApp = Capacitor.isNativePlatform()
const exporting = ref(false)
const exportError = ref('')
async function downloadExport() {
  if (nativeApp || exporting.value) return
  exporting.value = true
  exportError.value = ''
  try {
    const data = await exportFamily()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `akaiky-famille-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (e) {
    exportError.value = e instanceof ApiError && e.status === 429 ? t.value.dataExport.tooMany : errorText(e, t.value)
    if (e instanceof ApiError && e.code === 'family_role') void loadFamily(true)
  } finally {
    exporting.value = false
  }
}

onMounted(() => { load(); void loadFamily() })
</script>

<template>
  <main class="page">
    <h1>{{ t.security.title }}</h1>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <section v-if="state" class="card">
      <h2>{{ t.mfa.title }}</h2>
      <p>{{ state.mfaEnabled ? t.security.mfaOn : t.security.mfaOff }}</p>
      <template v-if="state.mfaEnabled && isAdmin()">
        <p>{{ t.security.remaining(state.recoveryCodesRemaining) }}</p>
        <form @submit.prevent="regenerate">
          <p class="hint">{{ t.security.regenerateLead }}</p>
          <div class="row">
            <input v-model="code" class="input" autocomplete="one-time-code" :aria-label="t.mfa.codeLabel" required />
            <AppButton type="submit" :disabled="busy">{{ t.security.regenerate }}</AppButton>
          </div>
        </form>
        <template v-if="codes.length">
          <p>{{ t.mfa.recoveryLead }}</p>
          <ul class="codes"><li v-for="c in codes" :key="c">{{ c }}</li></ul>
        </template>
      </template>
    </section>

    <section v-if="state" class="card">
      <h2>{{ t.security.devices }}</h2>
      <p v-if="!state.devices.length" class="hint">{{ t.security.none }}</p>
      <ul class="devices">
        <li v-for="d in state.devices" :key="d.id">
          <span>{{ d.label }}<em v-if="d.current"> · {{ t.security.current }}</em><br /><small>{{ t.security.lastUsed(date(d.last_used_at)) }}</small></span>
          <AppButton variant="ghost" :disabled="busy" @click="revokeDevice(d.id)">{{ t.security.revoke }}</AppButton>
        </li>
      </ul>
      <AppButton v-if="state.devices.length > 1" variant="ghost" :disabled="busy" @click="revokeDevice('all')">{{ t.security.revokeAll }}</AppButton>
    </section>

    <section v-if="state" class="card">
      <h2>{{ t.security.apps }}</h2>
      <p v-if="!apps.length" class="hint">{{ t.security.none }}</p>
      <ul class="devices">
        <li v-for="d in apps" :key="d.id">
          <span>{{ d.label || '—' }}<em v-if="d.current"> · {{ t.security.current }}</em><br /><small>{{ t.security.lastUsed(date(d.last_seen_at)) }}</small></span>
          <AppButton variant="ghost" :disabled="busy" @click="revokeApp(d.id)">{{ t.security.revoke }}</AppButton>
        </li>
      </ul>
    </section>

    <section v-if="family.status === 'ready' && family.data" class="card" aria-labelledby="export-title">
      <h2 id="export-title">{{ t.dataExport.title }}</h2>
      <template v-if="canManage()">
        <p class="hint">{{ t.dataExport.lead }}</p>
        <p v-if="nativeApp" class="hint">{{ t.dataExport.nativeHint }}</p>
        <template v-else>
          <p v-if="exportError" class="error" role="alert">{{ exportError }}</p>
          <AppButton variant="ghost" :disabled="exporting" @click="downloadExport">{{ exporting ? t.dataExport.busy : t.dataExport.action }}</AppButton>
        </template>
      </template>
      <p v-else class="hint">{{ t.dataExport.memberHint }}</p>
    </section>

    <DeleteConfirm v-if="state" id="delete-account" :title="t.deletion.accountTitle" :lead="t.deletion.accountLead"
      :items="t.deletion.accountItems" :action="t.deletion.accountAction" :confirm="t.deletion.accountConfirm" :busy="deleting" :error="deleteError"
      @cancel="resetDelete" @confirm="removeAccount">
      <div v-if="mustTransfer" class="error" role="alert">
        <p>{{ t.deletion.ownerMustTransfer }}</p>
        <RouterLink :to="{ name: 'famille' }">{{ t.deletion.toFamily }}</RouterLink>
      </div>
    </DeleteConfirm>
  </main>
</template>

<style scoped>
.error p {
  margin: 0 0 8px;
}
.card {
  margin-bottom: 16px;
}
h2 {
  margin: 0 0 8px;
}
.hint,
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
