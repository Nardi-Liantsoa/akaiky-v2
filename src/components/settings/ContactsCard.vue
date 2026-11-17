<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { ApiError } from '../../api/http'
import { reorderContacts } from '../../api/contacts'
import ChildAvatar from '../parent/ChildAvatar.vue'
import { useT } from '../../composables/useT'
import { contactErrorText } from '../../lib/contactErrors'
import { formatPhone } from '../../lib/phone'
import { contacts, loadContacts } from '../../store/contacts'
import { canManage } from '../../store/family'

const props = defineProps<{ childId: string }>()
const t = useT()
const busy = ref(false)
const error = ref('')

// Réorganisation par boutons Monter / Descendre : utilisable au doigt, au clavier
// et au lecteur d'écran (le glisser-déposer HTML ne fonctionne pas dans les WebView mobiles).
async function move(index: number, delta: number) {
  const target = index + delta
  if (busy.value || target < 0 || target >= contacts.items.length) return
  const ids = contacts.items.map((c) => c.id)
  ;[ids[index], ids[target]] = [ids[target], ids[index]]
  busy.value = true
  error.value = ''
  try {
    await reorderContacts(props.childId, ids)
  } catch (e) {
    error.value = contactErrorText(e, t.value)
    if (!(e instanceof ApiError && e.code === 'order_mismatch')) { busy.value = false; return }
  }
  // Autre enfant choisi pendant l'enregistrement : Réglages charge déjà le sien.
  if (contacts.childId !== props.childId) { busy.value = false; return }
  await loadContacts(props.childId, true)
  // Ordre enregistré mais liste non relue : le dire, l'ordre affiché est périmé.
  if (contacts.error && !error.value) error.value = `${t.value.contacts.loadError} ${contactErrorText(contacts.error, t.value)}`
  busy.value = false
}
</script>

<template>
  <section class="card contacts">
    <header>
      <h2>{{ t.contacts.title }}</h2>
      <span class="count">{{ t.contacts.count(contacts.items.length, contacts.max) }}</span>
    </header>
    <p class="hint">{{ t.contacts.orderHint }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <ol v-if="contacts.items.length" class="list">
      <li v-for="(c, i) in contacts.items" :key="c.id">
        <span class="rank" aria-hidden="true">{{ c.position }}</span>
        <ChildAvatar :name="c.name" :color="c.avatarColor" :size="36" />
        <span class="who">
          <span class="name">{{ c.name }}<span v-if="c.memberRole" class="role"> · {{ t.family.roles[c.memberRole] }}</span></span>
          <span class="phone" data-selectable>{{ formatPhone(c.phone) }}</span>
        </span>
        <span v-if="canManage()" class="actions">
          <button class="icon" type="button" :disabled="busy || i === 0" :aria-label="t.contacts.moveUp(c.name)" @click="move(i, -1)">↑</button>
          <button class="icon" type="button" :disabled="busy || i === contacts.items.length - 1" :aria-label="t.contacts.moveDown(c.name)" @click="move(i, 1)">↓</button>
          <RouterLink class="icon" :to="{ name: 'contact', params: { childId, id: c.id } }" :aria-label="t.contacts.edit(c.name)">✎</RouterLink>
        </span>
      </li>
    </ol>
    <p v-else class="empty">{{ t.contacts.empty }}</p>
    <RouterLink v-if="canManage() && contacts.items.length < contacts.max" class="add" :to="{ name: 'contact-nouveau', params: { childId } }">
      + {{ t.contacts.add }}
    </RouterLink>
  </section>
</template>

<style scoped>
header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 800;
}
.count {
  color: var(--text-soft);
  font-weight: 700;
}
.hint,
.empty {
  margin: 4px 0 8px;
  color: var(--text-soft);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.rank {
  width: 1.2em;
  color: var(--text-soft);
  font-weight: 800;
  text-align: center;
}
.who {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.name {
  font-weight: 800;
}
.role,
.phone {
  color: var(--text-soft);
  font-weight: 600;
}
.actions {
  display: flex;
  gap: 4px;
}
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
}
.icon:disabled {
  opacity: 0.35;
  cursor: default;
}
.icon:focus-visible,
.add:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
.add {
  display: inline-block;
  margin-top: 12px;
  color: var(--accent);
  font-weight: 800;
  text-decoration: none;
}
</style>
