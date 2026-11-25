<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ApiError } from '../../api/http'
import { reorderContacts } from '../../api/contacts'
import ChildAvatar from '../parent/ChildAvatar.vue'
import AppIcon from '../ui/AppIcon.vue'
import SectionCard from '../ui/SectionCard.vue'
import StatusBlock from '../ui/StatusBlock.vue'
import { useT } from '../../composables/useT'
import { useMediaQuery } from '../../composables/useMediaQuery'
import { contactErrorText } from '../../lib/contactErrors'
import { formatPhone } from '../../lib/phone'
import { children } from '../../store/children'
import { contacts, loadContacts } from '../../store/contacts'
import { canManage } from '../../store/family'

const props = defineProps<{ childId: string }>()
const t = useT()
// Écran large (maquette 05, NAR-232) : bouton « Modifier » par ligne. Téléphone : la ligne entière
// ouvre la fiche (NAR-207), la place va au nom et au numéro.
const wide = useMediaQuery('(min-width: 560px)')
const childName = computed(() => children.items.find((c) => c.id === props.childId)?.firstName ?? '')
const busy = ref(false)
const error = ref('')

// Changement d'enfant : la liste précédente reste affichée, estompée et inactive, le
// temps que celle du nouvel enfant arrive (pas de carte qui disparaît puis revient).
const fresh = computed(() => contacts.status === 'ready' && contacts.childId === props.childId)
const snapshot = ref<typeof contacts.items>([])
watch(fresh, (ok) => { if (ok) snapshot.value = contacts.items }, { immediate: true })
watch(() => contacts.items, (items) => { if (fresh.value) snapshot.value = items })
const shown = computed(() => (fresh.value ? contacts.items : snapshot.value))

// Réorganisation par boutons Monter / Descendre : utilisable au doigt, au clavier
// et au lecteur d'écran (le glisser-déposer HTML ne fonctionne pas dans les WebView mobiles).
const list = ref<HTMLOListElement | null>(null)
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
  // Relecture en échec : Réglages l'annonce déjà (bandeau avec « Réessayer »).
  await loadContacts(props.childId, true)
  busy.value = false
  // La flèche touchée peut disparaître (contact arrivé premier ou dernier, NAR-222) : le focus
  // suit le contact déplacé, sur sa flèche dans le même sens, sinon sur l'autre.
  const moved = contacts.items.find((c) => c.id === ids[target])
  if (moved) {
    await nextTick()
    const labels = delta < 0 ? [t.value.contacts.moveUp(moved.name), t.value.contacts.moveDown(moved.name)] : [t.value.contacts.moveDown(moved.name), t.value.contacts.moveUp(moved.name)]
    const buttons = [...(list.value?.querySelectorAll<HTMLButtonElement>('button.icon') ?? [])]
    labels.map((l) => buttons.find((b) => b.getAttribute('aria-label') === l)).find(Boolean)?.focus()
  }
}
</script>

