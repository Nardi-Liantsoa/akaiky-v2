<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { renameFamily } from '../../api/families'
import { ApiError } from '../../api/http'
import LoadError from '../../components/family/LoadError.vue'
import { useT } from '../../composables/useT'
import { familyNameValid } from '../../lib/familyName'
import { errorText } from '../../lib/errors'
import { canManage, family, loadFamily, setFamilyName } from '../../store/family'

const t = useT()
const editing = ref(false)
const name = ref('')
const busy = ref(false)
const error = ref('')

onMounted(() => { void loadFamily() })

function edit() {
  name.value = family.data?.name ?? ''
  error.value = ''
  editing.value = true
}

async function save() {
  if (busy.value || !familyNameValid(name.value)) return
  busy.value = true
  error.value = ''
  try {
    setFamilyName((await renameFamily(name.value.trim())).name)
    editing.value = false
  } catch (e) {
    error.value = errorText(e, t.value)
    // Rôle changé ou famille quittée ailleurs : l'état affiché est périmé.
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
      editing.value = false
      await loadFamily(true)
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section>
    <h1>{{ t.parent.family.title }}</h1>
    <LoadError v-if="family.status === 'error'" />
    <template v-else-if="family.data">
      <div class="card head">
        <form v-if="editing" class="rename" @submit.prevent="save">
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="field">
            <label for="family-rename">{{ t.family.nameLabel }}</label>
            <input id="family-rename" v-model="name" class="input" required autocomplete="off" data-selectable />
          </div>
          <div class="actions">
            <button class="btn" type="submit" :disabled="busy || !familyNameValid(name)">{{ t.family.save }}</button>
            <button class="btn btn-ghost" type="button" @click="editing = false">{{ t.family.cancel }}</button>
          </div>
        </form>
        <template v-else>
          <h2>{{ family.data.name }}</h2>
          <button v-if="canManage()" class="btn btn-ghost" type="button" @click="edit">{{ t.family.rename }}</button>
        </template>
      </div>

      <h2 class="section">{{ t.family.members }}</h2>
      <ul class="card members">
        <li v-for="m in family.data.members" :key="m.userId">
          <span class="name">{{ m.name }}<span v-if="m.isMe" class="me"> ({{ t.family.you }})</span></span>
          <span class="role">{{ t.family.roles[m.role] }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
h1 {
  font-size: 2rem;
  margin: 8px 0 20px;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.head h2 {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 900;
}
.rename {
  width: 100%;
}
.actions {
  display: flex;
  gap: 8px;
}
.section {
  margin: 28px 0 12px;
  font-size: 1.15rem;
  font-weight: 800;
}
.members {
  list-style: none;
  margin: 0;
  padding: 8px 24px;
}
.members li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.members li:last-child {
  border-bottom: none;
}
.name {
  font-weight: 800;
}
.me,
.role {
  color: var(--text-soft);
  font-weight: 600;
}
</style>
