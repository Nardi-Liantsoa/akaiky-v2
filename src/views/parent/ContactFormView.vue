<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { addContact, removeContact, updateContact, type ContactInput } from '../../api/contacts'
import { ApiError } from '../../api/http'
import LoadError from '../../components/family/LoadError.vue'
import ColorPicker from '../../components/parent/ColorPicker.vue'
import { useConfirm } from '../../composables/useConfirm'
import { useT } from '../../composables/useT'
import { leastUsedColor, type AvatarColor } from '../../lib/avatar'
import { contactErrorText } from '../../lib/contactErrors'
import { focusFirstInvalid, length } from '../../lib/formErrors'
import { backTo } from '../../lib/navigation'
import { formatPhone, isE164, samePhone } from '../../lib/phone'
import { children, loadChildren, selectChild } from '../../store/children'
import { contacts, loadContacts } from '../../store/contacts'
import { canManage, family, loadFamily } from '../../store/family'
import AppButton from '../../components/ui/AppButton.vue'
import PageHeader from '../../components/ui/PageHeader.vue'
import ConfirmSheet from '../../components/ui/ConfirmSheet.vue'
import FormField from '../../components/ui/FormField.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'

const t = useT()
const route = useRoute()
const router = useRouter()
const childId = computed(() => String(route.params.childId))
const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : null))
const child = computed(() => children.items.find((c) => c.id === childId.value) ?? null)
const existing = computed(() => (id.value && contacts.childId === childId.value ? contacts.items.find((c) => c.id === id.value) ?? null : null))
const name = ref('')
const phone = ref('')
const color = ref<AvatarColor | null>(null)
// Couleur proposée à l'ajout (NAR-222) : envoyée seulement si la personne en choisit une autre,
// sinon le serveur choisit sous son verrou, sur les contacts réels.
const suggested = ref<AvatarColor | null>(null)
const memberUserId = ref<string | null>(null)
const busy = ref(false)
const error = ref('')
// Retrait confirmé par la feuille commune (NAR-184) : rien ne part avant « Confirmer ».
const confirming = useConfirm<string>()

const allowed = computed(() => family.status === 'ready' && canManage())
const ready = computed(() => children.status === 'ready' && contacts.status === 'ready' && contacts.childId === childId.value)
const nameValid = computed(() => { const n = length(name.value); return n >= 1 && n <= 40 })
const phoneValid = computed(() => phone.value.trim().length >= 6)
// Erreurs des champs, montrées à l'envoi (NAR-222) ; chacune s'efface dès que son champ redevient valable.
const nameError = ref('')
const phoneError = ref('')
const form = ref<HTMLFormElement | null>(null)
watch(name, () => { if (nameError.value && nameValid.value) nameError.value = '' })
watch(phone, () => { if (phoneError.value && phoneValid.value) phoneError.value = '' })

onMounted(() => { void loadFamily() })
// Rejoué aussi quand l'adresse change d'enfant (même composant réutilisé).
watch(() => [family.status, family.data?.role, childId.value] as const, ([s]) => {
  if (s !== 'ready') return
  if (!canManage()) { void router.replace({ name: 'reglages-contacts' }); return }
  void loadChildren()
  void loadContacts(childId.value)
}, { immediate: true })
const childGone = computed(() => contacts.error instanceof ApiError && contacts.error.code === 'child_not_found')

// Rempli une fois par adresse ; changer d'adresse repart de zéro.
let filledFor: string | null = null
// Ajout depuis un appel bloqué du journal (« Autoriser », NAR-152) : numéro pré-rempli,
// lu dans l'adresse et vérifié (E.164 seulement) ; le serveur le valide de toute façon.
const prefilled = () => {
  const q = route.query.phone
  return !id.value && isE164(q) ? formatPhone(q) : ''
}
watch([childId, id], () => { filledFor = null; name.value = ''; phone.value = prefilled(); color.value = null; suggested.value = null; memberUserId.value = null; confirming.close(); error.value = ''; nameError.value = ''; phoneError.value = '' }, { immediate: true })
watch(existing, (c) => {
  if (c && c.id !== filledFor) {
    filledFor = c.id
    name.value = c.name
    // Forme lisible (+261 34 12 345 67), comme dans la liste (NAR-207).
    phone.value = formatPhone(c.phone)
    color.value = c.avatarColor
    memberUserId.value = c.memberUserId
  }
}, { immediate: true })

// Ajout : couleur proposée d'office, la moins portée par les contacts de l'enfant (NAR-222).
watch(() => [id.value, ready.value, color.value] as const, ([contactId, isReady, c]) => {
  if (!contactId && isReady && c === null) color.value = suggested.value = leastUsedColor(contacts.items.map((x) => x.avatarColor))
}, { immediate: true })

// Retour sur la section Contacts de l'enfant de l'adresse, même s'il n'était pas celui
// affiché (NAR-185) : retour dans l'historique si l'on en vient, sinon elle remplace la fiche.
const pickChild = () => selectChild(childId.value)
const back = () => { pickChild(); return backTo(router, { name: 'reglages-contacts' }) }

