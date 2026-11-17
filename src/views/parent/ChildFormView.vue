<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { addChild, removeChild, updateChild } from '../../api/children'
import { ApiError } from '../../api/http'
import ChildAvatar from '../../components/parent/ChildAvatar.vue'
import { useT } from '../../composables/useT'
import { AVATAR_COLORS, type AvatarColor } from '../../lib/avatar'
import { errorText } from '../../lib/errors'
import { children, loadChildren, selectChild } from '../../store/children'
import { canManage, family, loadFamily } from '../../store/family'

const t = useT()
const route = useRoute()
const router = useRouter()
const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : null))
const existing = computed(() => (id.value ? children.items.find((c) => c.id === id.value) ?? null : null))
const name = ref('')
const color = ref<AvatarColor>(AVATAR_COLORS[0])
const busy = ref(false)
const error = ref('')
const confirming = ref(false)

const valid = computed(() => { const n = [...name.value.trim()].length; return n >= 1 && n <= 40 })

function message(e: unknown): string {
  if (e instanceof ApiError && e.code === 'too_many_children') return t.value.children.tooMany
  if (e instanceof ApiError && e.code === 'child_not_found') return t.value.children.notFound
  return errorText(e, t.value)
}

onMounted(async () => {
  await Promise.all([loadFamily(), loadChildren()])
  // Réservé aux gestionnaires (le serveur le refuse de toute façon).
  if (family.status === 'ready' && !canManage()) return router.replace({ name: 'espace' })
  if (!id.value) color.value = AVATAR_COLORS[children.items.length % AVATAR_COLORS.length]
})
// Formulaire prérempli dès que l'enfant est connu (chargement ou changement d'adresse).
watch(existing, (c) => { if (c) { name.value = c.firstName; color.value = c.avatarColor } }, { immediate: true })

async function save() {
  if (busy.value || !valid.value) return
  busy.value = true
  error.value = ''
  try {
    const saved = existing.value
      ? await updateChild(existing.value.id, { firstName: name.value.trim(), avatarColor: color.value })
      : await addChild(name.value.trim(), color.value)
    await loadChildren(true)
    selectChild(saved.id)
    await router.push({ name: 'espace' })
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!existing.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await removeChild(existing.value.id)
    await loadChildren(true)
    await router.push({ name: 'espace' })
  } catch (e) {
    error.value = message(e)
    await loadChildren(true)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section>
    <h1>{{ existing ? t.children.editTitle(existing.firstName) : t.children.addTitle }}</h1>
    <p v-if="id && children.status === 'ready' && !existing" class="error" role="alert">{{ t.children.notFound }}</p>
    <form v-else class="card" @submit.prevent="save">
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="field">
        <label for="child-name">{{ t.children.firstName }}</label>
        <input id="child-name" v-model="name" class="input" autocomplete="off" required data-selectable />
      </div>
      <fieldset class="field colors">
        <legend>{{ t.children.color }}</legend>
        <label v-for="c in AVATAR_COLORS" :key="c" class="swatch">
          <input v-model="color" type="radio" name="child-color" :value="c" :aria-label="t.children.colors[c]" />
          <ChildAvatar :name="name || '?'" :color="c" :size="44" />
        </label>
      </fieldset>
      <div class="actions">
        <button class="btn" type="submit" :disabled="busy || !valid">{{ t.children.save }}</button>
        <RouterLink class="btn btn-ghost" :to="{ name: 'espace' }">{{ t.children.cancel }}</RouterLink>
      </div>
    </form>

    <div v-if="existing" class="danger-zone">
      <p class="hint">{{ t.children.removeHint }}</p>
      <button v-if="!confirming" class="btn btn-ghost" type="button" :disabled="busy" @click="confirming = true">{{ t.children.remove }}</button>
      <button v-else class="btn danger" type="button" :disabled="busy" @click="remove">{{ t.children.confirmRemove }}</button>
    </div>
  </section>
</template>

<style scoped>
h1 {
  font-size: 2rem;
  margin: 8px 0 20px;
}
.colors {
  border: none;
  padding: 0;
  margin: 0 0 20px;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10px;
}
.colors legend {
  width: 100%;
  margin-bottom: 8px;
  font-size: 0.78rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-mute);
}
.swatch {
  position: relative;
  display: inline-flex;
  padding: 3px;
  border: 3px solid transparent;
  border-radius: 50%;
  cursor: pointer;
}
.swatch:has(input:checked) {
  border-color: var(--ink);
}
.swatch:has(input:focus-visible) {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
.swatch input {
  position: absolute;
  opacity: 0;
  inset: 0;
  margin: 0;
  cursor: pointer;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.danger-zone {
  margin-top: 28px;
}
.hint {
  color: var(--text-soft);
}
.danger {
  background: var(--danger);
  color: var(--accent-ink);
}
</style>
