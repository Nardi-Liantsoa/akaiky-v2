<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { deleteFamily, renameFamily } from '../../api/families'
import DeleteConfirm from '../../components/account/DeleteConfirm.vue'
import { ApiError } from '../../api/http'
import InviteForm from '../../components/family/InviteForm.vue'
import LoadError from '../../components/family/LoadError.vue'
import MembersList from '../../components/family/MembersList.vue'
import PendingInvitations from '../../components/family/PendingInvitations.vue'
import { useT } from '../../composables/useT'
import { FAMILY_NAME_MAX, familyNameValid } from '../../lib/familyName'
import { focusFirstInvalid, length } from '../../lib/formErrors'
import { errorText } from '../../lib/errors'
import { canManage, family, loadFamily, setFamilyName, setNoFamily } from '../../store/family'
import { notice } from '../../store/notice'
import AppButton from '../../components/ui/AppButton.vue'
import AppIcon from '../../components/ui/AppIcon.vue'
import FormField from '../../components/ui/FormField.vue'
import FamilyExport from '../../components/family/FamilyExport.vue'
import DisclosureCard from '../../components/ui/DisclosureCard.vue'

const t = useT()
const router = useRouter()
const editing = ref(false)
const name = ref('')
const busy = ref(false)
const error = ref('')
const sent = ref(0)
// Nom refusé à l'envoi : erreur sous le champ, focus dessus (NAR-222) ; le bouton n'est jamais grisé.
const nameError = ref('')
const renameForm = ref<HTMLFormElement | null>(null)
watch(name, (v) => { if (nameError.value && familyNameValid(v)) nameError.value = '' })

onMounted(() => { void loadFamily() })

function edit() {
  name.value = family.data?.name ?? ''
  error.value = ''
  nameError.value = ''
  editing.value = true
}

// Zone sensible (owner) : suppression de la famille, mot de passe redemandé.
const deleting = ref(false)
const deleteError = ref('')
async function removeFamily(password: string) {
  if (deleting.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await deleteFamily(password)
    // État « sans famille » posé localement (pas de relecture qui pourrait échouer) :
    // l'accueil présente la création, avec la confirmation.
    // Clé posée avant la navigation : CreateFamily la lit à son montage.
    setNoFamily()
    notice.value = 'familyDeleted'
    await router.replace({ name: 'espace' })
  } catch (e) {
    deleteError.value = e instanceof ApiError && e.code === 'wrong_password' ? t.value.deletion.wrongPassword : errorText(e, t.value)
    // Rôle changé ailleurs : l'état affiché est périmé.
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) await loadFamily(true)
  } finally {
    deleting.value = false
  }
}

async function save() {
  if (busy.value) return
  if (!familyNameValid(name.value)) {
    nameError.value = length(name.value) ? t.value.forms.tooLong(FAMILY_NAME_MAX) : t.value.forms.familyName
    await focusFirstInvalid(renameForm.value)
    return
  }
  nameError.value = ''
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
        <form v-if="editing" ref="renameForm" class="rename" novalidate @submit.prevent="save">
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <FormField id="family-rename" :label="t.family.nameLabel" :error="nameError" v-slot="{ control }">
            <input v-bind="control" v-model="name" class="input" autocomplete="off" data-selectable />
          </FormField>
          <div class="actions">
            <AppButton type="submit" :disabled="busy"><AppIcon name="check" :size="20" />{{ t.family.save }}</AppButton>
            <AppButton variant="ghost" @click="editing = false"><AppIcon name="cross" :size="20" />{{ t.family.cancel }}</AppButton>
          </div>
        </form>
        <template v-else>
          <h2>{{ family.data.name }}</h2>
          <AppButton v-if="canManage()" variant="ghost" @click="edit"><AppIcon name="edit" :size="20" />{{ t.family.rename }}</AppButton>
        </template>
      </div>

      <p v-if="error && !editing" class="error" role="alert">{{ error }}</p>
      <!-- Page découpée (NAR-228, design créé d'après Réglages) : chaque partie dans une carte
           repliable, ouverte en un geste ; les membres dépliés d'office. -->
      <DisclosureCard class="part" :title="t.family.membersSection" icon="users" :summary="t.family.membersSummary(family.data.members.length)" open>
        <MembersList @changed="sent++" />
        <template v-if="canManage()">
          <PendingInvitations :refresh="sent" />
          <div class="invite">
            <InviteForm @sent="sent++" />
          </div>
        </template>
      </DisclosureCard>
      <!-- Export de la famille (NAR-178), rangé ici depuis la sécurité du compte (NAR-209). -->
      <DisclosureCard v-if="canManage()" class="part" :title="t.dataExport.title" icon="download" :summary="t.family.dataSummary">
        <FamilyExport />
      </DisclosureCard>
    </template>
    <!-- Le compte de la session a sa page (NAR-209) : un seul lien ici, famille lisible ou non ;
         la zone sensible reste la dernière. -->
    <RouterLink class="card account-link" :to="{ name: 'securite' }">
      <span class="account-icon" aria-hidden="true"><AppIcon name="user" /></span>
      <span class="account-text">
        <span class="account-title">{{ t.parent.account.title }}</span>
        <span class="account-summary">{{ t.parent.account.summary }}</span>
      </span>
      <AppIcon name="chevron-right" :size="20" />
    </RouterLink>
    <template v-if="family.status !== 'error' && family.data?.role === 'owner'">
      <h2 class="section">{{ t.deletion.zone }}</h2>
      <DeleteConfirm id="delete-family" :title="t.deletion.familyAction" :lead="t.deletion.familyLead"
        :items="t.deletion.familyItems" :action="t.deletion.familyAction" :confirm="t.deletion.familyConfirm"
        :busy="deleting" :error="deleteError" @cancel="deleteError = ''" @confirm="removeFamily" />
    </template>
  </section>
</template>

<style scoped>
h1 {
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
  margin: var(--space-6) 0 var(--space-3);
}
.part {
  margin-top: var(--space-3);
}
.invite {
  margin-top: 28px;
}
.account-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: var(--tap);
  margin-top: var(--space-3);
  padding-block: var(--space-4);
  color: var(--text);
  text-decoration: none;
}
.account-link:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
.account-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-pill);
  background: var(--surface-muted);
  color: var(--ink);
}
.account-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.account-title {
  font-weight: 800;
}
.account-summary {
  color: var(--text-soft);
  font-size: var(--fs-small);
}
.account-link :deep(svg) {
  flex: none;
  color: var(--text-soft);
}
</style>
