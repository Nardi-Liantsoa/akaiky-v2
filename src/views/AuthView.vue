<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, ApiError } from '../api/http'
import { native } from '../api/transport'
import type { LoginId, User } from '../api/types'
import { auth, login, register, registerPhone, retry, setUser } from '../store/auth'
import { locale, useT } from '../composables/useT'
import { authErrorText } from '../lib/authErrors'
import { passwordContainsPhone } from '../lib/phonePassword'
import { safeNext } from '../lib/nextPath'
import { takeNotice } from '../store/notice'
import PasswordInput from '../components/PasswordInput.vue'
import ConsentCheckbox from '../components/account/ConsentCheckbox.vue'
import LoginMethodSwitch, { type LoginMethod } from '../components/account/LoginMethodSwitch.vue'
import MfaQr from '../components/MfaQr.vue'
import AppButton from '../components/ui/AppButton.vue'
import FormField from '../components/ui/FormField.vue'

// phoneCode : code SMS de confirmation du numéro ; phoneReset : code SMS et nouveau mot de passe.
type Mode = 'login' | 'register' | 'forgot' | 'reset' | 'confirm' | 'sent' | 'phoneCode' | 'phoneReset' | 'mfa' | 'enroll' | 'recovery'

const t = useT()
const route = useRoute()
const router = useRouter()

const mode = ref<Mode>(route.query.mode === 'register' ? 'register' : 'login')
const name = ref('')
const email = ref('')
const phone = ref('')
// Code reçu par SMS (confirmation ou réinitialisation), distinct du code de double authentification.
const smsCode = ref('')
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
// Code stable de la dernière erreur : « numéro non confirmé » propose d'aller saisir le code.
const errorCode = ref<string | undefined>()
const notice = ref('')
// Arrivée juste après la suppression du compte : on le confirme. La clé est gardée,
// le texte résolu à l'affichage (suit le changement de langue).
const accountDeleted = ref(takeNotice('accountDeleted'))
const shownNotice = computed(() => notice.value || (accountDeleted.value ? t.value.deletion.accountDeleted : ''))

// Identifiant choisi (NAR-202) : retenu sur l'appareil, seulement s'il n'est pas le défaut.
const METHOD = 'akaiky-v2.login-method'
function readMethod(): LoginMethod {
  try { return localStorage.getItem(METHOD) === 'phone' ? 'phone' : 'email' } catch { return 'email' }
}
const method = ref<LoginMethod>(readMethod())
// Choix fait par la personne (bouton) : seul retenu sur l'appareil. Un changement fait par
// l'écran (reprise d'une inscription par numéro) ne l'est pas.
function chooseMethod(m: LoginMethod) {
  method.value = m
  error.value = ''
  errorCode.value = undefined
  notice.value = ''
  try {
    if (m === 'phone') localStorage.setItem(METHOD, m)
    else localStorage.removeItem(METHOD)
  } catch { /* sans conséquence */ }
}

// Inscription en attente de confirmation (lien par email ou code par SMS) : survit au
// rechargement (24 h), pour que la personne ne croie pas son compte perdu. Elle ne vit que
// sur l'écran d'attente (« sent » ou « phoneCode », adresse ?mode=register) : revenir à la
// connexion ou à l'inscription l'efface (go), comme une arrivée sans ?mode=register
// (onMounted). Un lien reçu par email (confirmation, réinitialisation) la garde : il peut
// avoir expiré.
const PENDING = 'akaiky-v2.pending-signup'
type Pending = { email: string } | { phone: string }
function rememberPending(p: Pending) {
  try { sessionStorage.setItem(PENDING, JSON.stringify({ ...p, at: Date.now() })) } catch { /* sans conséquence */ }
}
function readPending(): Pending | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(PENDING) || 'null')
    if (!v || typeof v.at !== 'number' || !(Date.now() - v.at < 86400000)) return null
    if (typeof v.email === 'string') return { email: v.email }
    if (typeof v.phone === 'string') return { phone: v.phone }
  } catch { /* contenu invalide : ignoré */ }
  return null
}
// Ouvre la saisie du code SMS, retenue comme une inscription en attente (reprise au
// rechargement : Android peut recharger la WebView pendant qu'on lit le SMS).
function awaitCode() {
  rememberPending({ phone: phone.value.trim() })
  go('phoneCode')
  router.replace({ query: { ...route.query, mode: 'register' } })
}
// Numéro modifié après « numéro non confirmé » : l'offre d'un code ne vaut plus pour lui.
watch(phone, () => { if (errorCode.value === 'phone_unverified') errorCode.value = undefined })
function clearPending() {
  try { sessionStorage.removeItem(PENDING) } catch { /* sans conséquence */ }
}

