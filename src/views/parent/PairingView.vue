<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import QRCode from 'qrcode'
import { createPairing, listDevices, revokeDevice, type ChildDevice } from '../../api/devices'
import { ApiError } from '../../api/http'
import LoadError from '../../components/family/LoadError.vue'
import { locale, useT } from '../../composables/useT'
import { remaining } from '../../lib/countdown'
import { errorText } from '../../lib/errors'
import { formatDay } from '../../lib/format'
import { children, dropChild, loadChildren } from '../../store/children'
import { canManage, family, loadFamily } from '../../store/family'
import AppButton from '../../components/ui/AppButton.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'

// Écran 10 de la maquette : appairage du téléphone de l'enfant par QR de
// provisionnement Android. Réservé aux gestionnaires (le serveur le vérifie aussi).
const t = useT()
const route = useRoute()
const router = useRouter()
const childId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))
const child = computed(() => children.items.find((c) => c.id === childId.value) ?? null)

const qr = ref('')
const expiresAt = ref('')
const now = ref(Date.now())
const busy = ref(false)
const error = ref('')
const devices = ref<ChildDevice[]>([])
const devicesStatus = ref<'loading' | 'ready' | 'error'>('loading')
const justPaired = ref(false)
const confirming = ref<string | null>(null)

const left = computed(() => (expiresAt.value ? remaining(expiresAt.value, now.value) : null))
const expired = computed(() => Boolean(expiresAt.value) && left.value === null)

// Compte à rebours et suivi des appareils pendant que le QR est affiché : le
// téléphone appairé apparaît sans recharger la page, et le QR utilisé disparaît.
let tick: ReturnType<typeof setInterval> | undefined
let poll: ReturnType<typeof setInterval> | undefined
function stopTimers() { clearInterval(tick); clearInterval(poll); tick = poll = undefined }
onBeforeUnmount(stopTimers)

function forgetIfGone(e: unknown) {
  if (e instanceof ApiError && e.code === 'child_not_found') dropChild(childId.value)
  if (e instanceof ApiError && e.code === 'family_role') void loadFamily(true)
}

async function refreshDevices(quiet = false) {
  const target = childId.value
  try {
    const list = await listDevices(target)
    if (target !== childId.value) return
    // Nouveau téléphone seulement par rapport à une liste déjà chargée : après un
    // premier chargement en échec, la liste vide ne dit rien.
    if (quiet && devicesStatus.value === 'ready' && list.some((d) => !devices.value.some((o) => o.id === d.id))) {
      // Le QR vient de servir : il n'est plus valable, on le retire.
      justPaired.value = true
      qr.value = ''
      expiresAt.value = ''
      stopTimers()
    }
    devices.value = list
    devicesStatus.value = 'ready'
  } catch (e) {
    if (!quiet) devicesStatus.value = 'error'
    forgetIfGone(e)
  }
}

async function show() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  justPaired.value = false
  const target = childId.value
  try {
    // Liste de référence chargée avant le QR : le téléphone qui s'appaire s'y détecte.
    if (devicesStatus.value !== 'ready') await refreshDevices()
    if (target !== childId.value) return
    const pairing = await createPairing(target)
    // QR généré dans l'app : le jeton ne passe par aucun service d'image externe.
    const image = await QRCode.toDataURL(JSON.stringify(pairing.provisioning), { margin: 1, width: 280, errorCorrectionLevel: 'M' })
    // Écran passé à un autre enfant pendant la requête : ce QR n'est pas le sien.
    if (target !== childId.value) return
    qr.value = image
    expiresAt.value = pairing.expiresAt
    now.value = Date.now()
    stopTimers()
    tick = setInterval(() => {
      now.value = Date.now()
      if (expired.value) { qr.value = ''; stopTimers() }
    }, 1000)
    poll = setInterval(() => { void refreshDevices(true) }, 5000)
  } catch (e) {
    if (target !== childId.value) return
    error.value = e instanceof ApiError && e.code === 'pairing_unavailable' ? t.value.pairing.unavailable
      : e instanceof ApiError && e.code === 'too_many_devices' ? t.value.pairing.tooMany
      : errorText(e, t.value)
    // Un téléphone ajouté ailleurs explique le refus : la liste est relue.
    if (e instanceof ApiError && e.code === 'too_many_devices') void refreshDevices()
    forgetIfGone(e)
  } finally {
    busy.value = false
  }
}

async function revoke(id: string) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await revokeDevice(id)
    devices.value = devices.value.filter((d) => d.id !== id)
    confirming.value = null
  } catch (e) {
    error.value = errorText(e, t.value)
    if (e instanceof ApiError && e.code === 'device_not_found') void refreshDevices()
    forgetIfGone(e)
  } finally {
    busy.value = false
  }
}

