<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter, type RouteLocationNormalized } from 'vue-router'
import { addChild, removeChild, updateChild } from '../../api/children'
import { ApiError } from '../../api/http'
import LoadError from '../../components/family/LoadError.vue'
import ChildAvatar from '../../components/parent/ChildAvatar.vue'
import ConsentCheckbox from '../../components/account/ConsentCheckbox.vue'
import { useConfirm } from '../../composables/useConfirm'
import { useT } from '../../composables/useT'
import { AVATAR_COLORS, type AvatarColor } from '../../lib/avatar'
import { errorText } from '../../lib/errors'
import { children, dropChild, loadChildren, selectChild, upsertChild } from '../../store/children'
import { contacts } from '../../store/contacts'
import { canManage, family, loadFamily } from '../../store/family'
import AppButton from '../../components/ui/AppButton.vue'
import BackLink from '../../components/ui/BackLink.vue'
import ConfirmSheet from '../../components/ui/ConfirmSheet.vue'
import FormField from '../../components/ui/FormField.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'

const t = useT()
const route = useRoute()
const router = useRouter()
const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : null))
const existing = computed(() => (id.value ? children.items.find((c) => c.id === id.value) ?? null : null))
const name = ref('')
// Numéro de l'enfant (NAR-194), facultatif : vide = aucun numéro (null envoyé).
const phone = ref('')
// null : aucune couleur choisie à l'ajout, le serveur applique sa rotation.
const color = ref<AvatarColor | null>(null)
const busy = ref(false)
const error = ref('')
// Retrait confirmé par la feuille commune (NAR-184) : rien ne part avant « Confirmer ».
const confirming = useConfirm<string>()
// Ajout seulement (NAR-178) : autorité parentale et journalisation acceptées.
const consent = ref(false)
const consentError = ref('')

const valid = computed(() => { const n = [...name.value.trim()].length; return n >= 1 && n <= 40 })
// Formulaire montré seulement à un gestionnaire, une fois la famille connue.
const allowed = computed(() => family.status === 'ready' && canManage())

// Modifications non enregistrées (NAR-195, modification seulement) : valeurs lues au
// remplissage du formulaire, comparées à la saisie. Quitter l'écran (« ‹ Accueil », barre
// d'onglets, retour Android ou du navigateur) les fait confirmer par la feuille commune ;
// rien de changé, ou enregistrement réussi : on part sans question.
const initial = shallowRef<{ name: string, phone: string, color: AvatarColor | null } | null>(null)
const dirty = computed(() => {
  const base = initial.value
  if (!id.value || !base || !allowed.value || !existing.value) return false
  return name.value.trim() !== base.name || phone.value.trim() !== base.phone || color.value !== base.color
})
// Départ voulu (enregistré, retiré) : la garde laisse passer.
let leaving = false
// Sorties en attente de la réponse (true quitte, false reste). Une autre sortie demandée
// pendant la question (retour du navigateur) attend la même réponse : aucune n'est
// abandonnée en route, ce qui refermerait la feuille sous les yeux du parent.
const leaveWaiters: Array<(leave: boolean) => void> = []
const asking = ref(false)
function answerLeave(leave: boolean) {
  asking.value = false
  for (const answer of leaveWaiters.splice(0)) answer(leave)
}
function confirmLeave(): true | Promise<boolean> {
  if (leaving || !dirty.value) return true
  asking.value = true
  return new Promise<boolean>((resolve) => { leaveWaiters.push(resolve) })
}
onBeforeRouteLeave(() => confirmLeave())
// Même écran, autre enfant ou ajout (composant réutilisé) : même question.
onBeforeRouteUpdate((to: RouteLocationNormalized, from: RouteLocationNormalized) => (to.params.id === from.params.id ? true : confirmLeave()))

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
  if (e instanceof ApiError && e.code === 'invalid_phone') return t.value.contacts.invalidPhone
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
  initial.value = null
  answerLeave(false)
  name.value = ''
  phone.value = ''
  color.value = null
  confirming.close()
  error.value = ''
  consent.value = false
  consentError.value = ''
}
watch(id, reset)
watch(existing, (c) => {
  if (c && c.id !== filledFor) {
    filledFor = c.id
    name.value = c.firstName
    phone.value = c.phone ?? ''
    color.value = c.avatarColor
    initial.value = { name: c.firstName.trim(), phone: (c.phone ?? '').trim(), color: c.avatarColor }
  }
}, { immediate: true })