function go(next: Mode) {
  // L'inscription se lit dans l'adresse (?mode=register) : un rechargement pendant l'attente
  // du lien ou du code SMS y revient. Retirée en revenant à la connexion.
  if (next === 'register' || (next === 'login' && route.query.mode === 'register')) {
    const rest = Object.fromEntries(Object.entries(route.query).filter(([k]) => k !== 'mode'))
    router.replace({ query: next === 'register' ? { ...rest, mode: 'register' } : rest })
  }
  if (next === 'login' || next === 'register') clearPending()
  mode.value = next
  error.value = ''
  errorCode.value = undefined
  // Jamais un mot de passe ni un code d'un écran repris par le suivant : un mot de passe
  // refusé à la connexion deviendrait sinon, sans être vu, le nouveau mot de passe.
  password.value = ''
  smsCode.value = ''
  notice.value = ''
  accountDeleted.value = false
}

async function run(task: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  errorCode.value = undefined
  try {
    await task()
  } catch (e) {
    error.value = message(e)
    errorCode.value = e instanceof ApiError ? e.code : undefined
  } finally { busy.value = false }
}

function message(e: unknown): string {
  if (e instanceof ApiError) {
    if (mode.value === 'login' && e.status === 401) return method.value === 'phone' ? t.value.auth.badCredentialsPhone : t.value.auth.badCredentials
    // 403 à la connexion : adresse ou numéro non confirmé, ou (app native) compte à double authentification.
    if (mode.value === 'login' && e.status === 403) {
      if (e.code === 'web_only') return t.value.auth.webOnly
      if (e.code === 'phone_unverified') return t.value.auth.phoneUnverified
      return t.value.auth.confirmFirst
    }
    if ((mode.value === 'mfa' || mode.value === 'enroll') && e.status === 401) return t.value.mfa.invalid
    if ((mode.value === 'reset' || mode.value === 'confirm') && e.status === 400 && /Lien/.test(e.message)) return t.value.auth.invalidLink
  }
  return authErrorText(e, t.value)
}

function finish() {
  router.replace(safeNext(route.query.next))
}

const loginId = (): LoginId => method.value === 'phone' ? { phone: phone.value.trim() } : { email: email.value.trim() }
// Langue des SMS envoyés : celle de l'écran.
const lang = () => locale.value

const submitLogin = () => run(async () => {
  const result = await login(loginId(), password.value, remember.value)
  password.value = ''
  if (result.user) return finish()
  if (result.enrollmentRequired) go('enroll')
  else if (result.mfaRequired) go('mfa')
})

const submitRegister = () => run(async () => {
  consentError.value = ''
  if (!consent.value) { consentError.value = t.value.consent.required; return }
  if (password.value.length < 12) { error.value = t.value.auth.tooShort; return }
  if (method.value === 'phone') {
    const number = phone.value.trim()
    if (passwordContainsPhone(password.value, number)) { error.value = t.value.auth.passwordHasPhone; return }
    await registerPhone(name.value.trim(), number, password.value, lang())
    password.value = ''
    awaitCode()
    notice.value = t.value.auth.codeSent(number)
    return
  }
  const address = email.value.trim()
  await register(name.value.trim(), address, password.value, lang())
  password.value = ''
  rememberPending({ email: address })
  go('sent')
})

// Pas de session ouverte par la confirmation : connexion ensuite avec numéro et mot de passe.
// Chiffres seuls : un code collé « 123 456 » ou « 123-456 » reste valable.
const typedCode = () => smsCode.value.replace(/\D/g, '')

const submitPhoneCode = () => run(async () => {
  const r = await api.post<{ phone: string }>('/auth/phone/confirm', { phone: phone.value.trim(), code: typedCode() })
  smsCode.value = ''
  phone.value = r.phone
  method.value = 'phone'
  go('login')
  notice.value = t.value.auth.phoneConfirmed
})

const sendConfirmCode = () => api.post('/auth/phone/resend', { phone: phone.value.trim(), lang: lang() })
const resendCode = () => run(async () => {
  await sendConfirmCode()
  smsCode.value = ''
  notice.value = t.value.auth.codeSent(phone.value.trim())
})

