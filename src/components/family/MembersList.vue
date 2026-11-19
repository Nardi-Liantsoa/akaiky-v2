<script setup lang="ts">
import { computed, ref } from 'vue'
import { removeMember, setMemberRole, type FamilyMember, type FamilyRole } from '../../api/families'
import { useT } from '../../composables/useT'
import { familyErrorText } from '../../lib/familyErrors'
import { family, loadFamily } from '../../store/family'
import AppButton from '../ui/AppButton.vue'

const emit = defineEmits<{ changed: [] }>()
const t = useT()
const busy = ref(false)
const error = ref('')
// Retrait en deux temps (pas de boîte de dialogue native) : id du membre à confirmer.
const confirming = ref<string | null>(null)
// Incrémenté après chaque action : la liste est redessinée depuis l'état relu,
// même si un refus laisse le rôle inchangé (le menu revient alors à la vraie valeur).
const version = ref(0)

const myRole = computed(() => family.data?.role)
// Mêmes règles que le serveur, pour n'afficher que les actions possibles :
// owner touche à tout ; manager entre manager et member, jamais un owner.
const canEdit = (m: FamilyMember) => !m.isMe && (myRole.value === 'owner' || (myRole.value === 'manager' && m.role !== 'owner'))
const roleChoices = computed<FamilyRole[]>(() => myRole.value === 'owner' ? ['owner', 'manager', 'member'] : ['manager', 'member'])

async function run(task: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await task()
    confirming.value = null
  } catch (e) {
    error.value = familyErrorText(e, t.value)
  } finally {
    // Dans tous les cas, l'état affiché est relu : un refus vient souvent d'un changement fait ailleurs.
    await loadFamily(true)
    version.value++
    // Un rôle retiré ou un départ peut supprimer des invitations en attente.
    emit('changed')
    busy.value = false
  }
}

const changeRole = (m: FamilyMember, role: FamilyRole) => run(() => setMemberRole(m.userId, role))
const remove = (m: FamilyMember) => run(() => removeMember(m.userId))
</script>

<template>
  <div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <ul v-if="family.data" :key="version" class="card members">
      <li v-for="m in family.data.members" :key="m.userId">
        <span class="who">
          <span class="name">{{ m.name }}</span><span v-if="m.isMe" class="me"> ({{ t.family.you }})</span>
        </span>
        <span class="actions">
          <select v-if="canEdit(m)" class="input role-select" :aria-label="t.family.roleOf(m.name)" :value="m.role" :disabled="busy"
                  @change="changeRole(m, ($event.target as HTMLSelectElement).value as FamilyRole)">
            <option v-for="r in roleChoices" :key="r" :value="r">{{ t.family.roles[r] }}</option>
          </select>
          <span v-else class="role">{{ t.family.roles[m.role] }}</span>
          <template v-if="canEdit(m) || m.isMe">
            <AppButton v-if="confirming !== m.userId" variant="ghost" small :disabled="busy" @click="confirming = m.userId">
              {{ m.isMe ? t.family.leave : t.family.remove }}
            </AppButton>
            <AppButton v-else variant="danger" small :disabled="busy" @click="remove(m)">
              {{ m.isMe ? t.family.confirmLeave : t.family.confirmRemove }}
            </AppButton>
          </template>
        </span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.members {
  list-style: none;
  margin: 0;
  padding: 8px 24px;
}
.members li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
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
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.role-select {
  width: auto;
  padding: 8px 10px;
}
</style>