<template>
  <SectionCard class="contacts" :class="{ stale: !fresh }" :aria-busy="!fresh" :title="t.contacts.title" :help="childName ? t.contacts.intro(childName) : t.contacts.orderHint">
    <template #aside>
      <span class="count-badge">{{ t.contacts.count(shown.length, contacts.max) }}</span>
    </template>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <ol v-if="shown.length" ref="list" class="list">
      <li v-for="(c, i) in shown" :key="c.id">
        <span class="rank" aria-hidden="true">{{ c.position }}</span>
        <!-- Téléphone, gestionnaire : la ligne du contact ouvre sa fiche (« Modifier Maman ») ; nom,
             rôle et numéro restent lus, en description (NAR-207). Écran large : bouton « Modifier ». -->
        <component
          :is="canManage() && !wide ? RouterLink : 'span'" class="contact"
          v-bind="canManage() && !wide ? { to: { name: 'contact', params: { childId, id: c.id } }, 'aria-label': t.contacts.edit(c.name), 'aria-describedby': `${c.memberRole ? `contact-role-${c.id} ` : ''}contact-phone-${c.id}` } : {}"
        >
          <ChildAvatar :name="c.name" :color="c.avatarColor" :size="wide ? 48 : 40" />
          <span class="who">
            <span class="name-line">
              <span class="name">{{ c.name }}</span>
              <span v-if="c.memberRole" :id="`contact-role-${c.id}`" class="role">{{ t.family.roles[c.memberRole] }}</span>
            </span>
            <span :id="`contact-phone-${c.id}`" class="phone" data-selectable>{{ formatPhone(c.phone) }}</span>
          </span>
          <!-- Téléphone : la ligne s'ouvre ; le chevron le montre (caché sous 400 px, place au numéro). -->
          <AppIcon v-if="canManage() && !wide" class="go" name="chevron-right" :size="20" />
        </component>
        <span v-if="canManage()" class="actions">
          <!-- Déplacement impossible (premier, dernier) : flèche absente plutôt que grisée (NAR-222) ;
               une place vide garde les flèches alignées d'une ligne à l'autre. -->
          <button v-if="i > 0" class="icon" type="button" :disabled="busy" :aria-label="t.contacts.moveUp(c.name)" @click="move(i, -1)"><AppIcon name="chevron-up" :size="22" /></button>
          <span v-else class="icon-gap" aria-hidden="true" />
          <button v-if="i < shown.length - 1" class="icon" type="button" :disabled="busy" :aria-label="t.contacts.moveDown(c.name)" @click="move(i, 1)"><AppIcon name="chevron-down" :size="22" /></button>
          <span v-else class="icon-gap" aria-hidden="true" />
        </span>
        <RouterLink
          v-if="canManage() && wide" class="btn btn-ghost edit" :to="{ name: 'contact', params: { childId, id: c.id } }"
          :aria-label="t.contacts.edit(c.name)"
        >
          {{ t.contacts.editShort }}
        </RouterLink>
      </li>
    </ol>
    <StatusBlock v-else state="empty" :text="t.contacts.empty" />
    <RouterLink v-if="canManage() && shown.length < contacts.max" class="btn btn-tinted add" :to="{ name: 'contact-nouveau', params: { childId } }">
      <AppIcon name="plus" :size="20" />{{ t.contacts.add }}
    </RouterLink>
  </SectionCard>
</template>

<style scoped>
/* Maquette 05 (NAR-232) : compteur en badge teinté ; lignes rang · avatar · nom + rôle en badge ·
 * numéro ; flèches d'ordre sans cadre ; « Modifier » bordé (écran large) ; ajout en bouton teinté. */
.stale {
  opacity: 0.45;
  pointer-events: none;
  transition: opacity 0.15s;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.rank {
  width: 1.2em;
  color: var(--text-soft);
  font-weight: 800;
  text-align: center;
}
.contact {
  display: flex;
  /* Base 0 : la ligne ne passe à la suivante que si le contact ne tient pas à sa largeur
     minimale (numéro entier), pas dès que le nom est long. */
  flex: 1 1 0;
  align-items: center;
  gap: 12px;
  min-height: var(--tap);
  border-radius: var(--radius-sm);
  color: inherit;
  text-decoration: none;
}
.who {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
}
.name-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}
.name {
  font-weight: 800;
  overflow-wrap: anywhere;
}
.role {
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-soft);
  font-size: var(--fs-small);
  font-weight: 800;
}
/* Un numéro ne se coupe jamais au milieu. */
.phone {
  color: var(--text-soft);
  font-weight: 600;
  white-space: nowrap;
}
.actions {
  display: flex;
  flex: none;
  gap: 2px;
  /* Place trop juste (police agrandie, 320 px) : les boutons passent sous le contact, à
     droite, plutôt que le numéro, jamais coupé, ne passe dessous. */
  margin-left: auto;
}
/* Téléphone étroit : Monter au-dessus de Descendre, la ligne garde sa largeur pour le
   nom et le numéro (cibles de 48 px gardées). */
@media (max-width: 400px) {
  .actions {
    flex-direction: column;
  }
  /* Place pour le numéro entier à côté des flèches : écarts resserrés (avatar de 40 px), sans
     chevron (la ligne reste un lien « Modifier Maman »). */
  .list li,
  .contact {
    gap: 8px;
  }
  .go {
    display: none;
  }
}
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--tap);
  height: var(--tap);
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-soft);
  cursor: pointer;
}
.icon:hover:not(:disabled) {
  background: var(--surface-muted);
}
.icon-gap {
  width: var(--tap);
  height: var(--tap);
}
.icon:disabled {
  opacity: 0.35;
  cursor: default;
}
.edit {
  flex: none;
}
.go {
  flex: none;
  color: var(--text-soft);
}
.icon:focus-visible,
.contact:focus-visible,
.add:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
.add {
  gap: 8px;
  margin-top: var(--space-4);
}
</style>
