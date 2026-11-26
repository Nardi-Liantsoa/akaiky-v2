<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { locale, useT } from '../../composables/useT'
import { appKind } from '../../lib/appKind'
import { startChild, type ChildState } from '../../lib/childStartup'
import { appInventory, callJournal, childIdentity, configSync, deviceSession as session, parentCodeStore, countryStore, remoteUnlockSeen, messageOutbox, heartbeat } from '../../lib/deviceSessionInstance'
import { deviceConfig, pause, refreshNow, resume, startDeviceConfig, stopDeviceConfig } from '../../composables/useDeviceConfig'
import { emergencyNumber } from '../../lib/emergency'
import { sosPlan } from '../../lib/sos'
import { buildSosPlan, confirmNativeSos } from '../../lib/sosCascade'
import { AkaikySos, type SosState } from '../../native/akaikySos'
import SosSentView from './SosSentView.vue'
import { AkaikyCall, type ScreeningState } from '../../native/akaikyCall'
import { canRequestRedirection, canRequestScreening, incomingFilterOff, outgoingFilterOff } from '../../lib/callScreening'
import { AkaikyDevice, type DeviceStatus } from '../../native/akaikyDevice'
import ChildStatusBar from '../../components/child/ChildStatusBar.vue'
import AppIcon from '../../components/ui/AppIcon.vue'
import ContactTile from '../../components/child/ContactTile.vue'
import SosButton from '../../components/child/SosButton.vue'
import UnlockPanel from '../../components/child/UnlockPanel.vue'
import QuickMessagesPanel from '../../components/child/QuickMessagesPanel.vue'
import AppsRow from '../../components/child/AppsRow.vue'
import { appsRow } from '../../lib/appInventory'
import { createSchoolFront } from '../../lib/schoolFront'
import { armKiosk, disarmKiosk, isUnlocked, kiosk, lockNow, refreshKiosk, unlockKiosk, useKioskPlugin } from '../../composables/useKiosk'
import { AkaikyKiosk, UNLOCK_MINUTES, type LaunchableApp } from '../../native/kiosk'
import { AkaikyBackground } from '../../native/akaikyBackground'
import { API_BASE } from '../../api/base'
import { createBackgroundStatus } from '../../lib/backgroundStatus'
import { createApkUpdater } from '../../lib/apkUpdate'
import { AkaikyUpdate } from '../../native/akaikyUpdate'
import { setOtaScreenBusy } from '../../lib/otaRuntime'
import { formatClock } from '../../lib/format'
import { accentToken, initial } from '../../lib/avatar'
import { joinNames } from '../../lib/joinNames'
import { activeWindow, safeTimeZone, visibleContacts } from '../../lib/schedule'
import AppButton from '../../components/ui/AppButton.vue'
import WatchingBadge from '../../components/child/WatchingBadge.vue'
import { AkaikyLocation } from '../../native/akaikyLocation'
import { FirebaseMessaging } from '../../native/firebaseMessaging'
import { createPushRegistration } from '../../lib/pushRegistration'
import { pushType } from '../../lib/pushRoute'
import { LOCATE_POLL_MS, createLocateWatch } from '../../lib/locateWatch'

