<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api/http'
import { isAdmin } from '../store/auth'
import { useT, locale } from '../composables/useT'
import { errorText } from '../lib/errors'

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

onMounted(load)
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
            <button class="btn" type="submit" :disabled="busy">{{ t.security.regenerate }}</button>
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
          <button class="btn btn-ghost" type="button" :disabled="busy" @click="revokeDevice(d.id)">{{ t.security.revoke }}</button>
        </li>
      </ul>
      <button v-if="state.devices.length > 1" class="btn btn-ghost" type="button" :disabled="busy" @click="revokeDevice('all')">{{ t.security.revokeAll }}</button>
    </section>

    <section v-if="state" class="card">
      <h2>{{ t.security.apps }}</h2>
      <p v-if="!apps.length" class="hint">{{ t.security.none }}</p>
      <ul class="devices">
        <li v-for="d in apps" :key="d.id">
          <span>{{ d.label || '—' }}<em v-if="d.current"> · {{ t.security.current }}</em><br /><small>{{ t.security.lastUsed(date(d.last_seen_at)) }}</small></span>
          <button class="btn btn-ghost" type="button" :disabled="busy" @click="revokeApp(d.id)">{{ t.security.revoke }}</button>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.card {
  margin-bottom: 16px;
}
h2 {
  margin: 0 0 8px;
  font-size: 1.15rem;
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
