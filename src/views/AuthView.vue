<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, ApiError } from '../api/http'
import { native } from '../api/transport'
import type { User } from '../api/types'
import { auth, login, register, retry, setUser } from '../store/auth'
import { useT } from '../composables/useT'
import { errorText } from '../lib/errors'
import { safeNext } from '../lib/nextPath'
import { takeNotice } from '../store/notice'
import PasswordInput from '../components/PasswordInput.vue'
import ConsentCheckbox from '../components/account/ConsentCheckbox.vue'
import MfaQr from '../components/MfaQr.vue'
import AppButton from '../components/ui/AppButton.vue'

type Mode = 'login' | 'register' | 'forgot' | 'reset' | 'confirm' | 'sent' | 'mfa' | 'enroll' | 'recovery'

const t = useT()
const route = useRoute()
const router = useRouter()

const mode = ref<Mode>(route.query.mode === 'register' ? 'register' : 'login')
const name = ref('')
const email = ref('')
const password = ref('')
const remember = ref(false)
// Consentement à l'inscription (NAR-178) : exigé, vérifié aussi par le serveur.
const consent = ref(false)
const consentError = ref('')
const code = ref('')
const invitation = ref('')
const enrollment = ref<{ secret: string, account: string, issuer: string } | null>(null)
const recoveryCodes = ref<string[]>([])
const linkToken = ref('')
const busy = ref(false)
const error = ref('')
const notice = ref('')
// Arrivée juste après la suppression du compte : on le confirme. La clé est gardée,
// le texte résolu à l'affichage (suit le changement de langue).
const accountDeleted = ref(takeNotice('accountDeleted'))
const shownNotice = computed(() => notice.value || (accountDeleted.value ? t.value.deletion.accountDeleted : ''))

// Inscription en attente de confirmation : survit au rechargement (24 h), pour
// que la personne ne croie pas son compte perdu. Effacée à la confirmation.
const PENDING = 'akaiky-v2.pending-signup'
function rememberPending(address: string) {
  try { sessionStorage.setItem(PENDING, JSON.stringify({ email: address, at: Date.now() })) } catch { /* sans conséquence */ }
}
function readPending(): string | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(PENDING) || 'null')
    if (v && typeof v.email === 'string' && Date.now() - v.at < 86400000) return v.email
  } catch { /* contenu invalide : ignoré */ }
  return null
}
function clearPending() {
  try { sessionStorage.removeItem(PENDING) } catch { /* sans conséquence */ }
}

function go(next: Mode) {
  mode.value = next
  error.value = ''
  notice.value = ''
  accountDeleted.value = false
}

async function run(task: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await task() } catch (e) { error.value = message(e) } finally { busy.value = false }
}

function message(e: unknown): string {
  if (e instanceof ApiError) {
    if (mode.value === 'login' && e.status === 401) return t.value.auth.badCredentials
    // 403 à la connexion : adresse non confirmée, ou (app native) compte à double authentification.
    if (mode.value === 'login' && e.status === 403) return e.code === 'web_only' ? t.value.auth.webOnly : t.value.auth.confirmFirst
    if ((mode.value === 'mfa' || mode.value === 'enroll') && e.status === 401) return t.value.mfa.invalid
    if (e.code === 'consent_required') return t.value.consent.required
    if ((mode.value === 'reset' || mode.value === 'confirm') && e.status === 400 && /Lien/.test(e.message)) return t.value.auth.invalidLink
  }
  return errorText(e, t.value)
}

function finish() {
  router.replace(safeNext(route.query.next))
}

const submitLogin = () => run(async () => {
  const result = await login(email.value.trim(), password.value, remember.value)
  password.value = ''
  if (result.user) return finish()
  if (result.enrollmentRequired) go('enroll')
  else if (result.mfaRequired) go('mfa')
})

const submitRegister = () => run(async () => {
  consentError.value = ''
  if (!consent.value) { consentError.value = t.value.consent.required; return }
  if (password.value.length < 12) { error.value = t.value.auth.tooShort; return }
  const address = email.value.trim()
  await register(name.value.trim(), address, password.value)
  password.value = ''
  rememberPending(address)
  go('sent')
})

const resend = () => run(async () => {
  await api.post('/auth/resend-confirmation', { email: email.value.trim() })
  notice.value = t.value.auth.checkMail(email.value.trim())
})

const submitForgot = () => run(async () => {
  await api.post('/auth/forgot-password', { email: email.value.trim() })
  notice.value = t.value.auth.checkMail(email.value.trim())
})

const submitReset = () => run(async () => {
  if (password.value.length < 12) { error.value = t.value.auth.tooShort; return }
  await api.post('/auth/reset-password', { token: linkToken.value, password: password.value })
  password.value = ''
  linkToken.value = ''
  go('login')
  notice.value = t.value.auth.resetDone
})

