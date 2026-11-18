<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { useT } from '../../composables/useT'
import { appKind } from '../../lib/appKind'
import { startChild, type ChildState } from '../../lib/childStartup'
import { configSync, deviceSession as session } from '../../lib/deviceSessionInstance'
import { deviceConfig, pause, resume, startDeviceConfig, stopDeviceConfig } from '../../composables/useDeviceConfig'
import { AkaikyDevice } from '../../native/akaikyDevice'

// Écran de l'app enfant (NAR-164) : échange du jeton reçu au provisionnement (QR),
// puis écran de l'enfant. L'accueil complet (contacts, SOS) arrive avec NAR-142.
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
      }
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
    if (isActive && state.value.kind === 'paired') resume(); else pause()
  })
  if (unmounted) { void handle.remove(); return }
  lifecycle = handle
  // État réel au moment de l'écoute : lancée en arrière-plan, l'app ne relève rien.
  foreground = (await App.getState()).isActive
  if (foreground && state.value.kind === 'paired') resume()
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
  if (!unmounted && foreground && state.value === s) resume()
})
// Téléphone retiré pendant l'usage : l'écran le dit.
watch(() => deviceConfig.status, (s) => { if (s === 'lost') state.value = { kind: 'revoked' } })
onBeforeUnmount(() => { unmounted = true; pause(); void lifecycle?.remove() })

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
  <main class="child">
    <h1>Akaiky</h1>
    <p class="waiting" role="status">{{ text.title }}</p>
    <p v-if="text.hint" class="hint">{{ text.hint }}</p>
    <!-- Contacts autorisés reçus du parent (NAR-160) ; l'accueil complet arrive avec NAR-142. -->
    <ul v-if="state.kind === 'paired' && deviceConfig.config?.contacts.length" class="contacts">
      <li v-for="c in deviceConfig.config.contacts" :key="c.id">{{ c.name }}</li>
    </ul>
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
.contacts {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
.contacts li {
  padding: 8px 16px;
  border-radius: 999px;
  background: var(--surface-card);
  font-weight: 800;
}
.retry {
  margin-top: 16px;
  min-height: 64px;
  padding: 0 32px;
}
</style>
