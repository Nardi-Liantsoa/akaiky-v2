<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { addChild, removeChild, updateChild } from '../../api/children'
import { ApiError } from '../../api/http'
import LoadError from '../../components/family/LoadError.vue'
import ChildAvatar from '../../components/parent/ChildAvatar.vue'
import ConsentCheckbox from '../../components/account/ConsentCheckbox.vue'
import { useT } from '../../composables/useT'
import { AVATAR_COLORS, type AvatarColor } from '../../lib/avatar'
import { errorText } from '../../lib/errors'
import { children, dropChild, loadChildren, selectChild, upsertChild } from '../../store/children'
import { canManage, family, loadFamily } from '../../store/family'
import AppButton from '../../components/ui/AppButton.vue'

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
// Ajout seulement (NAR-178) : autorité parentale et journalisation acceptées.
const consent = ref(false)
const consentError = ref('')

const valid = computed(() => { const n = [...name.value.trim()].length; return n >= 1 && n <= 40 })
// Formulaire montré seulement à un gestionnaire, une fois la famille connue.
const allowed = computed(() => family.status === 'ready' && canManage())

// Enfant retiré ailleurs entre-temps : il quitte aussi la liste affichée.
// Rôle retiré ailleurs (403) : la famille est relue, les actions disparaissent.
function forgetIfGone(e: unknown, childId: string | null) {
  if (childId && e instanceof ApiError && e.code === 'child_not_found') dropChild(childId)
  if (e instanceof ApiError && e.code === 'family_role') void loadFamily(true)
}

function message(e: unknown): string {
  if (e instanceof ApiError && e.code === 'too_many_children') return t.value.children.tooMany
  if (e instanceof ApiError && e.code === 'child_not_found') return t.value.children.notFound
  if (e instanceof ApiError && e.code === 'consent_required') return t.value.consent.required
  return errorText(e, t.value)
}

onMounted(() => { void loadFamily() })
// Enfants chargés une fois la famille connue (jamais en parallèle avec elle) ;
// un non-gestionnaire est renvoyé à l'accueil, y compris si son rôle change en route.
watch(() => [family.status, family.data?.role] as const, ([s]) => {
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
  consent.value = false
  consentError.value = ''
}
watch(id, reset)
watch(existing, (c) => {
  if (c && c.id !== filledFor) { filledFor = c.id; name.value = c.firstName; color.value = c.avatarColor }
}, { immediate: true })

async function save() {
  if (busy.value || !valid.value) return
  consentError.value = ''
  if (!id.value && !consent.value) { consentError.value = t.value.consent.required; return }
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
    forgetIfGone(e, id.value)
  } finally {
    busy.value = false
  }
}

async function remove() {
  const target = existing.value?.id
  if (!target || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await removeChild(target)
    dropChild(target)
    await router.push({ name: 'espace' })
  } catch (e) {
    error.value = message(e)
    forgetIfGone(e, target)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section>
    <h1>{{ !id ? t.children.addTitle : existing ? t.children.editTitle(existing.firstName) : t.children.edit }}</h1>
    <LoadError v-if="family.status === 'error'" />
    <p v-else-if="!allowed" class="loading" role="status"><span class="visually-hidden">{{ t.family.loading }}</span></p>
    <div v-else-if="id && children.status === 'error'" class="error" role="alert">
      <p>{{ t.children.loadError }}</p>
      <AppButton variant="ghost" @click="loadChildren(true)">{{ t.errors.retry }}</AppButton>
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
      <ConsentCheckbox v-if="!id" id="child-consent" v-model="consent" :label="t.consent.child" v-model:error="consentError" />
      <div class="actions">
        <AppButton type="submit" :disabled="busy || !valid">{{ t.children.save }}</AppButton>
        <RouterLink class="btn btn-ghost" :to="{ name: 'espace' }">{{ t.children.cancel }}</RouterLink>
      </div>
    </form>

    <RouterLink v-if="existing && allowed" class="btn btn-ghost phone" :to="{ name: 'telephone', params: { id: existing.id } }">
      {{ t.pairing.open }}
    </RouterLink>

    <div v-if="existing && allowed" class="danger-zone">
      <p class="hint">{{ t.children.removeHint }}</p>
      <AppButton v-if="!confirming" variant="ghost" :disabled="busy" @click="confirming = true">{{ t.children.remove }}</AppButton>
      <AppButton v-else variant="danger" :disabled="busy" @click="remove">{{ t.children.confirmRemove }}</AppButton>
    </div>
  </section>
</template>

<style scoped>
h1 {
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
.phone {
  margin-top: 20px;
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
</style>
