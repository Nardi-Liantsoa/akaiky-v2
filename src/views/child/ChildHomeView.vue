<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { useT } from '../../composables/useT'
import { appKind } from '../../lib/appKind'
import { startChild, type ChildState } from '../../lib/childStartup'
import { callJournal, childIdentity, configSync, deviceSession as session, parentCodeStore, countryStore, remoteUnlockSeen, messageOutbox, heartbeat } from '../../lib/deviceSessionInstance'
import { deviceConfig, pause, resume, startDeviceConfig, stopDeviceConfig } from '../../composables/useDeviceConfig'
import { emergencyNumber } from '../../lib/emergency'
import { sosPlan } from '../../lib/sos'
import { AkaikyCall } from '../../native/akaikyCall'
import { AkaikyDevice, type DeviceStatus } from '../../native/akaikyDevice'
import ChildStatusBar from '../../components/child/ChildStatusBar.vue'
import ContactTile from '../../components/child/ContactTile.vue'
import SosButton from '../../components/child/SosButton.vue'
import UnlockPanel from '../../components/child/UnlockPanel.vue'
import QuickMessagesPanel from '../../components/child/QuickMessagesPanel.vue'
import { armKiosk, disarmKiosk, isUnlocked, kiosk, lockNow, refreshKiosk, unlockKiosk, useKioskPlugin } from '../../composables/useKiosk'
import { AkaikyKiosk, UNLOCK_MINUTES } from '../../native/kiosk'
import { formatClock } from '../../lib/format'
import { activeWindow, safeTimeZone, visibleContacts } from '../../lib/schedule'

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
    void readScreening()
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
    if (isActive) startClock(); else stopClock()
    if (isActive) { void refreshKiosk().catch(() => {}).then(() => applyRemoteUnlock()); void readScreening() }
    if (isActive && state.value.kind === 'paired') { resume(); startStatus(); syncJournal() } else { pause(); stopStatus(); clearTimeout(journalRetry) }
  })
  if (unmounted) { void handle.remove(); return }
  lifecycle = handle
  // État réel au moment de l'écoute : lancée en arrière-plan, l'app ne relève rien.
  foreground = (await App.getState()).isActive
  if (!foreground) stopClock()
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
// Liste et pays envoyés au natif (il refuse tout autre numéro, et filtre les appels
// entrants). Jamais avant le chargement de la configuration : une liste vide envoyée par
// erreur activerait un filtre qui bloque tous les appels entrants.
async function pushAllowed() {
  const config = deviceConfig.config
  if (!Capacitor.isNativePlatform() || !config || state.value.kind !== 'paired') return
  await AkaikyCall.setAllowed({
    numbers: config.contacts.map((c) => c.phone),
    ...(config.country ? { country: config.country.toUpperCase() } : {}),
    // Plages « école » (NAR-176) : le natif les applique seul, écran éteint compris.
    parents: config.contacts.filter((c) => c.parent === true).map((c) => c.phone),
    schedules: (config.schedules ?? []).map(({ days, startMin, endMin }) => ({ days, startMin, endMin })),
    timezone: safeTimeZone(config.timezone)
  }).catch(() => {})
}
// Contacts, pays ou plages changés : renvoyés au natif (filtre des appels entrants compris).
watch(() => [deviceConfig.config?.contacts, deviceConfig.config?.country, deviceConfig.config?.schedules, deviceConfig.config?.timezone] as const, () => { void pushAllowed() }, { immediate: true })

