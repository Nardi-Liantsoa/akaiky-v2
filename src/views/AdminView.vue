<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api/http'
import { useT, locale } from '../composables/useT'
import { errorText } from '../lib/errors'

interface Account { id: string, email: string, name: string, is_admin: boolean, created_at: string, email_verified_at: string | null, mfa: boolean }
interface Entry { at: string, action: string, target: string | null, actor: string | null }

const t = useT()
const users = ref<Account[]>([])
const audit = ref<Entry[]>([])
const error = ref('')
const date = (d: string) => new Date(d).toLocaleString(locale.value === 'mg' ? 'fr' : locale.value)

onMounted(async () => {
  try {
    ;[users.value, audit.value] = await Promise.all([api.get<Account[]>('/admin/users'), api.get<Entry[]>('/admin/audit')])
  } catch (e) { error.value = errorText(e, t.value) }
})
</script>

<template>
  <main class="page wide">
    <h1>{{ t.admin.title }}</h1>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <h2>{{ t.admin.users }}</h2>
    <div class="scroll">
      <table>
        <thead><tr><th>{{ t.admin.email }}</th><th>{{ t.admin.created }}</th><th>{{ t.admin.verified }}</th><th>{{ t.admin.mfa }}</th></tr></thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.email }}<span v-if="u.is_admin"> · admin</span></td>
            <td>{{ date(u.created_at) }}</td>
            <td>{{ u.email_verified_at ? t.admin.yes : t.admin.no }}</td>
            <td>{{ u.mfa ? t.admin.yes : t.admin.no }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2>{{ t.admin.audit }}</h2>
    <div class="scroll">
      <table>
        <thead><tr><th>{{ t.admin.when }}</th><th>{{ t.admin.action }}</th><th>{{ t.admin.actor }}</th></tr></thead>
        <tbody>
          <tr v-for="(a, i) in audit" :key="i">
            <td>{{ date(a.at) }}</td>
            <td>{{ a.action }}</td>
            <td>{{ a.actor || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </main>
</template>

<style scoped>
.wide {
  max-width: 1100px;
}
h2 {
  margin: 28px 0 10px;
  font-size: 1.15rem;
}
.scroll {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
th,
td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  white-space: nowrap;
}
th {
  color: var(--text-mute);
  font-weight: 500;
}
</style>
