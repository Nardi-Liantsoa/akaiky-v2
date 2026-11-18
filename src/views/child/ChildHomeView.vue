<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { useT } from '../../composables/useT'
import { appKind } from '../../lib/appKind'
import { startChild, type ChildState } from '../../lib/childStartup'
import { callJournal, childIdentity, configSync, deviceSession as session, parentCodeStore, countryStore } from '../../lib/deviceSessionInstance'
import { deviceConfig, pause, resume, startDeviceConfig, stopDeviceConfig } from '../../composables/useDeviceConfig'
import { emergencyNumber } from '../../lib/emergency'
import { sosPlan } from '../../lib/sos'
import { AkaikyCall } from '../../native/akaikyCall'
import { AkaikyDevice, type DeviceStatus } from '../../native/akaikyDevice'
import ChildStatusBar from '../../components/child/ChildStatusBar.vue'
import ContactTile from '../../components/child/ContactTile.vue'
import SosButton from '../../components/child/SosButton.vue'
import UnlockPanel from '../../components/child/UnlockPanel.vue'
import { armKiosk, disarmKiosk, isUnlocked, kiosk, lockNow, refreshKiosk, useKioskPlugin } from '../../composables/useKiosk'
import { AkaikyKiosk } from '../../native/kiosk'
import { formatClock } from '../../lib/format'

// Écran de l'app enfant : échange du jeton reçu au provisionnement (NAR-164), puis
// accueil (NAR-142, maquette écran 1) : heure, contacts à appeler en un appui, SOS.
// Fonctionne sans Internet : contacts et enfant gardés, appels par la carte SIM.
const t = useT()
const state = ref<ChildState | { kind: 'loading' }>({ kind: 'loading' })
const busy = ref(false)

async function start() {
  if (busy.value) return
  busy.value = true
  try {
    // Hors du téléphone de l'enfant (web, app parent, développement) : écran d'attente.
    if (!Capacitor.isNativePlatform() || (await appKind()) !== 'enfant') { state.value = { kind: 'waiting' }; return }
    // Mode appareil dédié (NAR-167) : état réel du natif et code parent gardé, dès
    // l'ouverture et quel que soit l'état (hors ligne, retiré…) : la sortie reste possible.
    useKioskPlugin(AkaikyKiosk)
    void refreshKiosk().catch(() => {})
    parentHash.value = await parentCodeStore.get()
    lastCountry.value = await countryStore.get()
    state.value = await startChild({
      session,
      provisioning: {
        token: async () => (await AkaikyDevice.getProvisioning()).pairingToken ?? null,
        clear: () => AkaikyDevice.clearProvisioning()
      },
      info: async () => {
        const i = await AkaikyDevice.getInfo()
        return { model: i.model, osVersion: i.osVersion, appVersion: i.appVersion }
      },
      identity: childIdentity
    })
  } finally {
    busy.value = false
  }
}
onMounted(start)

// Appairé : configuration (contacts) relevée au premier plan, suspendue en arrière-plan.
// Écouteur posé une fois au montage, retiré au démontage ; chaque passage à « appairé »
// (premier lancement ou réappairage) repart d'un relevé neuf.
let unmounted = false
let lifecycle: PluginListenerHandle | undefined
let foreground = false
onMounted(async () => {
  if (!Capacitor.isNativePlatform()) return
  const handle = await App.addListener('appStateChange', ({ isActive }) => {
    foreground = isActive
    if (isActive) void refreshKiosk().catch(() => {})
    if (isActive && state.value.kind === 'paired') { resume(); startStatus(); syncJournal() } else { pause(); stopStatus(); clearTimeout(journalRetry) }
  })
  if (unmounted) { void handle.remove(); return }
  lifecycle = handle
  // État réel au moment de l'écoute : lancée en arrière-plan, l'app ne relève rien.
  foreground = (await App.getState()).isActive
  if (foreground && state.value.kind === 'paired') { resume(); startStatus() }
})
// Chaque nouvel état (même « appairé » → « appairé » pour un autre enfant) repart de zéro.
watch(state, async (s) => {
  if (s.kind !== 'paired') {
    stopDeviceConfig()
    clearTimeout(journalRetry)
    // Pas de levée automatique du verrou (un refus ponctuel du serveur ne doit pas rendre
    // le téléphone à l'enfant) : un téléphone retiré se libère avec le code parent.
    // Plus d'enfant appairé ici : aucune liste de contacts gardée sur le téléphone.
    if (s.kind === 'waiting' || s.kind === 'expired' || s.kind === 'revoked') void configSync.clear()
    return
  }
  await startDeviceConfig(configSync, s.childId)
  syncJournal()
  if (!unmounted && foreground && state.value === s) resume()
})
// Liste blanche du natif : il refuse tout numéro qui n'y est pas, quoi que demande l'écran.
// Transmise à chaque changement, et de nouveau juste avant chaque appel.
const allowedNumbers = () => (deviceConfig.config?.contacts ?? []).map((c) => c.phone)
watch(() => deviceConfig.config?.contacts, (contacts) => {
  // Configuration pas encore chargée : on ne remplace pas la liste gardée par le natif.
  if (!Capacitor.isNativePlatform() || !contacts) return
  void AkaikyCall.setAllowed({ numbers: allowedNumbers() }).catch(() => {})
}, { immediate: true })