// Écran de l'app enfant : échange du jeton reçu au provisionnement (NAR-164), puis
// accueil (NAR-142, maquette écran 1) : heure, contacts à appeler en un appui, SOS.
// Fonctionne sans Internet : contacts et enfant gardés, appels par la carte SIM.
const t = useT()
// Signal natif en arrière-plan (NAR-180) : jeton « signal de vie » émis par la session
// d'appareil, une fois par lancement ou quand le natif le dit perdu.
const backgroundStatus = createBackgroundStatus({ session, plugin: AkaikyBackground, apiBase: API_BASE })
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
let sosListener: PluginListenerHandle | undefined
let foreground = false
onMounted(async () => {
  if (!Capacitor.isNativePlatform()) return
  const handle = await App.addListener('appStateChange', ({ isActive }) => {
    foreground = isActive
    if (isActive) startClock(); else stopClock()
    if (isActive) { void refreshKiosk().catch(() => {}).then(() => applyRemoteUnlock()); void readScreening(); void readSos() }
    if (isActive && state.value.kind === 'paired') { resume(); startStatus(); startLocate(); syncJournal(); void backgroundStatus.ensure(); void syncApps(); checkUpdate(); void registerPush(state.value) } else { pause(); stopStatus(); stopLocate(); clearTimeout(journalRetry) }
  })
  // SOS en cours (NAR-151) : état poussé par le service natif quand la WebView est éveillée,
  // relu à chaque reprise (écran rallumé pendant la cascade).
  const sosHandle = await AkaikySos.addListener('sosUpdate', onSosState).catch(() => undefined)
  if (unmounted) { void handle.remove(); void sosHandle?.remove(); return }
  lifecycle = handle
  sosListener = sosHandle
  void readSos()
  // État réel au moment de l'écoute : lancée en arrière-plan, l'app ne relève rien.
  foreground = (await App.getState()).isActive
  if (!foreground) stopClock()
  if (foreground && state.value.kind === 'paired') { resume(); startStatus(); startLocate() }
})
// Chaque nouvel état (même « appairé » → « appairé » pour un autre enfant) repart de zéro.
watch(state, async (s) => {
  if (s.kind !== 'paired') {
    stopLocate()
    showWatching(null)
    stopDeviceConfig()
    clearTimeout(journalRetry)
    // Pas de levée automatique du verrou (un refus ponctuel du serveur ne doit pas rendre
    // le téléphone à l'enfant) : un téléphone retiré se libère avec le code parent.
    // Plus d'enfant appairé ici : aucune liste de contacts gardée sur le téléphone.
    if (s.kind === 'waiting' || s.kind === 'expired' || s.kind === 'revoked') {
      // Session perdue : le serveur a effacé le jeton push du téléphone, plus rien à envoyer.
      childPush.stop()
      void configSync.clear()
      // Plus de session : le signal natif en arrière-plan (NAR-180) s'arrête aussi.
      void backgroundStatus.stop()
    }
    return
  }
  // Appairé : signal de vie natif en arrière-plan, écran éteint compris (NAR-180), avec un
  // jeton « signal de vie » émis par la session d'appareil (hors ligne : au retour au premier plan).
  void backgroundStatus.ensure()
  // Réveils push (NAR-179) : jeton de ce téléphone pour cette session d'appareil.
  childPush.stop()
  void registerPush(s)
  await startDeviceConfig(configSync, s.childId)
  // Nouvel appairage (autre enfant, réappairage) : la position repart de zéro aussi.
  if (!unmounted && state.value === s) startLocate()
  syncJournal()
  void syncApps()
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

// Applications autorisées (NAR-143). Inventaire du téléphone relu au passage à « appairé » et
// à chaque reprise, envoyé au serveur seulement s'il a changé (empreinte). Liste du parent
// transmise au natif à chaque changement et quand le verrou s'arme : il cache les autres
// applications et n'ouvre que celles-là dans le lock task. Coque plus ancienne sans ces
// méthodes : rejet ignoré, la rangée reste vide.
const localApps = ref<LaunchableApp[]>([])
async function syncApps() {
  if (!Capacitor.isNativePlatform() || state.value.kind !== 'paired') return
  const childId = state.value.childId
  const listed = await AkaikyKiosk.listLaunchableApps().catch(() => null)
  if (!listed || state.value.kind !== 'paired' || state.value.childId !== childId) return
  localApps.value = listed.apps
  await appInventory.sync(childId, listed.apps).catch(() => {})
}
const allowedPackages = computed(() => [...(deviceConfig.config?.allowedApps ?? [])].sort((a, b) => a.position - b.position).map((a) => a.package))
async function pushApps() {
  // Jamais avant le chargement de la configuration : une liste vide cacherait tout par erreur.
  if (!Capacitor.isNativePlatform() || !deviceConfig.config || state.value.kind !== 'paired') return
  await AkaikyKiosk.applyAllowedApps({ packages: allowedPackages.value }).catch(() => {})
}
watch(() => [allowedPackages.value.join(), !!deviceConfig.config, kiosk.status?.armed] as const, () => { void pushApps() }, { immediate: true })
const launchError = ref(false)
async function launch(pkg: string) {
  launchError.value = false
  await AkaikyKiosk.launchApp({ package: pkg }).catch(() => { launchError.value = true })
}

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

// Position à la demande (NAR-204) : tant que l'accueil est au premier plan, l'écran demande au
// serveur toutes les 15 s si un membre regarde ; si un relevé est dû, un relevé unique part
// (natif, 20 s au plus). Rien en arrière-plan : le réveil push `locate` viendra avec NAR-179.
// Coque plus ancienne sans le greffon : le relevé est refusé, seul l'indicateur s'affiche.
const watchers = ref<string[]>([])
let watchEnd: ReturnType<typeof setTimeout> | undefined
// Indicateur affiché dès que l'écran sait qu'on regarde (avant le relevé), effacé à la fin de
// la consultation même sans nouveau tour (hors ligne).
// Durée restante donnée par le serveur, décomptée ici (minuteur) : jamais l'heure du téléphone.
function showWatching(w: { names: string[], forMs: number } | null) {
  clearTimeout(watchEnd)
  watchers.value = w ? w.names : []
  if (w) watchEnd = setTimeout(() => { watchers.value = [] }, w.forMs)
}
const locateWatch = createLocateWatch({
  get: (path) => session.get(path),
  post: (path, body) => session.post(path, body),
  fix: () => AkaikyLocation.currentPosition(),
  cancelFix: () => AkaikyLocation.cancel(),
  onWatching: showWatching
})
let locateTimer: ReturnType<typeof setInterval> | undefined
function readLocate() {
  if (state.value.kind === 'paired') void locateWatch.tick()
}
function stopLocate() {
  if (locateTimer === undefined) return
  clearInterval(locateTimer); locateTimer = undefined
  locateWatch.stop()
}
// Réveils silencieux (NAR-179) : `locate` (un parent demande la position, NAR-203) et
// `config` (contacts, plages… changés). Jeton envoyé par la session d'appareil
// (PUT /api/device/push/token), sans permission à demander : rien n'est affiché à l'enfant.
// Reçus quand l'app est ouverte ; app fermée ou écran éteint, ils n'atteignent pas l'écran
// (greffon : un message « data » seul ne réveille pas le JavaScript) : le relevé régulier
// de 15 s au premier plan reste la règle.
const childPush = createPushRegistration({
  messaging: FirebaseMessaging,
  send: (r) => session.put('/device/push/token', { ...r, platform: 'android' }),
  platform: 'android',
  lang: () => locale.value,
  needsPermission: false
})
let pushListeners: PluginListenerHandle[] = []
// Écouteurs posés une seule fois, même si deux « appairé » se suivent de près.
let pushListening: Promise<void> | null = null
function startPush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve()
  pushListening ??= (async () => {
    const results = await Promise.allSettled([
      FirebaseMessaging.addListener('tokenReceived', ({ token }) => { void childPush.tokenChanged(token) }),
      FirebaseMessaging.addListener('notificationReceived', ({ notification }) => {
        if (state.value.kind !== 'paired' || !foreground) return
        const type = pushType(notification.data)
        if (type === 'locate') readLocate()
        else if (type === 'config') void refreshNow()
      })
    ])
    const handles = results.flatMap((r) => r.status === 'fulfilled' ? [r.value] : [])
    // Un écouteur manquant : tout est retiré et repris au prochain appairage ou à la reprise.
    if (unmounted || handles.length < results.length) {
      handles.forEach((h) => void h.remove())
      if (!unmounted) pushListening = null
      return
    }
    pushListeners = handles
  })()
  return pushListening
}
// Nouvelle session d'appareil (appairage, réappairage) : jeton renvoyé pour elle ; à chaque
// reprise de l'app, jeton renvoyé s'il manque encore au serveur.
async function registerPush(s: ChildState) {
  await startPush()
  if (unmounted || state.value !== s) return
  void childPush.start()
}

function startLocate() {
  stopLocate()
  if (unmounted || state.value.kind !== 'paired' || !foreground || !Capacitor.isNativePlatform()) { showWatching(null); return }
  readLocate()
  locateTimer = setInterval(readLocate, LOCATE_POLL_MS)
}
// Lancée à chaque appairage (watch(state) ci-dessous) et à chaque reprise, arrêtée en
// arrière-plan et hors de l'état « appairé » : un seul point de départ par événement.

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
// Contacts masqués pendant une plage (planche 04, NAR-238) : montrés en fantôme, jamais appelables.
const hidden = computed(() => contacts.value.filter((c) => !shown.value.includes(c)))
// Pendant une plage « école » : pas de rangée d'applications (seuls les parents et le SOS).
const tiles = computed(() => appsRow(deviceConfig.config?.allowedApps, localApps.value, !!school.value))
watch(() => !!school.value, (on) => { if (on) messaging.value = false })
// Plage « école » et applications autorisées (NAR-143) : au début et à la fin de la plage,
// verrou réappliqué (lock task sans, puis avec, les applications autorisées) ; pendant la
// plage, l'app est redemandée au premier plan à chaque tour tant qu'elle n'est pas devant
// (le natif refuse déjà d'en ouvrir une). Minuteur de 60 s à part de l'horloge, qui s'arrête
// en arrière-plan ; ce minuteur-ci n'est pas arrêté, mais Android peut suspendre la WebView en
// arrière-plan : rien ne garantit son tour avant la reprise (limites : HANDOFF.md).
const schoolFront = createSchoolFront({ bring: () => AkaikyKiosk.bringToFront(), refresh: () => AkaikyKiosk.refresh() })
function watchSchool() {
  const on = !!activeWindow(new Date(), deviceConfig.config?.schedules ?? [], familyZone.value)
  schoolFront({ school: on, foreground, active: Capacitor.isNativePlatform() && state.value.kind === 'paired' })
}
const schoolWatch = setInterval(watchSchool, 60_000)
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
// Appels sortants (NAR-169) : état réel du filtre lu sur le téléphone (rôle de redirection sur
// Android 10+, demandé au même moment par le même bouton ; récepteur et permission sur 8–9).
const screening = ref<ScreeningState | null>(null)
async function readScreening() {
  if (!Capacitor.isNativePlatform()) return
  screening.value = await AkaikyCall.screeningRole().catch(() => null)
}
const incomingOff = computed(() => incomingFilterOff(screening.value))
const outgoingOff = computed(() => outgoingFilterOff(screening.value))
const canEnableScreening = computed(() => canRequestScreening(screening.value) || canRequestRedirection(screening.value))
// Filtrage inactif : la pastille le dit toujours (planche 02, NAR-238) ; le détail et « Activer »
// seulement quand le téléphone n'est pas verrouillé (avant l'armement, ou en mode parent).
const screeningOff = computed(() => state.value.kind === 'paired' && (incomingOff.value || outgoingOff.value))
const askScreening = computed(() => screeningOff.value && (!kiosk.status?.armed || isUnlocked()))
async function enableScreening() {
  if (canRequestScreening(screening.value)) await AkaikyCall.requestScreeningRole().catch(() => null)
  if (canRequestRedirection(screening.value)) await AkaikyCall.requestRedirectionRole().catch(() => null)
  // Relu sur le téléphone : le bandeau reflète l'état réel, pas la réponse de la confirmation.
  await readScreening()
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

// SOS maintenu 3 s (NAR-151) : service natif hors ligne (SMS aux parents avec la position,
// cascade d'appels, sirène si un parent l'a activée), qui continue écran éteint.
// Textes traduits ici (langue de l'app) ; le natif ne remplit que la position.
const sosState = ref<SosState | null>(null)
const sosOpen = ref(false)
// SOS natif impossible (appel direct) ou arrêté avant sa fin (à refaire) : toujours dit à l'enfant.
const sosFailed = ref(false)
const sosInterrupted = ref(false)
// Un seul SOS à la fois depuis cet écran (lancement, attente de confirmation, repli).
let sosBusy = false
function onSosState(s: SosState) {
  // Interrompu : rien ne tourne, jamais montré en cours ; l'enfant peut le relancer.
  if (s.interrupted === true || s.status === 'interrupted') {
    sosInterrupted.value = true
    sosOpen.value = false
    sosState.value = null
    return
  }
  sosState.value = s
  if (s.active) sosOpen.value = true
  if (s.status === 'failed') sosFailed.value = true
}
// SOS affiché en cours : état relu toutes les 15 s (un SOS perdu sans événement passe à « interrompu »).
const sosWatch = setInterval(() => { if (sosOpen.value && sosState.value?.active && !sosBusy) void readSos() }, 15_000)
async function readSos() {
  if (!Capacitor.isNativePlatform()) return
  const s = await AkaikySos.state().catch(() => null)
  if (s) onSosState(s)
}
// Ordre prévu, affiché avant le premier état du natif (même règle que lui).
const plannedCalls = computed(() => buildSosPlan(contacts.value, emergency.value, !!school.value).calls.map((c) => c.name))
async function sos() {
  if (sosBusy) return
  sosBusy = true
  try { await runSos() } finally { sosBusy = false }
}
async function runSos() {
  callError.value = false
  sosFailed.value = false
  sosInterrupted.value = false
  await pushAllowed()
  if (Capacitor.isNativePlatform() && state.value.kind === 'paired') {
    const s = t.value.child.sos
    const name = state.value.firstName
    sosState.value = null
    const outcome = await confirmNativeSos<SosState>({
      start: () => AkaikySos.start({
        contacts: contacts.value.map(({ id, name, phone, position, parent }) => ({ id, name, phone, position, parent: parent === true })),
        emergency: emergency.value,
        siren: deviceConfig.config?.sosSiren === true,
        smsWith: s.smsWith(name),
        smsWithout: s.smsWithout(name),
        notifyTitle: s.notifyTitle,
        notifyText: s.notifyText,
        timezone: familyZone.value
      }),
      state: () => AkaikySos.state(),
      // Repli : le service lâche d'abord ce SOS (1,5 s d'attente au plus), puis l'appel direct.
      cancel: (o) => AkaikySos.cancel(o),
      onState: onSosState,
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms))
    })
    if (outcome === 'running') { sosOpen.value = true; void readSos(); return }
    // Rien ne tourne : erreur visible et ancien SOS (appel direct) ci-dessous.
    sosFailed.value = true
    sosOpen.value = false
    sosState.value = null
  }
  // Coque plus ancienne, sans service SOS : premier contact puis, si l'appel ne part pas,
  // le numéro d'urgence. Jamais bloqué par un appel en cours.
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
async function cancelSos() {
  await AkaikySos.cancel().catch(() => {})
  void readSos()
}
// « Appeler les secours » de l'écran rouge : pendant le SOS, le service arrête la cascade
// (appel en cours coupé) puis ouvre le composeur ; sinon, composeur ouvert directement.
async function sosEmergency() {
  const status = sosState.value?.status
  if (sosState.value?.active && status !== 'answered' && status !== 'cancelled') {
    const res = await AkaikySos.emergency().catch(() => ({ handled: false }))
    if (res.handled) return
  }
  await callEmergency()
}
function closeSos() {
  sosOpen.value = false
  sosState.value = null
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
    // Arrêt de la surveillance en arrière-plan sans l'attendre : un échec ou une lenteur
    // du natif ne doit jamais laisser le code ni le filtre en place.
    void backgroundStatus.stop().catch(() => {})
  } else {
    await refreshKiosk().catch(() => {})
  }
}
const unlockedUntil = computed(() => kiosk.status?.unlockedUntil)
async function openPhoneSettings() {
  await AkaikyKiosk.openSettings().catch(() => {})
}

