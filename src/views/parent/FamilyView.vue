<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { deleteFamily, renameFamily } from '../../api/families'
import DeleteConfirm from '../../components/account/DeleteConfirm.vue'
import { ApiError } from '../../api/http'
import InviteForm from '../../components/family/InviteForm.vue'
import LoadError from '../../components/family/LoadError.vue'
import MembersList from '../../components/family/MembersList.vue'
import PendingInvitations from '../../components/family/PendingInvitations.vue'
import { useT } from '../../composables/useT'
import { familyNameValid } from '../../lib/familyName'
import { errorText } from '../../lib/errors'
import { canManage, family, loadFamily, setFamilyName, setNoFamily } from '../../store/family'
import { notice } from '../../store/notice'

const t = useT()
const router = useRouter()
const editing = ref(false)
const name = ref('')
const busy = ref(false)
const error = ref('')
const sent = ref(0)

onMounted(() => { void loadFamily() })

function edit() {
  name.value = family.data?.name ?? ''
  error.value = ''
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
  if (busy.value || !familyNameValid(name.value)) return
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
        <form v-if="editing" class="rename" @submit.prevent="save">
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="field">
            <label for="family-rename">{{ t.family.nameLabel }}</label>
            <input id="family-rename" v-model="name" class="input" required autocomplete="off" data-selectable />
          </div>
          <div class="actions">
            <button class="btn" type="submit" :disabled="busy || !familyNameValid(name)">{{ t.family.save }}</button>
            <button class="btn btn-ghost" type="button" @click="editing = false">{{ t.family.cancel }}</button>
          </div>
        </form>
        <template v-else>
          <h2>{{ family.data.name }}</h2>
          <button v-if="canManage()" class="btn btn-ghost" type="button" @click="edit">{{ t.family.rename }}</button>
        </template>
      </div>

      <p v-if="error && !editing" class="error" role="alert">{{ error }}</p>
      <h2 class="section">{{ t.family.members }}</h2>
      <MembersList @changed="sent++" />

      <template v-if="canManage()">
        <PendingInvitations :refresh="sent" />
        <div class="invite">
          <InviteForm @sent="sent++" />
        </div>
      </template>

      <template v-if="family.data.role === 'owner'">
        <h2 class="section">{{ t.deletion.zone }}</h2>
        <DeleteConfirm id="delete-family" :title="t.deletion.familyAction" :lead="t.deletion.familyLead"
          :items="t.deletion.familyItems" :action="t.deletion.familyAction" :confirm="t.deletion.familyConfirm"
          :busy="deleting" :error="deleteError" @cancel="deleteError = ''" @confirm="removeFamily" />
      </template>
    </template>
  </section>
</template>

<style scoped>
h1 {
  font-size: 2rem;
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
  margin: 28px 0 12px;
  font-size: 1.15rem;
  font-weight: 800;
}
.invite {
  margin-top: 28px;
}
</style>