const submitConfirm = () => run(async () => {
  const r = await api.post<{ email: string }>('/auth/confirm', { token: linkToken.value })
  linkToken.value = ''
  clearPending()
  email.value = r.email
  go('login')
  notice.value = t.value.auth.confirmed
})

const submitInvitation = () => run(async () => {
  enrollment.value = await api.post('/auth/mfa/setup', { invitation: invitation.value.trim() })
  invitation.value = ''
})

const submitCode = () => run(async () => {
  const r = await api.post<{ user: User, recoveryCodes?: string[] }>('/auth/mfa/verify', { code: code.value.trim() })
  code.value = ''
  setUser(r.user)
  if (r.recoveryCodes) { recoveryCodes.value = r.recoveryCodes; go('recovery') } else finish()
})

// Démarrage sans réseau : la session existe peut-être encore. On propose de
// réessayer plutôt que d'en ouvrir une seconde.
const retryOffline = () => run(async () => {
  await retry()
  if (auth.user) finish()
  else if (auth.offline) error.value = auth.offline === 'network' ? t.value.errors.network : t.value.errors.busy
})

const cancelMfa = () => run(async () => {
  await api.post('/auth/mfa/cancel')
  enrollment.value = null
  go('login')
})

// Lien reçu par email : jeton dans le fragment de l'URL, retiré aussitôt de la
// barre d'adresse. Lu au montage ET à chaque changement de fragment (lien
// ouvert dans l'onglet déjà sur cette page : le composant n'est pas remonté).
function readLink(): boolean {
  const m = /^#(confirm|reset)=([A-Za-z0-9_-]{20,100})$/.exec(location.hash)
  if (m) {
    linkToken.value = m[2]
    history.replaceState(history.state, '', location.pathname + location.search)
    go(m[1] as Mode)
    return true
  }
  if (location.hash === '#forgot') {
    history.replaceState(history.state, '', location.pathname + location.search)
    go('forgot')
    return true
  }
  return false
}
watch(() => route.hash, (h) => { if (h) readLink() })

onMounted(async () => {
  if (readLink()) return
  const pending = readPending()
  if (pending && mode.value === 'register') { email.value = pending; go('sent'); return }
  // Second facteur en cours (page rechargée pendant la connexion) : reprise.
  if (!native) {
    try {
      const { challenge } = await api.get<{ challenge: { enrollmentRequired: boolean } | null }>('/auth/mfa/status')
      if (challenge) go(challenge.enrollmentRequired ? 'enroll' : 'mfa')
    } catch { /* hors ligne : on reste sur la connexion */ }
  }
})
</script>