// Mise à jour de l'app (NAR-170) : version annoncée par la configuration, installée par le natif
// (qui revérifie tout et refuse pendant un appel). Jamais pendant un SOS ; au plus un essai par 6 h.
const apkUpdater = createApkUpdater({ plugin: AkaikyUpdate, busy: () => sosBusy || sosOpen.value || !!sosState.value?.active })
// Mise à jour OTA (NAR-191) : jamais pendant le démarrage (appairage en cours), un SOS lancé
// par l'écran, ni la saisie du code parent ; le natif ajoute appel et SOS en cours
// (src/lib/otaRuntime.ts).
setOtaScreenBusy(() => busy.value || sosBusy || sosOpen.value || !!sosState.value?.active || unlocking.value)
function checkUpdate() {
  if (!Capacitor.isNativePlatform() || state.value.kind !== 'paired') return
  void apkUpdater.check(deviceConfig.config?.apk)
}
watch(() => deviceConfig.config?.apk, checkUpdate)
// Téléphone retiré pendant l'usage : l'écran le dit.
watch(() => deviceConfig.status, (s) => { if (s === 'lost') state.value = { kind: 'revoked' } })
onBeforeUnmount(() => { setOtaScreenBusy(() => true); unmounted = true; pushListeners.forEach((h) => void h.remove()); childPush.stop(); clearInterval(sosWatch); clearInterval(schoolWatch); stopClock(); pause(); stopStatus(); stopLocate(); clearTimeout(journalRetry); void lifecycle?.remove(); void sosListener?.remove() })

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
    <!-- Contenu défilant au-dessus du pied fixe : SOS toujours visible (NAR-187) ; secours depuis
         l'écran du SOS (NAR-237). -->
    <div class="content">
      <!-- Mode parent (planche 05, NAR-238) : barre verte compacte en haut ; le cadenas disparaît
           (canUnlock est faux tant que le téléphone est ouvert). -->
      <section v-if="unlockedUntil !== undefined" class="parent-bar" role="status">
        <AppIcon name="unlock" :size="22" />
        <span class="parent-bar-text">
          <strong>{{ t.child.lock.mode }}</strong>
          <span>{{ t.child.lock.modeUntil(formatClock(new Date(unlockedUntil))) }}</span>
        </span>
        <!-- Visuels de 44 px (maquette) dans des cibles de 64 px (--tap-child). -->
        <button class="parent-bar-gear" type="button" :aria-label="t.child.lock.settings" @click="openPhoneSettings"><span class="gear-ring" aria-hidden="true"><AppIcon name="gear" :size="20" /></span></button>
        <button class="parent-bar-relock" type="button" @click="lockNow().catch(() => {})"><span class="relock-pill">{{ t.child.lock.relockShort }}</span></button>
      </section>
      <!-- Heure à gauche, cadenas du code parent à droite (maquette allégée, NAR-237) : discret,
           réservé aux parents, jamais pris pour une action de l'enfant. -->
      <ChildStatusBar>
        <button v-if="canUnlock" class="parent-code" type="button" :aria-label="t.child.lock.open" @click="unlocking = true">
          <span class="lock" aria-hidden="true"><AppIcon name="lock" :size="20" /></span>
        </button>
      </ChildStatusBar>
      <!-- Pastilles d'une ligne (planches 02 à 04) : école, localisation, filtrage. -->
      <div v-if="school || watchers.length || screeningOff" class="chips">
        <p v-if="school" class="chip chip-school" role="status"><AppIcon name="cap" :size="16" />{{ t.child.school.pill(school.label, schoolEnd) }}</p>
        <WatchingBadge v-if="watchers.length" :names="watchers" />
        <p v-if="screeningOff" class="chip chip-warn" role="status"><AppIcon name="alert-circle" :size="16" />{{ t.child.screening.pill }}</p>
      </div>
      <!-- Filtrage inactif, téléphone ouvert (avant l'armement ou en mode parent) : le détail et
           « Activer », derrière le cadenas pour l'enfant. -->
      <section v-if="askScreening" class="unlocked" role="status">
        <p v-if="incomingOff">{{ t.child.screening.off }}</p>
        <p v-if="outgoingOff">{{ t.child.screening.outgoingOff }}</p>
        <AppButton v-if="canEnableScreening" @click="enableScreening">{{ t.child.screening.enable }}</AppButton>
      </section>
      <p v-if="sosFailed" class="call-error" role="alert">{{ t.child.sos.failed }}</p>
      <p v-else-if="sosInterrupted" class="call-error" role="alert">{{ t.child.sos.interrupted }}</p>
      <p v-if="callError" class="call-error" role="alert">{{ t.child.callFailed }}</p>
      <!-- Avec des applications (planche 03) : vignettes resserrées, tout tient sans défiler. -->
      <section v-if="shown.length" class="grid" :class="{ single: shown.length === 1, compact: !school && tiles.length > 0 }">
        <ContactTile v-for="c in shown" :key="c.id" :name="c.name" :color="c.avatarColor" :busy="calling" :wide="shown.length === 1" @call="call(c.phone, c)" />
      </section>
      <section v-else-if="school" class="empty">
        <p class="waiting">{{ t.child.school.noParents }}</p>
      </section>
      <!-- Sans contacts (planche 02) : état vide illustré. -->
      <section v-else class="empty no-contacts">
        <span class="empty-art" aria-hidden="true"><AppIcon name="users" :size="44" /></span>
        <p class="empty-title">{{ t.child.noContacts }}</p>
        <p class="empty-hint">{{ t.child.noContactsHint }}</p>
      </section>
      <!-- Plage (planche 04) : les contacts masqués en fantôme, avec l'heure de retour. -->
      <section v-if="school && hidden.length" class="ghosts">
        <span class="ghost-avatars" aria-hidden="true">
          <span v-for="c in hidden.slice(0, 3)" :key="c.id" class="ghost" :style="{ background: accentToken(c.avatarColor) }">{{ initial(c.name) }}</span>
        </span>
        <span>{{ t.child.school.back(joinNames(hidden.map((c) => c.name), t.child.school.and), hidden.length > 1, schoolEnd) }}</span>
      </section>
      <template v-if="!school">
        <button class="say" type="button" @click="messaging = true"><AppIcon name="mail" :size="22" />{{ t.child.quick.title }}</button>
        <AppsRow v-if="tiles.length" :apps="tiles" @launch="launch" />
        <p v-if="launchError" class="call-error" role="alert">{{ t.child.apps.failed }}</p>
        <QuickMessagesPanel v-if="messaging" @close="messaging = false" />
      </template>
    </div>
    <!-- Pied compact (NAR-237) : le SOS seul, au même endroit. Les secours (117) ne sont plus sur
         l'accueil (décision utilisateur du 25/11/2026) : écran du SOS en cours, alerte envoyée,
         écrans d'attente ou d'erreur. -->
    <footer class="actions">
      <SosButton @trigger="sos" />
    </footer>
    <UnlockPanel v-if="unlocking" :hash="parentHash" @close="unlocking = false" @unlocked="onUnlocked" />
    <SosSentView v-if="sosOpen" :state="sosState" :planned-calls="plannedCalls" :emergency="emergency" @cancel="cancelSos" @close="closeSos" @emergency="sosEmergency" />
  </main>
  <main v-else class="child">
    <h1>Akaiky</h1>
    <p class="waiting" role="status">{{ text.title }}</p>
    <p v-if="text.hint" class="hint">{{ text.hint }}</p>
    <AppButton v-if="state.kind === 'offline' || state.kind === 'tooMany' || state.kind === 'failed'" class="retry" :disabled="busy" @click="start">{{ t.child.retry }}</AppButton>
    <!-- Verrouillé sur un écran d'attente ou d'erreur : secours et sortie parent restent là. -->
    <template v-if="kiosk.status?.armed">
      <button class="emergency" type="button" @click="callEmergency">{{ t.child.emergency(emergency) }}</button>
      <button v-if="canUnlock" class="parent-code" type="button" @click="unlocking = true">{{ t.child.lock.open }}</button>
      <template v-if="unlockedUntil !== undefined">
        <p class="hint">{{ t.child.lock.unlockedUntil(formatClock(new Date(unlockedUntil))) }}</p>
        <AppButton v-if="canRelease" @click="release">{{ t.child.lock.release }}</AppButton>
        <AppButton variant="ghost" @click="lockNow().catch(() => {})">{{ t.child.lock.relock }}</AppButton>
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
/* Écran tenu à la hauteur de la fenêtre (NAR-187) : le contenu défile, le pied (SOS,
 * secours, code parent) reste en bas, au-dessus de la barre système, sans jamais
 * recouvrir une vignette : il occupe sa propre place dans la colonne. */
.home {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--bg-child);
  box-sizing: border-box;
}
.content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: calc(var(--safe-top) + var(--space-3)) calc(var(--gutter) + var(--safe-right)) var(--space-4) calc(var(--gutter) + var(--safe-left));
}
/* Plage « école » : fond bleu pâle, sans texte de plus (planche 04, NAR-238). */
.home.school {
  background: var(--bg-child-school);
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
/* Planche 03 : avatar de 58 px, vignettes plus basses, quand la rangée d'applications suit. */
.grid.compact {
  gap: 10px;
}
.grid.compact :deep(.tile:not(.wide)) {
  min-height: 0;
  padding: 14px 10px 12px;
}
.grid.compact :deep(.avatar) {
  width: 58px;
  height: 58px;
  font-size: 1.6rem;
}
.empty {
  text-align: center;
}
/* Sans contacts (planche 02) : rond pêche, pictogramme famille, titre, phrase pour l'enfant. */
.empty.no-contacts {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 0 20px;
}
.empty-art {
  display: grid;
  place-items: center;
  width: 112px;
  height: 112px;
  border-radius: 50%;
  background: var(--tint-peach);
  color: var(--accent-orange-deep);
}
.empty-title {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 900;
}
.empty-hint {
  margin: 0;
  color: var(--text-soft);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.45;
}
/* Pastilles d'une ligne (planches 02 à 04) : école marine, localisation bleue, filtrage ambre. */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 700;
}
.chip-school {
  background: var(--navy);
  color: var(--on-color);
}
.chip-warn {
  background: var(--warning-bg);
  color: var(--warning-ink);
}
/* Contacts masqués pendant une plage : cadre en tirets, avatars pâles superposés. */
.ghosts {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1.5px dashed var(--border-strong);
  border-radius: 18px;
  color: var(--text-soft);
  font-size: 0.9rem;
  font-weight: 700;
}
.ghost-avatars {
  display: flex;
  flex: none;
}
.ghost {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: var(--on-color);
  font-size: 0.95rem;
  font-weight: 900;
  opacity: 0.45;
}
.ghost + .ghost {
  margin-left: -8px;
}
/* Mode parent (planche 05) : barre verte, engrenage des réglages, « Reverrouiller » blanc. */
.parent-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0 4px 0 14px;
  border-radius: 18px;
  background: var(--call);
  color: var(--on-color);
}
.parent-bar-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
}
.parent-bar-text strong {
  font-size: 0.95rem;
  font-weight: 800;
}
.parent-bar-gear,
.parent-bar-relock {
  display: grid;
  flex: none;
  place-items: center;
  min-width: var(--tap-child);
  min-height: var(--tap-child);
  padding: 0;
  border: 0;
  background: none;
  color: var(--on-color);
  font: inherit;
  cursor: pointer;
}
.gear-ring {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1.5px solid var(--on-color-line);
  border-radius: 50%;
  background: var(--on-color-fill);
}
.relock-pill {
  display: grid;
  place-items: center;
  height: 44px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--accent-deep);
  font-size: 0.9rem;
  font-weight: 800;
}
.parent-bar-gear:focus-visible,
.parent-bar-relock:focus-visible {
  outline: 3px solid var(--on-color);
  outline-offset: 2px;
}
.actions {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  /* Pied compact (maquette allégée, NAR-237) : environ 14 % de la hauteur. */
  padding: var(--space-3) calc(var(--gutter) + var(--safe-right)) calc(var(--safe-bottom) + var(--space-3)) calc(var(--gutter) + var(--safe-left));
  border-top: 1px solid var(--border);
  background: inherit;
}
/* « Dire à mes parents » : un vrai bouton pleine largeur (plus la tuile coupée par le pied). */
.say {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: var(--tap-child);
  border: 0;
  border-radius: 18px;
  background: var(--tint-butter);
  color: var(--ink);
  font: inherit;
  font-size: 1.05rem;
  font-weight: 800;
  cursor: pointer;
}
.say:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
/* Écran couché ou très court : pied sur une ligne, pour laisser au contenu la hauteur
 * d'une vignette entière (sinon le pied en colonne en prend les trois quarts). */
