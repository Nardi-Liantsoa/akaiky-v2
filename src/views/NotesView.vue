<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api/http'
import type { Note } from '../api/types'
import { useT } from '../composables/useT'
import { errorText } from '../lib/errors'

const t = useT()
const notes = ref<Note[]>([])
const title = ref('')
const body = ref('')
const editing = ref<string | null>(null)
const busy = ref(false)
const error = ref('')

async function run(task: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await task() } catch (e) { error.value = errorText(e, t.value) } finally { busy.value = false }
}

const load = () => run(async () => { notes.value = await api.get<Note[]>('/notes') })

const save = () => run(async () => {
  const payload = { title: title.value.trim(), body: body.value }
  if (editing.value) {
    const updated = await api.put<Note>(`/notes/${editing.value}`, payload)
    notes.value = [updated, ...notes.value.filter((n) => n.id !== updated.id)]
  } else {
    notes.value = [await api.post<Note>('/notes', payload), ...notes.value]
  }
  title.value = ''
  body.value = ''
  editing.value = null
})

function edit(n: Note) {
  editing.value = n.id
  title.value = n.title
  body.value = n.body
}

const remove = (n: Note) => run(async () => {
  if (!confirm(t.value.notes.confirmRemove)) return
  await api.del(`/notes/${n.id}`)
  notes.value = notes.value.filter((x) => x.id !== n.id)
})

onMounted(load)
</script>

<template>
  <main class="page">
    <h1>{{ t.notes.title }}</h1>
    <p class="lead">{{ t.notes.lead }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <form class="card" @submit.prevent="save">
      <div class="field">
        <label for="title">{{ t.notes.newTitle }}</label>
        <input id="title" v-model="title" class="input" maxlength="200" required />
      </div>
      <div class="field">
        <label for="body">{{ t.notes.newBody }}</label>
        <textarea id="body" v-model="body" class="input" rows="4" maxlength="20000" />
      </div>
      <button class="btn" type="submit" :disabled="busy">{{ editing ? t.notes.save : t.notes.add }}</button>
    </form>

    <p v-if="!notes.length && !busy" class="empty">{{ t.notes.empty }}</p>
    <ul class="list">
      <li v-for="n in notes" :key="n.id" class="card">
        <h2>{{ n.title }}</h2>
        <p class="body">{{ n.body }}</p>
        <div class="actions">
          <button class="btn btn-ghost" type="button" @click="edit(n)">{{ t.notes.edit }}</button>
          <button class="btn btn-ghost" type="button" :disabled="busy" @click="remove(n)">{{ t.notes.remove }}</button>
        </div>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.lead,
.empty {
  color: var(--text-soft);
}
.list {
  display: grid;
  gap: 14px;
  padding: 0;
  margin: 24px 0 0;
  list-style: none;
}
h2 {
  margin: 0 0 6px;
  font-size: 1.1rem;
}
.body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0 0 12px;
}
.actions {
  display: flex;
  gap: 8px;
}
</style>
