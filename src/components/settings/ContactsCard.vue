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
import { contactErrorText } from '../../lib/contactErrors'
import { formatPhone } from '../../lib/phone'
import { contacts, loadContacts } from '../../store/contacts'
import { canManage } from '../../store/family'

const props = defineProps<{ childId: string }>()
const t = useT()
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
  <SectionCard class="contacts" :class="{ stale: !fresh }" :aria-busy="!fresh" :title="t.contacts.title" :help="t.contacts.orderHint">
    <template #aside>
      <span class="count">{{ t.contacts.count(shown.length, contacts.max) }}</span>
    </template>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <ol v-if="shown.length" ref="list" class="list">
      <li v-for="(c, i) in shown" :key="c.id">
        <span class="rank" aria-hidden="true">{{ c.position }}</span>
        <!-- Gestionnaire : la ligne du contact ouvre sa fiche (« Modifier Maman ») ; nom, rôle et
             numéro restent lus, en description. Plus de bouton ✎ : la ligne tient à 360 px (NAR-207). -->
        <component
          :is="canManage() ? RouterLink : 'span'" class="contact"
          v-bind="canManage() ? { to: { name: 'contact', params: { childId, id: c.id } }, 'aria-label': t.contacts.edit(c.name), 'aria-describedby': `${c.memberRole ? `contact-role-${c.id} ` : ''}contact-phone-${c.id}` } : {}"
        >
          <ChildAvatar :name="c.name" :color="c.avatarColor" :size="36" />
          <span class="who">
            <span class="name">{{ c.name }}</span>
            <span v-if="c.memberRole" :id="`contact-role-${c.id}`" class="role">{{ t.family.roles[c.memberRole] }}</span>
            <span :id="`contact-phone-${c.id}`" class="phone" data-selectable>{{ formatPhone(c.phone) }}</span>
          </span>
          <AppIcon v-if="canManage()" class="go" name="chevron-right" :size="20" />
        </component>
        <span v-if="canManage()" class="actions">
          <!-- Déplacement impossible (premier, dernier) : flèche absente plutôt que grisée (NAR-222) ;
               une place vide garde les flèches alignées d'une ligne à l'autre. -->
          <button v-if="i > 0" class="icon" type="button" :disabled="busy" :aria-label="t.contacts.moveUp(c.name)" @click="move(i, -1)">↑</button>
          <span v-else class="icon-gap" aria-hidden="true" />
          <button v-if="i < shown.length - 1" class="icon" type="button" :disabled="busy" :aria-label="t.contacts.moveDown(c.name)" @click="move(i, 1)">↓</button>
          <span v-else class="icon-gap" aria-hidden="true" />
        </span>
      </li>
    </ol>
    <StatusBlock v-else state="empty" :text="t.contacts.empty" />
    <RouterLink v-if="canManage() && shown.length < contacts.max" class="add" :to="{ name: 'contact-nouveau', params: { childId } }">
      + {{ t.contacts.add }}
    </RouterLink>
  </SectionCard>
</template>

<style scoped>
.stale {
  opacity: 0.45;
  pointer-events: none;
  transition: opacity 0.15s;
}
.count {
  color: var(--text-soft);
  font-weight: 700;
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
  gap: 8px;
  padding: 12px 0;
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
  gap: 8px;
  min-height: var(--tap);
  border-radius: var(--radius-sm);
  color: inherit;
  text-decoration: none;
}
.go {
  flex: none;
  color: var(--text-soft);
}
.who {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
}
.name {
  font-weight: 800;
  overflow-wrap: anywhere;
}
.role,
.phone {
  color: var(--text-soft);
  font-weight: 600;
  font-size: 0.92rem;
}
/* Un numéro ne se coupe jamais au milieu. */
.phone {
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
  /* Ses 28 px vont au numéro entier : la ligne reste un lien (« Modifier Maman »). */
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
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
}
.icon-gap {
  width: var(--tap);
  height: var(--tap);
}
.icon:disabled {
  opacity: 0.35;
  cursor: default;
}
.icon:focus-visible,
.contact:focus-visible,
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