/* Écran couché ou très court : pied compact resserré (le paysage aura sa mise en page, NAR-242). */
@media (max-height: 480px) {
  .actions {
    gap: var(--space-1);
    padding-top: var(--space-2);
    padding-bottom: calc(var(--safe-bottom) + var(--space-2));
  }
}
/* Zones tactiles de l'app enfant : ≥ --tap-child (64 px, CdC §7.3), boutons communs compris. */
.home .btn,
.child .btn {
  min-height: var(--tap-child);
}
.emergency {
  min-height: var(--tap-child);
  padding: 0 var(--space-5);
  border: 2px solid var(--sos);
  border-radius: var(--radius-pill);
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
/* Discret : réservé aux parents, protégé par le code. Écrans d'attente : lien souligné ;
 * accueil : cadenas rond de 44 px en haut à droite, cible de 64 px (NAR-237). */
.parent-code {
  min-height: var(--tap-child);
  padding: 0 var(--space-4);
  border: 0;
  background: transparent;
  color: var(--text-soft);
  font: inherit;
  font-weight: 700;
  text-decoration: underline;
}
.content > :deep(.status) {
  /* En-tête collant (NAR-237) : le cadenas du code parent reste à l'écran quand le contenu défile. */
  position: sticky;
  top: calc(-1 * (var(--safe-top) + var(--space-3)));
  z-index: 2;
  margin: calc(-1 * (var(--safe-top) + var(--space-3))) calc(-1 * (var(--gutter) + var(--safe-right))) 0 calc(-1 * (var(--gutter) + var(--safe-left)));
  padding: calc(var(--safe-top) + var(--space-3)) calc(var(--gutter) + var(--safe-right)) var(--space-2) calc(var(--gutter) + var(--safe-left));
  background: var(--bg-child);
}
.home.school .content > :deep(.status) {
  background: var(--bg-child-school);
}
.status .parent-code {
  display: grid;
  flex: none;
  place-items: center;
  width: var(--tap-child);
  height: var(--tap-child);
  margin: -10px -10px 0 0;
  padding: 0;
}
.lock {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1.5px solid var(--border);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text-soft);
}
.parent-code:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
.call-error {
  margin: 0;
  text-align: center;
  font-weight: 800;
  color: var(--sos);
}
.retry {
  margin-top: var(--space-4);
  padding: 0 var(--space-6);
}
</style>