async function save() {
  if (busy.value) return
  nameError.value = nameValid.value ? '' : length(name.value) ? t.value.forms.tooLong(40) : t.value.forms.contactName
  phoneError.value = phoneValid.value ? '' : phone.value.trim() ? t.value.contacts.invalidPhone : t.value.forms.phone
  if (nameError.value || phoneError.value) { await focusFirstInvalid(form.value); return }
  busy.value = true
  error.value = ''
  // Membre lié envoyé seulement s'il a changé : un lien devenu caduc (membre parti)
  // ne fait pas échouer la modification d'un autre champ.
  // En modification, seuls les champs changés partent : un enregistrement sans
  // changement n'écrit rien, et ne défait pas la modification d'un autre gestionnaire.
  const before = existing.value
  const changed = <T,>(now: T, was: T | undefined) => !before || now !== was
  const nameNow = name.value.trim(), phoneNow = phone.value.trim()
  const input: Partial<ContactInput> = {
    ...(changed(nameNow, before?.name) ? { name: nameNow } : {}),
    ...(!before || !samePhone(phoneNow, before.phone) ? { phone: phoneNow } : {}),
    ...(before ? (memberUserId.value !== before.memberUserId ? { memberUserId: memberUserId.value } : {}) : (memberUserId.value !== null ? { memberUserId: memberUserId.value } : {})),
    ...(color.value && changed(color.value, before?.avatarColor) && (before || color.value !== suggested.value) ? { avatarColor: color.value } : {})
  }
  try {
    if (id.value) { if (Object.keys(input).length) await updateContact(id.value, input) }
    else await addContact(childId.value, input as ContactInput)
    // Réglages relit la liste à son arrivée : pas de relecture ici.
    await back()
  } catch (e) {
    error.value = contactErrorText(e, t.value)
    if (e instanceof ApiError && (e.code === 'contact_not_found' || e.code === 'family_role')) {
      void loadContacts(childId.value, true)
      if (e.code === 'family_role') void loadFamily(true)
    }
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
    await removeContact(target)
    await back()
  } catch (e) {
    error.value = contactErrorText(e, t.value)
    void loadContacts(childId.value, true)
  } finally {
    busy.value = false
    // Erreur montrée sur la page (comme pour l'enregistrement), feuille refermée.
    confirming.close()
  }
}
</script>

<template>
  <section>
    <PageHeader
      :back="{ name: 'reglages-contacts' }" :back-label="t.contacts.backLabel" :before="pickChild"
      :title="!id ? t.contacts.addTitle : existing ? t.contacts.editTitle(existing.name) : t.contacts.title"
    />
    <p v-if="child" class="over">{{ t.contacts.phoneOf(child.firstName) }}</p>
    <LoadError v-if="family.status === 'error'" />
    <p v-else-if="allowed && childGone" class="error" role="alert">{{ t.children.notFound }}</p>
    <StatusBlock
      v-else-if="allowed && (children.status === 'error' || contacts.status === 'error')" state="error"
      :text="`${t.contacts.loadError} ${contacts.status === 'error' ? contactErrorText(contacts.error, t) : ''}`"
      @retry="loadChildren(true); loadContacts(childId, true)"
    />
    <StatusBlock v-else-if="!allowed || !ready" state="loading" fill />
    <p v-else-if="!child" class="error" role="alert">{{ t.children.notFound }}</p>
    <p v-else-if="id && !existing" class="error" role="alert">{{ t.contacts.notFound }}</p>
    <template v-else>
      <form ref="form" class="card" novalidate @submit.prevent="save">
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <FormField id="contact-name" :label="t.contacts.name" :error="nameError" v-slot="{ control }">
          <input v-bind="control" v-model="name" class="input" autocomplete="off" required :placeholder="t.contacts.namePlaceholder" data-selectable />
        </FormField>
        <FormField id="contact-phone" :label="t.contacts.phone" :error="phoneError" v-slot="{ control }">
          <input v-bind="control" v-model="phone" class="input" type="tel" inputmode="tel" autocomplete="off" required :placeholder="t.contacts.phonePlaceholder[contacts.country]" data-selectable />
        </FormField>
        <FormField id="contact-member" :label="t.contacts.member" v-slot="{ control }">
          <select v-bind="control" v-model="memberUserId" class="input">
            <option :value="null">{{ t.contacts.noMember }}</option>
            <option v-for="m in family.data?.members ?? []" :key="m.userId" :value="m.userId">{{ m.name }} · {{ t.family.roles[m.role] }}</option>
          </select>
        </FormField>
        <ColorPicker v-model="color" name="contact-color" :legend="t.contacts.color" :avatar="name" />
        <div class="actions">
          <AppButton type="submit" :disabled="busy">{{ t.contacts.save }}</AppButton>
        </div>
      </form>
      <div v-if="existing" class="danger-zone">
        <AppButton variant="ghost" :disabled="busy" @click="confirming.ask(existing.id, $event)">{{ t.contacts.remove }}</AppButton>
      </div>
      <ConfirmSheet
        v-if="existing && confirming.target.value === existing.id" id="contact-remove" :title="t.contacts.removeTitle(existing.name)"
        :items="t.contacts.removeItems" :confirm="t.contacts.confirmRemove" :busy="busy" :opener="confirming.opener.value"
        @close="confirming.close()" @confirm="remove"
      />
    </template>
  </section>
</template>

<style scoped>
.over {
  /* Sous l'en-tête de page : à quel enfant appartient ce contact. */
  margin: calc(-1 * var(--space-3)) 0 var(--space-4);
  text-align: center;
  color: var(--text-soft);
  font-weight: 700;
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
