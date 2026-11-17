<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { acceptInvitation, previewInvitation } from '../api/families'
import { ApiError } from '../api/http'
import { useT } from '../composables/useT'
import { familyErrorText } from '../lib/familyErrors'
import { forgetInviteToken, takeInviteToken } from '../lib/inviteToken'
import { auth } from '../store/auth'
import { loadFamily } from '../store/family'

type State = 'loading' | 'missing' | 'signedOut' | 'ready' | 'other' | 'failed'

const t = useT()
const router = useRouter()
const state = ref<State>('loading')
const familyName = ref('')
const role = ref<'manager' | 'member'>('member')
const error = ref('')
const busy = ref(false)
let token: string | null = null

function fail(e: unknown) {
  // Invitation morte : inutile de la garder pour l'onglet.
  if (e instanceof ApiError && e.code === 'invite_invalid') forgetInviteToken()
  error.value = familyErrorText(e, t.value)
  state.value = 'failed'
}

onMounted(async () => {
  token = takeInviteToken()
  if (!token) { state.value = 'missing'; return }
  // Session non vérifiable (réseau, serveur) : ce n'est pas « déconnecté ».
  if (!auth.user && auth.offline) {
    error.value = auth.offline === 'network' ? t.value.errors.network : t.value.errors.busy
    state.value = 'failed'
    return
  }
  if (!auth.user) { state.value = 'signedOut'; return }
  try {
    const preview = await previewInvitation(token)
    if (!preview.forThisAccount) { state.value = 'other'; return }
    familyName.value = preview.familyName
    role.value = preview.role
    state.value = 'ready'
  } catch (e) { fail(e) }
})

async function accept() {
  if (!token || busy.value) return
  busy.value = true
  try {
    await acceptInvitation(token)
    forgetInviteToken()
    await loadFamily(true)
    await router.replace({ name: 'espace' })
  } catch (e) {
    fail(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="page">
    <section class="card invite">
      <h1>{{ t.invite.title }}</h1>
      <p v-if="state === 'loading'" role="status">{{ t.family.loading }}</p>
      <p v-else-if="state === 'missing'">{{ t.invite.missing }}</p>
      <template v-else-if="state === 'signedOut'">
        <p>{{ t.invite.signedOut }}</p>
        <div class="actions">
          <RouterLink class="btn" :to="{ name: 'connexion', query: { next: '/invitation' } }">{{ t.invite.login }}</RouterLink>
          <RouterLink class="btn btn-ghost" :to="{ name: 'connexion', query: { mode: 'register', next: '/invitation' } }">{{ t.invite.register }}</RouterLink>
        </div>
      </template>
      <p v-else-if="state === 'other'" class="error" role="alert">{{ t.invite.otherAccount }}</p>
      <template v-else-if="state === 'ready'">
        <p class="join">{{ t.invite.join(familyName, t.family.roles[role]) }}</p>
        <button class="btn" type="button" :disabled="busy" @click="accept">{{ t.invite.accept }}</button>
      </template>
      <template v-else>
        <p class="error" role="alert">{{ error }}</p>
        <RouterLink v-if="auth.user" class="btn btn-ghost" :to="{ name: 'espace' }">{{ t.invite.goHome }}</RouterLink>
      </template>
    </section>
  </main>
</template>

<style scoped>
.invite {
  max-width: 520px;
  margin: 0 auto;
}
.invite h1 {
  font-size: 2rem;
}
.join {
  font-size: 1.1rem;
  font-weight: 700;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
