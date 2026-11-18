<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { useT } from '../../composables/useT'
import { appKind } from '../../lib/appKind'
import { startChild, type ChildState } from '../../lib/childStartup'
import { callJournal, childIdentity, configSync, deviceSession as session } from '../../lib/deviceSessionInstance'
import { deviceConfig, pause, resume, startDeviceConfig, stopDeviceConfig } from '../../composables/useDeviceConfig'
import { emergencyNumber } from '../../lib/emergency'
import { sosPlan } from '../../lib/sos'
import { AkaikyCall } from '../../native/akaikyCall'
import { AkaikyDevice, type DeviceStatus } from '../../native/akaikyDevice'
import ChildStatusBar from '../../components/child/ChildStatusBar.vue'
import ContactTile from '../../components/child/ContactTile.vue'
import SosButton from '../../components/child/SosButton.vue'

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
    if (isActive && state.value.kind === 'paired') { resume(); startStatus(); syncJournal() } else { pause(); stopStatus() }
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
const emergency = computed(() => emergencyNumber(deviceConfig.config?.country))
const calling = ref(false)
const callError = ref(false)
// Un appui, un appel : l'appli téléphone prend le relais. Pas de double appel en rafale.
// Journal (NAR-166) : durées relevées au retour du composeur, puis envoi (ou file hors ligne).
function syncJournal() {
  void callJournal.complete().then(() => callJournal.flush()).catch(() => {})
}

async function call(phone: string, contactId: string) {
  if (calling.value) return
  calling.value = true
  callError.value = false
  try {
    // Au mieux : la liste gardée par le natif sert si cet envoi échoue.
    await AkaikyCall.setAllowed({ numbers: allowedNumbers() }).catch(() => {})
    await AkaikyCall.call({ number: phone })
    void callJournal.started(contactId, phone).catch(() => {})
  } catch {
    callError.value = true
  } finally {
    setTimeout(() => { calling.value = false }, 1500)
  }
}
// SOS maintenu 3 s : en attendant l'alerte complète (NAR-149), premier contact puis,
// si l'appel ne part pas, le numéro d'urgence. Jamais bloqué par un appel en cours.
async function sos() {
  callError.value = false
  await AkaikyCall.setAllowed({ numbers: allowedNumbers() }).catch(() => {})
  for (const step of sosPlan(contacts.value, emergency.value)) {
    try {
      if (step.kind === 'contact') {
        await AkaikyCall.call({ number: step.number })
        const contact = contacts.value.find((c) => c.phone === step.number)
        if (contact) void callJournal.started(contact.id, step.number).catch(() => {})
      } else await AkaikyCall.emergency({ number: step.number })
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

// Téléphone retiré pendant l'usage : l'écran le dit.
watch(() => deviceConfig.status, (s) => { if (s === 'lost') state.value = { kind: 'revoked' } })
onBeforeUnmount(() => { unmounted = true; pause(); stopStatus(); void lifecycle?.remove() })

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
    <p v-if="callError" class="call-error" role="alert">{{ t.child.callFailed }}</p>
    <section v-if="contacts.length" class="grid" :class="{ single: contacts.length === 1 }">
      <ContactTile v-for="c in contacts" :key="c.id" :name="c.name" :color="c.avatarColor" :busy="calling" @call="call(c.phone, c.id)" />
    </section>
    <section v-else class="empty">
      <p class="waiting">{{ t.child.noContacts }}</p>
      <p class="hint">{{ t.child.noContactsHint }}</p>
    </section>
    <footer class="actions">
      <SosButton @trigger="sos" />
      <button class="emergency" type="button" @click="callEmergency">{{ t.child.emergency(emergency) }}</button>
    </footer>
  </main>
  <main v-else class="child">
    <h1>Akaiky</h1>
    <p class="waiting" role="status">{{ text.title }}</p>
    <p v-if="text.hint" class="hint">{{ text.hint }}</p>
    <button v-if="state.kind === 'offline' || state.kind === 'tooMany' || state.kind === 'failed'" class="btn retry" type="button" :disabled="busy" @click="start">{{ t.child.retry }}</button>
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
