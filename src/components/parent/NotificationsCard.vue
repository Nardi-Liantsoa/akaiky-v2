<script setup lang="ts">
import { ref } from 'vue'
import { api, ApiError } from '../../api/http'
import { useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { enablePush, pushState } from '../../lib/parentPush'
import AppButton from '../ui/AppButton.vue'
import SectionCard from '../ui/SectionCard.vue'

// Notifications de l'app parent (NAR-179), dans Mon compte : l'explication d'abord, puis la
// permission demandée sur un geste ; refusée, l'app marche sans et le texte dit comment la
// réactiver dans les réglages du téléphone. Notification de test : 5 par heure (serveur).
const t = useT()
const busy = ref(false)
const message = ref('')
const error = ref('')

async function enable() {
  if (busy.value) return
  busy.value = true
  try { await enablePush() } finally { busy.value = false }
}
async function test() {
  if (busy.value) return
  busy.value = true
  message.value = ''
  error.value = ''
  try {
    const { queued } = await api.post<{ queued: number }>('/push/test', {})
    // Aucun jeton de ce téléphone encore connu du serveur (enregistrement en cours ou
    // retenté) : rien ne partira, on le dit.
    message.value = queued > 0 ? t.value.push.testSent : t.value.push.testNone
  } catch (e) {
    error.value = e instanceof ApiError && e.status === 429 ? t.value.push.testTooMany : errorText(e, t.value)
  } finally { busy.value = false }
}
</script>

<template>
  <SectionCard :title="t.push.title" :help="t.push.lead">
    <template v-if="pushState === 'granted'">
      <p>{{ t.push.on }}</p>
      <p v-if="message" class="help" role="status">{{ message }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <AppButton variant="ghost" :disabled="busy" @click="test">{{ t.push.test }}</AppButton>
    </template>
    <p v-else-if="pushState === 'denied'" class="help">{{ t.push.denied }}</p>
    <p v-else-if="pushState === 'unavailable'" class="help">{{ t.push.unavailable }}</p>
    <AppButton v-else :disabled="busy" @click="enable">{{ t.push.enable }}</AppButton>
  </SectionCard>
</template>