// Batterie et réseau, relus toutes les minutes tant que l'accueil est affiché. Signal de vie
// envoyé au serveur (NAR-147) au premier relevé, puis toutes les 15 minutes, ou tout de suite
// si la batterie passe sous 15 % ou si la carte SIM change (règle dans lib/heartbeat.ts).
const status = ref<DeviceStatus | null>(null)
let statusTimer: ReturnType<typeof setInterval> | undefined
async function readStatus() {
  status.value = await AkaikyDevice.getStatus().catch(() => null)
  if (state.value.kind === 'paired') void heartbeat.tick(status.value)
}
function stopStatus() { clearInterval(statusTimer); statusTimer = undefined }
function startStatus() {
  stopStatus()
  if (state.value.kind !== 'paired' || !foreground || !Capacitor.isNativePlatform()) return
  void readStatus()
  // Le téléphone reste sur l'app (verrou) : les appels bloqués sont repris chaque minute.
  // Liste renvoyée aussi : un premier envoi manqué laisserait le filtre inactif.
  statusTimer = setInterval(() => { void readStatus(); syncJournal(); void pushAllowed() }, 60_000)
}
watch(() => state.value.kind === 'paired', startStatus)

const contacts = computed(() => [...(deviceConfig.config?.contacts ?? [])].sort((a, b) => a.position - b.position))

// Plage « école » (NAR-148, maquette écran 5) : calculée ici, hors ligne, sur l'heure du
// téléphone (réseau ; réglage manuel interdit par le verrou). Relue toutes les 15 s et à
// chaque reprise : elle se pose et se lève seule, à la minute près.
// Horloge relue au changement de minute (comme l'heure affichée), arrêtée en arrière-plan
// (batterie) et relancée à la reprise.
const now = ref(Date.now())
let clockTimer: ReturnType<typeof setTimeout> | undefined
function startClock() {
  stopClock()
  now.value = Date.now()
  clockTimer = setTimeout(startClock, 60_000 - (now.value % 60_000) + 50)
}
function stopClock() { clearTimeout(clockTimer); clockTimer = undefined }
startClock()
const familyZone = computed(() => safeTimeZone(deviceConfig.config?.timezone))
const school = computed(() => activeWindow(new Date(now.value), deviceConfig.config?.schedules ?? [], familyZone.value))
// Fin de plage affichée dans le fuseau de la famille, comme le calcul.
const schoolEnd = computed(() => (school.value?.until ? formatClock(school.value.until, familyZone.value) : null))
// Pendant une plage : les seuls contacts parents (owner, manager), le SOS et les secours.
const shown = computed(() => visibleContacts(contacts.value, school.value))
watch(() => !!school.value, (on) => { if (on) messaging.value = false })
const emergency = computed(() => emergencyNumber(deviceConfig.config?.country ?? lastCountry.value ?? undefined))
const calling = ref(false)
const callError = ref(false)
// Journal (NAR-166) : durées relevées au retour du composeur, puis envoi (ou file hors
// ligne). Android écrit son journal d'appels après la fin de l'appel : tant qu'un appel
// attend sa durée, nouvel essai toutes les 30 s au premier plan.
let journalRetry: ReturnType<typeof setTimeout> | undefined
function syncJournal() {
  clearTimeout(journalRetry)
  // Messages rapides restés hors ligne (NAR-150) : envoyés au même rythme.
  void messageOutbox.flush().catch(() => {})
  // Une erreur d'import n'empêche jamais l'envoi du reste du journal.
  void importScreened().catch(() => {})
    .then(() => callJournal.complete())
    .then(async (waiting) => {
      await callJournal.flush()
      if (waiting && foreground && !unmounted) journalRetry = setTimeout(syncJournal, 30_000)
    })
    .catch(() => {})
}

// Rôle de filtrage d'Android 10+ (NAR-145) : le Device Owner ne peut pas se l'accorder,
// une confirmation système est demandée une fois. Proposée seulement quand cet écran
// système peut s'afficher : téléphone pas encore verrouillé, ou sortie par le code.
const screening = ref<{ available: boolean, held: boolean } | null>(null)
async function readScreening() {
  if (!Capacitor.isNativePlatform()) return
  screening.value = await AkaikyCall.screeningRole().catch(() => null)
}
const askScreening = computed(() => state.value.kind === 'paired' && !!screening.value?.available && !screening.value.held
  && (!kiosk.status?.armed || isUnlocked()))
async function enableScreening() {
  const r = await AkaikyCall.requestScreeningRole().catch(() => null)
  if (r && screening.value) screening.value = { ...screening.value, held: r.held }
}