// Numéro non confirmé à la connexion : le code de l'inscription a sans doute expiré
// (5 minutes) ; un nouveau est demandé. Envoi refusé par la limite (60 s entre deux SMS) :
// le code précédent vaut peut-être encore, la saisie s'ouvre avec le refus. Tout autre
// refus (SMS indisponibles, numéro invalide, réseau) : on reste sur la connexion.
const confirmPhone = () => run(async () => {
  try {
    await sendConfirmCode()
  } catch (e) {
    if (e instanceof ApiError && e.code === 'sms_rate_limited') awaitCode()
    throw e
  }
  awaitCode()
  notice.value = t.value.auth.codeSent(phone.value.trim())
})

const resend = () => run(async () => {
  await api.post('/auth/resend-confirmation', { email: email.value.trim() })
  notice.value = t.value.auth.checkMail(email.value.trim())
})

const submitForgot = () => run(async () => {
  if (method.value === 'phone') {
    // Envoi refusé par la limite (60 s entre deux SMS) : le code précédent vaut peut-être
    // encore, la saisie s'ouvre avec le refus (comme confirmPhone).
    try {
      await sendResetCode()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'sms_rate_limited') go('phoneReset')
      throw e
    }
    go('phoneReset')
    notice.value = t.value.auth.resetCodeSent(phone.value.trim())
    return
  }
  await api.post('/auth/forgot-password', { email: email.value.trim() })
  notice.value = t.value.auth.checkMail(email.value.trim())
})

const sendResetCode = () => api.post('/auth/phone/forgot', { phone: phone.value.trim(), lang: lang() })
const resendResetCode = () => run(async () => {
  await sendResetCode()
  smsCode.value = ''
  notice.value = t.value.auth.resetCodeSent(phone.value.trim())
})