<template>
  <main class="page narrow">
    <p v-if="shownNotice" class="notice" role="status">{{ shownNotice }}</p>
    <div v-if="auth.offline" class="notice" role="status">
      {{ auth.offline === 'network' ? t.errors.network : t.errors.busy }}
      <AppButton variant="link" :disabled="busy" @click="retryOffline">{{ t.errors.retry }}</AppButton>
    </div>

    <form v-if="mode === 'login'" class="card" @submit.prevent="submitLogin">
      <h1>{{ t.auth.loginTitle }}</h1>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="field">
        <label for="email">{{ t.auth.email }}</label>
        <input id="email" v-model="email" class="input" type="email" autocomplete="email" required />
      </div>
      <div class="field">
        <label for="password">{{ t.auth.password }}</label>
        <PasswordInput id="password" v-model="password" autocomplete="current-password" />
      </div>
      <label v-if="!native" class="check"><input v-model="remember" type="checkbox" /> {{ t.auth.rememberDevice }}</label>
      <AppButton block type="submit" :disabled="busy">{{ busy ? t.auth.wait : t.auth.submitLogin }}</AppButton>
      <p class="links">
        <AppButton variant="link" @click="go('forgot')">{{ t.auth.toForgot }}</AppButton>
        <AppButton variant="link" @click="go('register')">{{ t.auth.toRegister }}</AppButton>
      </p>
    </form>

    <form v-else-if="mode === 'register'" class="card" @submit.prevent="submitRegister">
      <h1>{{ t.auth.registerTitle }}</h1>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="field">
        <label for="name">{{ t.auth.name }}</label>
        <input id="name" v-model="name" class="input" autocomplete="name" maxlength="80" required />
      </div>
      <div class="field">
        <label for="email">{{ t.auth.email }}</label>
        <input id="email" v-model="email" class="input" type="email" autocomplete="email" required />
      </div>
      <div class="field">
        <label for="password">{{ t.auth.password }}</label>
        <PasswordInput id="password" v-model="password" autocomplete="new-password" />
        <small>{{ t.auth.passwordHint }}</small>
      </div>
      <ConsentCheckbox id="signup-consent" v-model="consent" :label="t.consent.signup" v-model:error="consentError" />
      <AppButton block type="submit" :disabled="busy">{{ busy ? t.auth.wait : t.auth.submitRegister }}</AppButton>
      <p class="links"><AppButton variant="link" @click="go('login')">{{ t.auth.toLogin }}</AppButton></p>
    </form>

    <div v-else-if="mode === 'sent'" class="card">
      <h1>{{ t.auth.confirmTitle }}</h1>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p>{{ t.auth.checkMail(email) }}</p>
      <AppButton block variant="ghost" :disabled="busy" @click="resend">{{ t.auth.resend }}</AppButton>
      <p class="links"><AppButton variant="link" @click="go('login')">{{ t.auth.toLogin }}</AppButton></p>
    </div>

    <form v-else-if="mode === 'forgot'" class="card" @submit.prevent="submitForgot">
      <h1>{{ t.auth.forgotTitle }}</h1>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="field">
        <label for="email">{{ t.auth.email }}</label>
        <input id="email" v-model="email" class="input" type="email" autocomplete="email" required />
      </div>
      <AppButton block type="submit" :disabled="busy">{{ busy ? t.auth.wait : t.auth.submitForgot }}</AppButton>
      <p class="links"><AppButton variant="link" @click="go('login')">{{ t.auth.toLogin }}</AppButton></p>
    </form>

    <form v-else-if="mode === 'reset'" class="card" @submit.prevent="submitReset">
      <h1>{{ t.auth.resetTitle }}</h1>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="field">
        <label for="password">{{ t.auth.newPassword }}</label>
        <PasswordInput id="password" v-model="password" autocomplete="new-password" />
        <small>{{ t.auth.passwordHint }}</small>
      </div>
      <AppButton block type="submit" :disabled="busy">{{ busy ? t.auth.wait : t.auth.submitReset }}</AppButton>
    </form>

    <div v-else-if="mode === 'confirm'" class="card">
      <h1>{{ t.auth.confirmTitle }}</h1>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <!-- Un clic, pas un simple chargement : les antivirus de messagerie ouvrent les liens. -->
      <AppButton block :disabled="busy" @click="submitConfirm">{{ t.auth.confirmButton }}</AppButton>
    </div>

    <form v-else-if="mode === 'enroll' && !enrollment" class="card" @submit.prevent="submitInvitation">
      <h1>{{ t.mfa.enrollTitle }}</h1>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p>{{ t.mfa.enrollLead }}</p>
      <div class="field">
        <label for="invitation">{{ t.mfa.invitation }}</label>
        <input id="invitation" v-model="invitation" class="input" autocomplete="off" required />
      </div>
      <AppButton block type="submit" :disabled="busy">{{ t.mfa.continue }}</AppButton>
      <p class="links"><AppButton variant="link" @click="cancelMfa">{{ t.mfa.cancel }}</AppButton></p>
    </form>

    <form v-else-if="mode === 'mfa' || mode === 'enroll'" class="card" @submit.prevent="submitCode">
      <h1>{{ mode === 'enroll' ? t.mfa.enrollTitle : t.mfa.title }}</h1>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <template v-if="enrollment">
        <p>{{ t.mfa.scan }}</p>
        <MfaQr :secret="enrollment.secret" :account="enrollment.account" :issuer="enrollment.issuer" />
        <p class="secret">{{ enrollment.secret }}</p>
      </template>
      <div class="field">
        <label for="code">{{ t.mfa.codeLabel }}</label>
        <input id="code" v-model="code" class="input" autocomplete="one-time-code" inputmode="text" required />
      </div>
      <AppButton block type="submit" :disabled="busy">{{ t.mfa.verify }}</AppButton>
      <p class="links"><AppButton variant="link" @click="cancelMfa">{{ t.mfa.cancel }}</AppButton></p>
    </form>

    <div v-else-if="mode === 'recovery'" class="card">
      <h1>{{ t.mfa.recoveryTitle }}</h1>
      <p>{{ t.mfa.recoveryLead }}</p>
      <ul class="codes"><li v-for="c in recoveryCodes" :key="c">{{ c }}</li></ul>
      <AppButton block @click="finish">{{ t.mfa.recoverySaved }}</AppButton>
    </div>
  </main>
</template>

<style scoped>
.narrow {
  max-width: 440px;
}
h1 {
  font-size: 1.6rem;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  font-size: 0.9rem;
  color: var(--text-soft);
}
small {
  color: var(--text-mute);
}
.links {
  display: flex;
  font-size: var(--fs-small);
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  margin: 14px 0 0;
}
.notice {
  padding: 11px 14px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  margin-bottom: 16px;
}
.secret,
.codes {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
}
.codes {
  columns: 2;
  padding-left: 18px;
}
</style>