// Batterie et réseau, relus toutes les minutes tant que l'accueil est affiché.
const status = ref<DeviceStatus | null>(null)
let statusTimer: ReturnType<typeof setInterval> | undefined
async function readStatus() {
  status.value = await AkaikyDevice.getStatus().catch(() => null)
}
function stopStatus() { clearInterval(statusTimer); statusTimer = undefined }
function startStatus() {
  stopStatus()
  if (state.value.kind !== 'paired' || !foreground || !Capacitor.isNativePlatform()) return
  void readStatus()
  statusTimer = setInterval(() => { void readStatus() }, 60_000)
}
watch(() => state.value.kind === 'paired', startStatus)

const contacts = computed(() => [...(deviceConfig.config?.contacts ?? [])].sort((a, b) => a.position - b.position))
const emergency = computed(() => emergencyNumber(deviceConfig.config?.country ?? lastCountry.value ?? undefined))
const calling = ref(false)
const callError = ref(false)
// Journal (NAR-166) : durées relevées au retour du composeur, puis envoi (ou file hors
// ligne). Android écrit son journal d'appels après la fin de l'appel : tant qu'un appel
// attend sa durée, nouvel essai toutes les 30 s au premier plan.
let journalRetry: ReturnType<typeof setTimeout> | undefined
function syncJournal() {
  clearTimeout(journalRetry)
  void callJournal.complete()
    .then(async (waiting) => {
      await callJournal.flush()
      if (waiting && foreground && !unmounted) journalRetry = setTimeout(syncJournal, 30_000)
    })
    .catch(() => {})
}

// Un appui, un appel : l'appli téléphone prend le relais. Pas de double appel en rafale.
// L'appel est noté au journal AVANT de partir (l'app peut être suspendue pendant l'appel),
// puis retiré s'il ne part pas.
async function call(phone: string, contact: { id: string, name: string }) {
  if (calling.value) return
  calling.value = true
  callError.value = false
  try {
    // Au mieux : la liste gardée par le natif sert si cet envoi échoue.
    await AkaikyCall.setAllowed({ numbers: allowedNumbers() }).catch(() => {})
    await placeCall(phone, contact)
  } catch {
    callError.value = true
  } finally {
    setTimeout(() => { calling.value = false }, 1500)
  }
}
// Appel d'un contact, noté au journal avant de partir ; retiré du journal s'il échoue.
async function placeCall(phone: string, contact: { id: string, name: string }) {
  const id = await callJournal.started(contact, phone).catch(() => null)
  try {
    await AkaikyCall.call({ number: phone })
  } catch (e) {
    if (id) void callJournal.cancel(id).catch(() => {})
    throw e
  }
}

// SOS maintenu 3 s : en attendant l'alerte complète (NAR-149), premier contact puis,
// si l'appel ne part pas, le numéro d'urgence. Jamais bloqué par un appel en cours.
async function sos() {
  callError.value = false
  await AkaikyCall.setAllowed({ numbers: allowedNumbers() }).catch(() => {})
  for (const step of sosPlan(contacts.value, emergency.value)) {
    try {
      const contact = contacts.value.find((c) => c.phone === step.number)
      if (step.kind === 'contact' && contact) await placeCall(step.number, contact)
      else await AkaikyCall.emergency({ number: step.number })
      return
    } catch {
      // Étape suivante.
    }
  }
  callError.value = true
}
async function callEmergency() {
  callError.value = false
  await AkaikyCall.emergency({ number: emergency.value }).catch(() => { callError.value = true })
}

