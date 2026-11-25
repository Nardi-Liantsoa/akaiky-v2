<script setup lang="ts">
import AppIcon from '../components/ui/AppIcon.vue'
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { acceptInvitation, previewInvitation } from '../api/families'
import { ApiError } from '../api/http'
import { useT } from '../composables/useT'
import { familyErrorText } from '../lib/familyErrors'
import { forgetInviteToken, takeInviteToken } from '../lib/inviteToken'
import { auth } from '../store/auth'
import { loadFamily } from '../store/family'
import AppButton from '../components/ui/AppButton.vue'
import StatusBlock from '../components/ui/StatusBlock.vue'

type State = 'loading' | 'missing' | 'signedOut' | 'ready' | 'other' | 'failed'

const t = useT()
const router = useRouter()
const state = ref<State>('loading')
const familyName = ref('')
const invitedBy = ref('')
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
    // Serveur antérieur à NAR-230 (bundle plus récent) : pas d'invitant, phrase sans lui.
    invitedBy.value = preview.invitedBy ?? ''
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
    <!-- Invitation (NAR-230, design créé d'après les cartes de l'app) : pastille enveloppe, qui
         invite, dans quelle famille et comme quoi, puis les actions avec leur icône. -->
    <section class="card invite">
      <span class="badge-icon" aria-hidden="true"><AppIcon name="mail" :size="28" /></span>
      <h1>{{ t.invite.title }}</h1>
      <StatusBlock v-if="state === 'loading'" state="loading" />
      <p v-else-if="state === 'missing'">{{ t.invite.missing }}</p>
      <template v-else-if="state === 'signedOut'">
        <p>{{ t.invite.signedOut }}</p>
        <div class="actions">
          <RouterLink class="btn" :to="{ name: 'connexion', query: { next: '/invitation' } }"><AppIcon name="user" :size="20" />{{ t.invite.login }}</RouterLink>
          <RouterLink class="btn btn-ghost" :to="{ name: 'connexion', query: { mode: 'register', next: '/invitation' } }"><AppIcon name="plus" :size="20" />{{ t.invite.register }}</RouterLink>
        </div>
      </template>
      <p v-else-if="state === 'other'" class="error" role="alert">{{ t.invite.otherAccount }}</p>
      <template v-else-if="state === 'ready'">
        <p class="join">{{ invitedBy ? t.invite.joinBy(invitedBy, familyName, t.family.roles[role]) : t.invite.join(familyName, t.family.roles[role]) }}</p>
        <AppButton block :disabled="busy" @click="accept"><AppIcon name="check" :size="20" />{{ t.invite.accept }}</AppButton>
      </template>
      <template v-else>
        <p class="error" role="alert">{{ error }}</p>
        <RouterLink v-if="auth.user" class="btn btn-ghost" :to="{ name: 'espace' }"><AppIcon name="home" :size="20" />{{ t.invite.goHome }}</RouterLink>
      </template>
    </section>
  </main>
</template>

<style scoped>
.invite {
  max-width: 520px;
  margin: 0 auto;
  text-align: center;
}
.badge-icon {
  display: inline-grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin-bottom: var(--space-3);
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent-deep);
}
.join {
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.45;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
</style>
