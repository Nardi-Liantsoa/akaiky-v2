<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ApiError } from '../../api/http'
import { getPosition, requestLocate, type PositionState } from '../../api/location'
import AppIcon from '../../components/ui/AppIcon.vue'
import BackLink from '../../components/ui/BackLink.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'
import { locale, useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { formatCoord, shortDuration } from '../../lib/sosTime'
import { children, loadChildren } from '../../store/children'

// « Où est Fy ? » (NAR-205, tranche parent de NAR-146) : tout membre demande la position ; le
// téléphone de l'enfant la relève une fois (et l'enfant le voit), la carte la montre avec sa
// précision et son heure. Jamais de suivi : la demande dure 2 minutes, redemandée toutes les
// 100 s tant que l'écran est ouvert. Pas de maquette : langage de l'alerte SOS (NAR-249).
const MapView = defineAsyncComponent(() => import('../../components/MapView.vue'))
const POLL_MS = 3000
const RENEW_MS = 100_000
const t = useT()
const route = useRoute()
const id = computed(() => String(route.params.id ?? ''))
const child = computed(() => children.items.find((c) => c.id === id.value) ?? null)
const name = computed(() => child.value?.firstName ?? '…')
const state = ref<PositionState | null>(null)
const error = ref('')
const asked = ref(false)
const missing = ref(false)
const mapOff = ref(false)
const now = ref(Date.now())

const position = computed(() => state.value?.position ?? null)
// Relevé pris après la demande en cours : la réponse du téléphone.
const fresh = computed(() => {
  const p = position.value, req = state.value?.requestedAt
  return !!p && !!req && Date.parse(p.recordedAt) >= Date.parse(req)
})
const watching = computed(() => !!state.value?.watchingUntil && Date.parse(state.value.watchingUntil) > now.value)
const ago = (iso: string) => shortDuration(now.value - Date.parse(iso), t.value)
const statusText = computed(() => {
  const p = position.value
  if (p && fresh.value) return t.value.locate.updated(ago(p.recordedAt), p.accuracyM)
  if (asked.value && !watching.value) return t.value.locate.noAnswer(name.value)
  if (p) return t.value.locate.old(ago(p.recordedAt))
  return t.value.locate.asking(name.value)
})

let poll: ReturnType<typeof setInterval> | undefined
let renew: ReturnType<typeof setInterval> | undefined
let clock: ReturnType<typeof setInterval> | undefined

async function read() {
  try {
    state.value = await getPosition(id.value)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) missing.value = true
    else error.value = errorText(e, t.value)
  }
}
async function ask() {
  error.value = ''
  try {
    await requestLocate(id.value)
    asked.value = true
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) { missing.value = true; return }
    error.value = e instanceof ApiError && e.status === 429 ? t.value.locate.limited : errorText(e, t.value)
  }
  await read()
}
const visible = () => document.visibilityState === 'visible'
function start() {
  stop()
  void ask()
  poll = setInterval(() => { if (visible() && !missing.value) void read() }, POLL_MS)
  // Consultation gardée ouverte tant que l'écran est là (le serveur la ferme à 2 min).
  renew = setInterval(() => { if (visible() && !missing.value) void ask() }, RENEW_MS)
  clock = setInterval(() => { now.value = Date.now() }, 1000)
}
function stop() { clearInterval(poll); clearInterval(renew); clearInterval(clock) }
const onVisible = () => { if (visible()) { now.value = Date.now(); void read() } }
watch(id, () => { state.value = null; asked.value = false; missing.value = false; start() })
onMounted(() => { void loadChildren(); start(); document.addEventListener('visibilitychange', onVisible) })
onBeforeUnmount(() => { stop(); document.removeEventListener('visibilitychange', onVisible) })
</script>

<template>
  <section class="locate">
    <BackLink :to="{ name: 'espace' }" :label="t.locate.back" />
    <h1>{{ t.locate.title(name) }}</h1>
    <p class="seen"><AppIcon name="info" :size="18" />{{ t.locate.seen(name) }}</p>

    <StatusBlock v-if="missing" state="empty" card :text="t.locate.notFound" />
    <template v-else>
      <div class="map panel">
        <MapView
          v-if="position && !mapOff" :lat="position.lat" :lng="position.lng" :accuracy-m="position.accuracyM"
          :name="name" :color="child?.avatarColor ?? 'yellow'" :label="t.locate.mapLabel(name)" @unavailable="mapOff = true"
        />
        <div v-else class="placeholder" aria-hidden="true"><AppIcon name="pin" :size="40" /></div>
      </div>
      <div class="place panel" role="status">
        <span class="dot" :class="{ off: !fresh }" aria-hidden="true" />
        <div>
          <strong v-if="position">{{ t.sosAlert.coords(formatCoord(position.lat, locale), formatCoord(position.lng, locale)) }}</strong>
          <span>{{ statusText }}</span>
          <span v-if="mapOff && position" class="note">{{ t.locate.mapUnavailable }}</span>
        </div>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button v-if="asked && !watching && !fresh" type="button" class="btn" @click="ask"><AppIcon name="refresh" :size="20" />{{ t.locate.retry }}</button>
    </template>
  </section>
</template>

<style scoped>
.locate {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.locate h1 {
  margin: 0;
}
.seen {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--text-soft);
  font-weight: 700;
}
.panel {
  background: var(--surface);
  border-radius: var(--radius-sm);
  box-shadow: 0 2px 10px rgb(0 0 0 / 8%);
}
.map {
  height: min(60vh, 420px);
  overflow: hidden;
  background: var(--surface-muted);
}
.placeholder {
  display: grid;
  place-items: center;
  height: 100%;
  color: var(--text-mute);
}
.place {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}
.place strong,
.place span {
  display: block;
}
.place span {
  color: var(--text-mute);
  font-size: var(--fs-small);
}
.place .note {
  margin-top: 4px;
}
.dot {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--call);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--call) 22%, transparent);
}
.dot.off {
  background: var(--text-mute);
  box-shadow: none;
}
.btn {
  align-self: flex-start;
}
.error {
  margin: 0;
}
</style>