// Mode appareil dédié (NAR-167). Le verrou ne s'arme qu'une fois le téléphone appairé
// ET un code parent connu : jamais de téléphone verrouillé sans sortie possible.
// Le hachage reçu est gardé à part (parentCodeStore) : il sert aussi hors ligne et sur
// les écrans d'erreur, où le bouton « Code parent » reste affiché.
const parentHash = ref<string | null>(null)
const lastCountry = ref<string | null>(null)
watch(() => deviceConfig.config, async (config) => {
  if (!config || state.value.kind !== 'paired') return
  if (config.country && config.country !== lastCountry.value) { lastCountry.value = config.country; void countryStore.set(config.country) }
  const hash = typeof config.parentCode === 'string' ? config.parentCode : null
  // Rien de neuf : ni écriture, ni politique réappliquée (chaque relevé passe ici).
  if (!hash || (hash === parentHash.value && kiosk.status?.armed)) return
  // Armé seulement si le hachage est bien gardé : sinon, après un redémarrage hors
  // ligne, le téléphone serait verrouillé sans code pour en sortir.
  const saved = await parentCodeStore.set(hash).then(() => true, () => false)
  if (!saved) return
  parentHash.value = hash
  await armKiosk().catch(() => refreshKiosk().catch(() => {}))
})
const unlocking = ref(false)
const canUnlock = computed(() => !!kiosk.status?.deviceOwner && !!kiosk.status.armed && !isUnlocked())
// Téléphone retiré, ou jamais relié : pendant une sortie, le parent peut le libérer
// (plus de verrou ni de restriction, réinitialisable et réappairable).
const canRelease = computed(() => isUnlocked() && state.value.kind !== 'paired')
async function release() {
  const status = await disarmKiosk().catch(() => null)
  // Le code n'est oublié que si le verrou est bien levé : jamais armé sans code.
  if (status && !status.armed) {
    await parentCodeStore.clear()
    parentHash.value = null
  } else {
    await refreshKiosk().catch(() => {})
  }
}
const unlockedUntil = computed(() => kiosk.status?.unlockedUntil)
async function openPhoneSettings() {
  await AkaikyKiosk.openSettings().catch(() => {})
}

// Téléphone retiré pendant l'usage : l'écran le dit.
watch(() => deviceConfig.status, (s) => { if (s === 'lost') state.value = { kind: 'revoked' } })
onBeforeUnmount(() => { unmounted = true; pause(); stopStatus(); clearTimeout(journalRetry); void lifecycle?.remove() })

const text = computed(() => {
  const c = t.value.child
  switch (state.value.kind) {
    case 'paired': return { title: c.hello(state.value.firstName), hint: c.pairedHint }
    case 'expired': return { title: c.expired, hint: c.expiredHint }
    case 'tooMany': return { title: c.tooMany, hint: c.tooManyHint }
    case 'revoked': return { title: c.revoked, hint: c.revokedHint }
    case 'offline': return { title: c.offline, hint: c.offlineHint }
    case 'failed': return { title: c.failed, hint: c.failedHint }
    case 'loading': return { title: c.connecting, hint: '' }
    default: return { title: c.waiting, hint: c.hint }
  }
})
</script>