void loadFamily()
// Famille puis enfants ; un non-gestionnaire retourne à l'accueil, y compris si
// son rôle change en route.
watch(() => [family.status, family.data?.role] as const, ([s]) => {
  if (s !== 'ready') return
  if (!canManage()) { void router.replace({ name: 'espace' }); return }
  void loadChildren()
}, { immediate: true })
// Autre enfant (même composant réutilisé) : on repart de zéro.
watch(childId, () => {
  stopTimers()
  qr.value = ''
  expiresAt.value = ''
  error.value = ''
  justPaired.value = false
  confirming.value = null
  devices.value = []
  devicesStatus.value = 'loading'
  if (childId.value) void refreshDevices()
}, { immediate: true })
</script>

<template>
  <section>
    <LoadError v-if="family.status === 'error'" />
    <StatusBlock v-else-if="children.status === 'error'" state="error" :text="t.children.loadError" @retry="loadChildren(true)" />
    <StatusBlock v-else-if="family.status !== 'ready' || children.status !== 'ready'" state="loading" fill />
    <p v-else-if="!child" class="error" role="alert">{{ t.children.notFound }}</p>
    <template v-else>
      <h1>{{ t.pairing.title(child.firstName) }}</h1>

      <ol class="steps card">
        <li v-for="(s, i) in t.pairing.steps" :key="i">
          <span class="step">{{ t.pairing.step(i + 1, t.pairing.steps.length) }}</span>
          <span>{{ s }}</span>
        </li>
      </ol>

      <div class="card qr-card">
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-if="justPaired" class="ok" role="status">{{ t.pairing.paired }}</p>
        <template v-if="qr">
          <img :src="qr" width="280" height="280" :alt="t.pairing.qrLabel" />
          <p class="validity">{{ t.pairing.validity }}</p>
          <p class="countdown" aria-live="off">{{ left ? t.pairing.remaining(left) : '' }}</p>
          <p class="hint">{{ t.pairing.openApp }}</p>
        </template>
        <p v-else-if="expired" class="hint" role="status">{{ t.pairing.expired }}</p>
        <AppButton v-if="!qr" :disabled="busy" @click="show">
          {{ expiresAt || justPaired ? t.pairing.renew : t.pairing.show }}
        </AppButton>
      </div>

      <p class="warning">{{ t.pairing.warning }}</p>

      <h2>{{ t.pairing.devices }}</h2>
      <StatusBlock v-if="devicesStatus === 'error'" state="error" :text="t.pairing.loadError" @retry="refreshDevices()" />
      <p v-else-if="devicesStatus === 'ready' && !devices.length" class="hint">{{ t.pairing.none }}</p>
      <ul v-else-if="devicesStatus === 'ready'" class="devices">
        <li v-for="d in devices" :key="d.id" class="card device">
          <div>
            <strong>{{ d.model || t.pairing.unknownModel }}</strong>
            <span class="meta">{{ t.pairing.since(formatDay(d.createdAt, locale)) }}</span>
          </div>
          <AppButton v-if="confirming !== d.id" variant="ghost" :disabled="busy" @click="confirming = d.id">{{ t.pairing.revoke }}</AppButton>
          <AppButton v-else variant="danger" :disabled="busy" @click="revoke(d.id)">{{ t.pairing.confirmRevoke }}</AppButton>
        </li>
      </ul>
      <p v-if="devices.length" class="hint">{{ t.pairing.revokeHint }}</p>

      <RouterLink class="btn btn-ghost back" :to="{ name: 'enfant', params: { id: child.id } }">{{ t.children.cancel }}</RouterLink>
    </template>
  </section>
</template>

<style scoped>
h1 {
  margin: 8px 0 20px;
}
h2 {
  font-size: 1.2rem;
  margin: 28px 0 12px;
}
.steps {
  list-style: none;
  padding: 16px 20px;
  margin: 0 0 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.steps li {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.step {
  font-size: 0.78rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-mute);
}
.qr-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}
.qr-card img {
  max-width: 100%;
  height: auto;
  background: var(--on-color);
  border-radius: 12px;
}
.validity {
  margin: 0;
  font-weight: 800;
}
.countdown {
  margin: 0;
  color: var(--text-soft);
  font-variant-numeric: tabular-nums;
}
.warning {
  margin: 16px 0 0;
  padding: 12px 16px;
  border-radius: 16px;
  background: var(--tint-butter);
}
.devices {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.device {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.device div {
  display: flex;
  flex-direction: column;
}
.meta,
.hint {
  color: var(--text-soft);
}
.ok {
  margin: 0;
  font-weight: 800;
  color: var(--call);
}
.back {
  margin-top: 24px;
}
</style>