// Appels entrants vus par le filtre natif (NAR-145) : repris dans la file du journal,
// puis acquittés auprès du natif (rien n'est perdu si l'app s'arrête entre les deux).
async function importScreened() {
  // Contacts pas encore chargés : on attend (le nom du contact d'un appel reçu en dépend).
  if (!Capacitor.isNativePlatform() || !deviceConfig.config) return
  const { events } = await AkaikyCall.peekIncoming().catch(() => ({ events: [] }))
  if (!events.length) return
  const kept = await callJournal.importScreened(events, deviceConfig.config?.contacts ?? [])
  await AkaikyCall.ackIncoming({ ids: kept }).catch(() => {})
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
    await pushAllowed()
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
  await pushAllowed()
  // Pendant une plage « école » : les seuls parents (ceux que l'écran montre), sinon
  // directement les secours.
  const order = school.value ? shown.value : contacts.value
  for (const step of sosPlan(order, emergency.value)) {
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
// Déverrouillage demandé à distance (NAR-168) : appliqué une seule fois par demande
// (l'échéance l'identifie), tant qu'elle n'est pas passée. Minutes arrondies à l'inférieur :
// jamais ouvert au-delà de l'échéance du parent. Une sortie déjà plus longue n'est pas
// raccourcie. Marquée « vue » seulement une fois appliquée (un échec sera retenté au
// relevé ou à la reprise suivante), puis notée au journal du parent.
// L'heure du téléphone vient du réseau (réglage manuel interdit par le verrou).
let applyingRemote = false
let rerun = false
// Gardé aussi en mémoire : si l'écriture du « vu » échoue, la demande n'est pas
// réappliquée pendant cette session.
let appliedRemote: string | null = null
async function applyRemoteUnlock() {
  if (applyingRemote) { rerun = true; return }
  applyingRemote = true
  try {
    do {
      rerun = false
      const until = deviceConfig.config?.remoteUnlockUntil
      if (!until || state.value.kind !== 'paired' || !kiosk.status?.armed) continue
      if (appliedRemote === until || (await remoteUnlockSeen.get()) === until) continue
      // État réel du natif : l'alarme a pu refermer une sortie que l'écran croit ouverte.
      await refreshKiosk().catch(() => {})
      const end = Date.parse(until)
      const minutes = Math.min(UNLOCK_MINUTES, Math.floor((end - Date.now()) / 60_000))
      const current = kiosk.status?.unlockedUntil
      if (Number.isNaN(end) || minutes < 1 || (current !== undefined && current >= end)) {
        appliedRemote = until
        await remoteUnlockSeen.set(until).catch(() => {})
        continue
      }
      const status = await unlockKiosk(minutes).catch(() => null)
      // Échec : rien de marqué, nouvel essai à la reprise suivante de l'app.
      if (status?.unlockedUntil === undefined) continue
      appliedRemote = until
      await remoteUnlockSeen.set(until).catch(() => {})
      await callJournal.unlocked('remote', minutes).catch(() => {})
      syncJournal()
    } while (rerun)
  } finally {
    applyingRemote = false
  }
}
// Relu quand la demande change, quand le verrou s'arme, et à chaque reprise de l'app.
watch(() => [deviceConfig.config?.remoteUnlockUntil, kiosk.status?.armed] as const, () => { void applyRemoteUnlock() })
// Sortie par le code saisi sur le téléphone : notée au journal (15 minutes).
async function onUnlocked() {
  unlocking.value = false
  await callJournal.unlocked('code', UNLOCK_MINUTES).catch(() => {})
  syncJournal()
}

const unlocking = ref(false)
// « Dire à mes parents » (NAR-150).
const messaging = ref(false)
const canUnlock = computed(() => !!kiosk.status?.deviceOwner && !!kiosk.status.armed && !isUnlocked())
// Téléphone retiré, ou jamais relié : pendant une sortie, le parent peut le libérer
// (plus de verrou ni de restriction, réinitialisable et réappairable).
const canRelease = computed(() => isUnlocked() && state.value.kind !== 'paired')
async function release() {
  const status = await disarmKiosk().catch(() => null)
  // Le code n'est oublié, et le filtre coupé, que si le verrou est bien levé.
  if (status && !status.armed) {
    await AkaikyCall.stopFiltering().catch(() => {})
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
onBeforeUnmount(() => { unmounted = true; stopClock(); pause(); stopStatus(); clearTimeout(journalRetry); void lifecycle?.remove() })

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
  <main v-if="state.kind === 'paired'" class="home" :class="{ school }">
    <ChildStatusBar :status="status" />
    <section v-if="school" class="school-banner" role="status">
      <p class="school-title">{{ t.child.school.title(school.label) }}</p>
      <p>{{ schoolEnd ? t.child.school.until(schoolEnd) : t.child.school.noEnd }}</p>
    </section>
    <section v-if="unlockedUntil !== undefined" class="unlocked" role="status">
      <p>{{ t.child.lock.unlockedUntil(formatClock(new Date(unlockedUntil))) }}</p>
      <div class="unlocked-actions">
        <button class="btn btn-ghost" type="button" @click="openPhoneSettings">{{ t.child.lock.settings }}</button>
        <button class="btn" type="button" @click="lockNow().catch(() => {})">{{ t.child.lock.relock }}</button>
      </div>
    </section>
    <section v-if="askScreening" class="unlocked" role="status">
      <p>{{ t.child.screening.off }}</p>
      <button class="btn" type="button" @click="enableScreening">{{ t.child.screening.enable }}</button>
    </section>
    <p v-if="callError" class="call-error" role="alert">{{ t.child.callFailed }}</p>
    <section v-if="shown.length" class="grid" :class="{ single: shown.length === 1 }">
      <ContactTile v-for="c in shown" :key="c.id" :name="c.name" :color="c.avatarColor" :busy="calling" @call="call(c.phone, c)" />
    </section>
    <section v-else-if="school" class="empty">
      <p class="waiting">{{ t.child.school.noParents }}</p>
    </section>
    <section v-else class="empty">
      <p class="waiting">{{ t.child.noContacts }}</p>
      <p class="hint">{{ t.child.noContactsHint }}</p>
    </section>
    <p v-if="schoolEnd" class="school-rest">{{ t.child.school.rest(schoolEnd) }}</p>
    <template v-if="!school">
      <button class="messages" type="button" @click="messaging = true">{{ t.child.quick.open }}</button>
      <QuickMessagesPanel v-if="messaging" @close="messaging = false" />
    </template>
    <footer class="actions">
      <SosButton @trigger="sos" />
      <button class="emergency" type="button" @click="callEmergency">{{ t.child.emergency(emergency) }}</button>
      <button v-if="canUnlock" class="parent-code" type="button" @click="unlocking = true">{{ t.child.lock.open }}</button>
    </footer>
    <UnlockPanel v-if="unlocking" :hash="parentHash" @close="unlocking = false" @unlocked="onUnlocked" />
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
      <UnlockPanel v-if="unlocking" :hash="parentHash" @close="unlocking = false" @unlocked="onUnlocked" />
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
/* Plage « école » (maquette écran 5) : fond bleuté, bandeau marine. */
.home.school {
  background: var(--bg-child-school);
}
.school-banner {
  padding: 14px 18px;
  border-radius: 20px;
  background: var(--navy);
  color: #fff;
  text-align: center;
  font-weight: 800;
}
.school-banner p {
  margin: 0;
}
.school-title {
  font-size: 1.2rem;
  font-weight: 900;
}
.school-rest {
  margin: 0;
  text-align: center;
  color: var(--text-soft);
  font-weight: 800;
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
.messages {
  min-height: 64px;
  border: 0;
  border-radius: 20px;
  background: var(--tint-butter);
  color: var(--text);
  font: inherit;
  font-size: 1.2rem;
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
