<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { addChild, removeChild, updateChild } from '../../api/children'
import { ApiError } from '../../api/http'
import ChildAvatar from '../../components/parent/ChildAvatar.vue'
import { useT } from '../../composables/useT'
import { AVATAR_COLORS, type AvatarColor } from '../../lib/avatar'
import { errorText } from '../../lib/errors'
import { children, dropChild, loadChildren, selectChild, upsertChild } from '../../store/children'
import { canManage, family, loadFamily } from '../../store/family'

const t = useT()
const route = useRoute()
const router = useRouter()
const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : null))
const existing = computed(() => (id.value ? children.items.find((c) => c.id === id.value) ?? null : null))
const name = ref('')
// null : aucune couleur choisie à l'ajout, le serveur applique sa rotation.
const color = ref<AvatarColor | null>(null)
const busy = ref(false)
const error = ref('')
const confirming = ref(false)

const valid = computed(() => { const n = [...name.value.trim()].length; return n >= 1 && n <= 40 })
// Formulaire montré seulement à un gestionnaire, une fois la famille connue.
const allowed = computed(() => family.status === 'ready' && canManage())

function message(e: unknown): string {
  if (e instanceof ApiError && e.code === 'too_many_children') return t.value.children.tooMany
  if (e instanceof ApiError && e.code === 'child_not_found') return t.value.children.notFound
  return errorText(e, t.value)
}

onMounted(() => { void loadFamily() })
// Enfants chargés une fois la famille connue (jamais en parallèle avec elle) ;
// un non-gestionnaire est renvoyé à l'accueil.
watch(() => family.status, (s) => {
  if (s !== 'ready') return
  if (!canManage()) { void router.replace({ name: 'espace' }); return }
  void loadChildren()
}, { immediate: true })

// Formulaire rempli une seule fois par adresse : un rechargement de la liste
// n'écrase pas une saisie ; changer d'adresse (même composant réutilisé) repart
// de zéro et désarme la confirmation de retrait.
let filledFor: string | null = null
function reset() {
  filledFor = null
  name.value = ''
  color.value = null
  confirming.value = false
  error.value = ''
}
watch(id, reset)
watch(existing, (c) => {
  if (c && c.id !== filledFor) { filledFor = c.id; name.value = c.firstName; color.value = c.avatarColor }
}, { immediate: true })

async function save() {
  if (busy.value || !valid.value) return
  busy.value = true
  error.value = ''
  try {
    // L'adresse décide : /enfant/:id modifie, /enfant/nouveau ajoute.
    const saved = id.value
      ? await updateChild(id.value, { firstName: name.value.trim(), ...(color.value ? { avatarColor: color.value } : {}) })
      : await addChild(name.value.trim(), color.value ?? undefined)
    upsertChild(saved)
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
    dropChild(existing.value.id)
    await router.push({ name: 'espace' })
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section>
    <h1>{{ existing ? t.children.editTitle(existing.firstName) : t.children.addTitle }}</h1>
    <p v-if="!allowed" class="loading" role="status"><span class="visually-hidden">{{ t.family.loading }}</span></p>
    <div v-else-if="id && children.status === 'error'" class="error" role="alert">
      <p>{{ t.children.loadError }}</p>
      <button class="btn btn-ghost" type="button" @click="loadChildren(true)">{{ t.errors.retry }}</button>
    </div>
    <p v-else-if="id && children.status !== 'ready'" class="loading" role="status"><span class="visually-hidden">{{ t.family.loading }}</span></p>
    <p v-else-if="id && !existing" class="error" role="alert">{{ t.children.notFound }}</p>
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
.loading {
  min-height: 30vh;
  margin: 0;
}
.danger {
  background: var(--danger);
  color: var(--accent-ink);
}
</style>