async function save() {
  if (busy.value || !valid.value) return
  consentError.value = ''
  if (!id.value && !consent.value) { consentError.value = t.value.consent.required; return }
  busy.value = true
  error.value = ''
  try {
    // L'adresse décide : /enfant/:id modifie, /enfant/nouveau ajoute.
    // Numéro envoyé seulement s'il change : un numéro inchangé n'est pas réécrit.
    const phoneNow = phone.value.trim() || null
    const phoneChanged = phoneNow !== (existing.value?.phone ?? null)
    const saved = id.value
      ? await updateChild(id.value, { firstName: name.value.trim(), ...(color.value ? { avatarColor: color.value } : {}), ...(phoneChanged ? { phone: phoneNow } : {}) })
      : await addChild(name.value.trim(), color.value ?? undefined, phoneNow)
    upsertChild(saved)
    selectChild(saved.id)
    leaving = true
    await router.push({ name: 'espace' })
  } catch (e) {
    error.value = message(e)
    forgetIfGone(e, id.value)
  } finally {
    busy.value = false
  }
}

async function remove() {
  const target = confirming.target.value
  if (!target || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await removeChild(target)
    dropChild(target)
    leaving = true
    await router.push({ name: 'espace' })
  } catch (e) {
    error.value = message(e)
    forgetIfGone(e, target)
  } finally {
    busy.value = false
    // Erreur montrée sur la page (comme pour l'enregistrement), feuille refermée.
    confirming.close()
  }
}
</script>

<template>
  <section>
    <BackLink :to="{ name: 'espace' }" :label="t.parent.home.back" :aria-label="t.parent.home.backLabel" />
    <h1>{{ !id ? t.children.addTitle : existing ? t.children.editTitle(existing.firstName) : t.children.edit }}</h1>
    <LoadError v-if="family.status === 'error'" />
    <StatusBlock v-else-if="allowed && id && children.status === 'error'" state="error" :text="t.children.loadError" @retry="loadChildren(true)" />
    <!-- Un seul bloc pour la famille puis la liste des enfants : annoncé une fois. -->
    <StatusBlock v-else-if="!allowed || (id && children.status !== 'ready')" state="loading" fill />
    <p v-else-if="id && !existing" class="error" role="alert">{{ t.children.notFound }}</p>
    <form v-else class="card" @submit.prevent="save">
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <FormField id="child-name" :label="t.children.firstName" v-slot="{ control }">
        <input v-bind="control" v-model="name" class="input" autocomplete="off" required data-selectable />
      </FormField>
      <!-- Même saisie que le numéro d'un contact ; formulaire réservé aux gestionnaires (allowed). -->
      <FormField id="child-phone" :label="t.children.phoneNumber" :help="t.children.phoneNumberHelp" v-slot="{ control }">
        <input v-bind="control" v-model="phone" class="input" type="tel" inputmode="tel" autocomplete="off" :placeholder="t.contacts.phonePlaceholder[contacts.country]" data-selectable />
      </FormField>
      <fieldset class="field colors">
        <legend>{{ t.children.color }}</legend>
        <label v-for="c in AVATAR_COLORS" :key="c" class="swatch">
          <input v-model="color" type="radio" name="child-color" :value="c" :aria-label="t.children.colors[c]" />
          <!-- Prénom encore vide : pastille unie, sans « ? ». -->
          <ChildAvatar :name="name" :color="c" :size="44" />
        </label>
      </fieldset>
      <ConsentCheckbox v-if="!id" id="child-consent" v-model="consent" :label="t.consent.child" v-model:error="consentError" />
      <div class="actions">
        <AppButton type="submit" :disabled="busy || !valid">{{ t.children.save }}</AppButton>
      </div>
    </form>

    <div v-if="existing && allowed" class="danger-zone">
      <p class="help">{{ t.children.removeHint }}</p>
      <AppButton variant="ghost" :disabled="busy" @click="confirming.ask(existing.id, $event)">{{ t.children.remove }}</AppButton>
    </div>
    <ConfirmSheet
      v-if="existing && confirming.target.value === existing.id" id="child-remove" :title="t.children.removeTitle(existing.firstName)"
      :items="t.children.removeItems" :confirm="t.children.confirmRemove" :busy="busy" :opener="confirming.opener.value"
      @close="confirming.close()" @confirm="remove"
    />
    <ConfirmSheet
      v-if="asking" id="child-leave" :title="t.children.unsavedTitle" :items="t.children.unsavedItems"
      :confirm="t.children.unsavedConfirm" @close="answerLeave(false)" @confirm="answerLeave(true)"
    />
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
</style>