<template>
  <main v-if="state.kind === 'paired'" class="home">
    <ChildStatusBar :status="status" />
    <section v-if="unlockedUntil !== undefined" class="unlocked" role="status">
      <p>{{ t.child.lock.unlockedUntil(formatClock(new Date(unlockedUntil))) }}</p>
      <div class="unlocked-actions">
        <button class="btn btn-ghost" type="button" @click="openPhoneSettings">{{ t.child.lock.settings }}</button>
        <button class="btn" type="button" @click="lockNow().catch(() => {})">{{ t.child.lock.relock }}</button>
      </div>
    </section>
    <p v-if="callError" class="call-error" role="alert">{{ t.child.callFailed }}</p>
    <section v-if="contacts.length" class="grid" :class="{ single: contacts.length === 1 }">
      <ContactTile v-for="c in contacts" :key="c.id" :name="c.name" :color="c.avatarColor" :busy="calling" @call="call(c.phone, c)" />
    </section>
    <section v-else class="empty">
      <p class="waiting">{{ t.child.noContacts }}</p>
      <p class="hint">{{ t.child.noContactsHint }}</p>
    </section>
    <footer class="actions">
      <SosButton @trigger="sos" />
      <button class="emergency" type="button" @click="callEmergency">{{ t.child.emergency(emergency) }}</button>
      <button v-if="canUnlock" class="parent-code" type="button" @click="unlocking = true">{{ t.child.lock.open }}</button>
    </footer>
    <UnlockPanel v-if="unlocking" :hash="parentHash" @close="unlocking = false" @unlocked="unlocking = false" />
  </main>
  <main v-else class="child">
    <h1>Akaiky</h1>
    <p class="waiting" role="status">{{ text.title }}</p>
    <p v-if="text.hint" class="hint">{{ text.hint }}</p>
    <button v-if="state.kind === 'offline' || state.kind === 'tooMany' || state.kind === 'failed'" class="btn retry" type="button" :disabled="busy" @click="start">{{ t.child.retry }}</button>
    <!-- Verrouillé sur un écran d'attente ou d'erreur : secours et sortie parent restent là. -->
    <template v-if="kiosk.status?.armed">
      <button class="emergency" type="button" @click="callEmergency">{{ t.child.emergency(emergency) }}</button>
      <button v-if="canUnlock" class="parent-code" type="button" @click="unlocking = true">{{ t.child.lock.open }}</button>
      <template v-if="unlockedUntil !== undefined">
        <p class="hint">{{ t.child.lock.unlockedUntil(formatClock(new Date(unlockedUntil))) }}</p>
        <button v-if="canRelease" class="btn" type="button" @click="release">{{ t.child.lock.release }}</button>
        <button class="btn btn-ghost" type="button" @click="lockNow().catch(() => {})">{{ t.child.lock.relock }}</button>
      </template>
      <UnlockPanel v-if="unlocking" :hash="parentHash" @close="unlocking = false" @unlocked="unlocking = false" />
    </template>
  </main>
</template>

<style scoped>
.child {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 100vh;
  padding: calc(var(--safe-top) + 24px) calc(var(--gutter) + var(--safe-right)) calc(var(--safe-bottom) + 24px) calc(var(--gutter) + var(--safe-left));
  background: var(--bg-child);
  text-align: center;
}
h1 {
  margin: 0 0 8px;
  font-size: 3rem;
  font-weight: 900;
}
.waiting {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 800;
}
.hint {
  margin: 0;
  max-width: 28em;
  color: var(--text-soft);
}
.home {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 100vh;
  padding: calc(var(--safe-top) + 12px) calc(var(--gutter) + var(--safe-right)) calc(var(--safe-bottom) + 16px) calc(var(--gutter) + var(--safe-left));
  background: var(--bg-child);
  box-sizing: border-box;
}
/* 1 contact : une grande vignette ; 2 à 6 : deux colonnes (maquette : 2×2). */
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.grid.single {
  grid-template-columns: 1fr;
}
.empty {
  text-align: center;
}
.actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-top: auto;
}
.emergency {
  min-height: 64px;
  padding: 0 24px;
  border: 2px solid var(--sos);
  border-radius: 999px;
  background: transparent;
  color: var(--sos);
  font: inherit;
  font-weight: 900;
}
.unlocked {
  padding: 12px 16px;
  border-radius: 16px;
  background: var(--surface);
  text-align: center;
  font-weight: 800;
}
.unlocked p {
  margin: 0 0 8px;
}
.unlocked-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
/* Discret : réservé aux parents, protégé par le code. */
.parent-code {
  min-height: 48px;
  padding: 0 16px;
  border: 0;
  background: transparent;
  color: var(--text-soft);
  font: inherit;
  font-weight: 700;
  text-decoration: underline;
}
.call-error {
  margin: 0;
  text-align: center;
  font-weight: 800;
  color: var(--sos);
}
.retry {
  margin-top: 16px;
  min-height: 64px;
  padding: 0 32px;
}
</style>