// Réinitialisation par code SMS (NAR-201) : toutes les sessions fermées, aucune ouverte.
const submitPhoneReset = () => run(async () => {
  if (password.value.length < 12) { error.value = t.value.auth.tooShort; return }
  if (passwordContainsPhone(password.value, phone.value)) { error.value = t.value.auth.passwordHasPhone; return }
  await api.post('/auth/phone/reset', { phone: phone.value.trim(), code: typedCode(), password: password.value, lang: lang() })
  password.value = ''
  smsCode.value = ''
  go('login')
  notice.value = t.value.auth.resetDone
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
  // Inscription en attente (lien par email ou code SMS) : reprise sur ?mode=register seulement.
  if (pending && mode.value === 'register') {
    if ('phone' in pending) { phone.value = pending.phone; method.value = 'phone'; go('phoneCode') } else { email.value = pending.email; go('sent') }
    return
  }
  clearPending()
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
      <p v-if="errorCode === 'phone_unverified'" class="links">
        <AppButton variant="link" :disabled="busy" @click="confirmPhone">{{ t.auth.toPhoneCode }}</AppButton>
      </p>
      <LoginMethodSwitch :model-value="method" :disabled="busy" @update:model-value="chooseMethod" />
      <FormField v-if="method === 'phone'" id="phone" :label="t.auth.phone" :help="t.auth.phoneHelp" v-slot="{ control }">
        <input v-bind="control" v-model="phone" class="input" type="tel" inputmode="tel" autocomplete="tel" maxlength="40" :placeholder="t.auth.phonePlaceholder" required />
      </FormField>
      <FormField v-else id="email" :label="t.auth.email" v-slot="{ control }">
        <input v-bind="control" v-model="email" class="input" type="email" autocomplete="email" required />
      </FormField>
      <FormField id="password" :label="t.auth.password" v-slot="{ control }">
        <PasswordInput v-bind="control" v-model="password" autocomplete="current-password" />
      </FormField>
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
      <FormField id="name" :label="t.auth.name" v-slot="{ control }">
        <input v-bind="control" v-model="name" class="input" autocomplete="name" maxlength="80" required />
      </FormField>
      <LoginMethodSwitch :model-value="method" :disabled="busy" @update:model-value="chooseMethod" />
      <FormField v-if="method === 'phone'" id="phone" :label="t.auth.phone" :help="t.auth.phoneHelp" v-slot="{ control }">
        <input v-bind="control" v-model="phone" class="input" type="tel" inputmode="tel" autocomplete="tel" maxlength="40" :placeholder="t.auth.phonePlaceholder" required />
      </FormField>
      <FormField v-else id="email" :label="t.auth.email" v-slot="{ control }">
        <input v-bind="control" v-model="email" class="input" type="email" autocomplete="email" required />
      </FormField>
      <FormField id="password" :label="t.auth.password" :help="t.auth.passwordHint" v-slot="{ control }">
        <PasswordInput v-bind="control" v-model="password" autocomplete="new-password" />
      </FormField>
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
      <LoginMethodSwitch :model-value="method" :disabled="busy" @update:model-value="chooseMethod" />
      <FormField v-if="method === 'phone'" id="phone" :label="t.auth.phone" :help="t.auth.phoneHelp" v-slot="{ control }">
        <input v-bind="control" v-model="phone" class="input" type="tel" inputmode="tel" autocomplete="tel" maxlength="40" :placeholder="t.auth.phonePlaceholder" required />
      </FormField>
      <FormField v-else id="email" :label="t.auth.email" v-slot="{ control }">
        <input v-bind="control" v-model="email" class="input" type="email" autocomplete="email" required />
      </FormField>
      <AppButton block type="submit" :disabled="busy">{{ busy ? t.auth.wait : method === 'phone' ? t.auth.submitForgotPhone : t.auth.submitForgot }}</AppButton>
      <p class="links"><AppButton variant="link" @click="go('login')">{{ t.auth.toLogin }}</AppButton></p>
    </form>

    <form v-else-if="mode === 'phoneCode'" class="card" @submit.prevent="submitPhoneCode">
      <h1>{{ t.auth.phoneCodeTitle }}</h1>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <FormField id="sms-code" :label="t.auth.code" :help="t.auth.codeHelp" v-slot="{ control }">
        <input v-bind="control" v-model="smsCode" class="input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="12" required />
      </FormField>
      <AppButton block type="submit" :disabled="busy">{{ busy ? t.auth.wait : t.auth.submitCode }}</AppButton>
      <AppButton block variant="ghost" :disabled="busy" @click="resendCode">{{ t.auth.resendCode }}</AppButton>
      <p class="links"><AppButton variant="link" @click="go('login')">{{ t.auth.toLogin }}</AppButton></p>
    </form>

    <form v-else-if="mode === 'phoneReset'" class="card" @submit.prevent="submitPhoneReset">
      <h1>{{ t.auth.resetTitle }}</h1>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <FormField id="sms-code" :label="t.auth.code" :help="t.auth.codeHelp" v-slot="{ control }">
        <input v-bind="control" v-model="smsCode" class="input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="12" required />
      </FormField>
      <FormField id="password" :label="t.auth.newPassword" :help="t.auth.passwordHint" v-slot="{ control }">
        <PasswordInput v-bind="control" v-model="password" autocomplete="new-password" />
      </FormField>
      <AppButton block type="submit" :disabled="busy">{{ busy ? t.auth.wait : t.auth.submitReset }}</AppButton>
      <AppButton block variant="ghost" :disabled="busy" @click="resendResetCode">{{ t.auth.resendCode }}</AppButton>
      <p class="links"><AppButton variant="link" @click="go('login')">{{ t.auth.toLogin }}</AppButton></p>
    </form>

    <form v-else-if="mode === 'reset'" class="card" @submit.prevent="submitReset">
      <h1>{{ t.auth.resetTitle }}</h1>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <FormField id="password" :label="t.auth.newPassword" :help="t.auth.passwordHint" v-slot="{ control }">
        <PasswordInput v-bind="control" v-model="password" autocomplete="new-password" />
      </FormField>
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
      <FormField id="invitation" :label="t.mfa.invitation" v-slot="{ control }">
        <input v-bind="control" v-model="invitation" class="input" autocomplete="off" required />
      </FormField>
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
      <FormField id="code" :label="t.mfa.codeLabel" v-slot="{ control }">
        <input v-bind="control" v-model="code" class="input" autocomplete="one-time-code" inputmode="text" required />
      </FormField>
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
.links {
  display: flex;
  font-size: var(--fs-small);
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  margin: 14px 0 0;
}
/* Envoi puis « Renvoyer le code » : deux boutons pleine largeur l'un sous l'autre. */
.btn-block + .btn-block {
  margin-top: 10px;
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
