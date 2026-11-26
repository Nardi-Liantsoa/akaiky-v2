<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ApiError } from '../../api/http'
import { getChildStatus } from '../../api/devices'
import { getSos, markSos, type SosDetails } from '../../api/sos'
import ChildAvatar from '../../components/parent/ChildAvatar.vue'
import AppIcon from '../../components/ui/AppIcon.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'
import { locale, useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { formatClock } from '../../lib/format'
import { formatCoord, shortDuration } from '../../lib/sosTime'
import { children, loadChildren } from '../../store/children'

// Alerte SOS côté parent (NAR-249, maquette 08) : bandeau rouge, position en direct (carte avec
// NAR-205 ; d'ici là, la position en texte), qui a vu, qui arrive, qui s'en occupe. Relue toutes
// les 3 s (le téléphone envoie sa position toutes les 30 s). Ouverte au toucher de la
// notification `sos` ou depuis le bandeau des alertes en cours. Tous les rôles, `member` compris.
const POLL_MS = 3000
// Pastilles des membres (maquette 08 : une couleur par personne) ; « Vous » en V.
const PEOPLE_COLORS = ['blue', 'violet', 'green', 'orange'] as const
const USER_INITIAL = 'V'
const t = useT()
const route = useRoute()
const id = computed(() => String(route.params.id ?? ''))
const alert = ref<SosDetails | null>(null)
const status = ref<'loading' | 'ready' | 'error' | 'missing'>('loading')
const loadError = ref('')
const actionError = ref('')
const busy = ref<'coming' | 'handle' | null>(null)
const battery = ref<number | null>(null)
const now = ref(Date.now())

const child = computed(() => children.items.find((c) => c.id === alert.value?.childId) ?? null)
const name = computed(() => child.value?.firstName ?? '…')
const ago = (iso: string) => shortDuration(now.value - Date.parse(iso), t.value)
const open = computed(() => alert.value?.status === 'active')
const mine = (kind: 'coming' | 'handled') => !!alert.value?.events.some((e) => e.kind === kind && e.isMe)
// Une ligne par membre : son geste le plus fort (s'en occupe > arrive > a vu).
const people = computed(() => {
  const rank = { seen: 0, coming: 1, handled: 2 } as const
  const best = new Map<string, { kind: keyof typeof rank, name: string, isMe: boolean }>()
  for (const e of alert.value?.events ?? []) {
    const key = e.isMe ? '\u0000me' : e.name
    const prev = best.get(key)
    if (!prev || rank[e.kind] > rank[prev.kind]) best.set(key, { kind: e.kind, name: e.name, isMe: e.isMe })
  }
  return [...best.values()].sort((a, b) => rank[b.kind] - rank[a.kind])
})
const personText = (p: { kind: 'seen' | 'coming' | 'handled', name: string, isMe: boolean }) =>
  p.isMe ? t.value.sosAlert[`${p.kind}Me`] : t.value.sosAlert[p.kind](p.name || t.value.sosAlert.someone)

let timer: ReturnType<typeof setInterval> | undefined
let clock: ReturnType<typeof setInterval> | undefined
let seenSent = ''

async function load() {
  const current = id.value
  try {
    const a = await getSos(current)
    if (current !== id.value) return
    alert.value = a
    status.value = 'ready'
    loadError.value = ''
    // Vu une fois par alerte et par écran (le serveur n'en garde qu'un par membre).
    if (seenSent !== a.id && !a.events.some((e) => e.kind === 'seen' && e.isMe)) {
      seenSent = a.id
      void markSos(a.id, 'seen').then((fresh) => { if (fresh.id === id.value) alert.value = fresh }).catch(() => { seenSent = '' })
    }
  } catch (e) {
    if (current !== id.value) return
    if (e instanceof ApiError && e.status === 404) { status.value = 'missing'; return }
    // Hors ligne : la dernière alerte connue reste affichée, l'erreur est dite.
    if (!alert.value) status.value = 'error'
    loadError.value = errorText(e, t.value)
  }
}
async function readBattery(childId: string) {
  const s = await getChildStatus(childId).catch(() => null)
  const pct = s?.devices.map((d) => d.batteryPct).find((p) => typeof p === 'number')
  battery.value = typeof pct === 'number' ? pct : null
}
watch(() => alert.value?.childId, (childId) => { if (childId) void readBattery(childId) })

async function act(kind: 'coming' | 'handle') {
  if (!alert.value || busy.value) return
  busy.value = kind
  actionError.value = ''
  try {
    alert.value = await markSos(alert.value.id, kind)
  } catch (e) {
    actionError.value = e instanceof ApiError && e.code === 'sos_already_handled' ? t.value.sosAlert.alreadyHandled : errorText(e, t.value)
    void load()
  } finally {
    busy.value = null
  }
}

function start() {
  stop()
  void load()
  timer = setInterval(() => { if (document.visibilityState === 'visible') void load() }, POLL_MS)
  clock = setInterval(() => { now.value = Date.now() }, 1000)
}
function stop() { clearInterval(timer); clearInterval(clock) }
watch(id, () => { alert.value = null; status.value = 'loading'; start() })
onMounted(() => { void loadChildren(); start() })
onBeforeUnmount(stop)
</script>

<template>
  <section class="sos-alert" :class="alert?.status">
    <StatusBlock v-if="status === 'loading'" state="loading" fill />
    <template v-else-if="status === 'missing' || status === 'error'">
      <h1 class="visually-hidden">{{ t.sosAlert.label }}</h1>
      <StatusBlock :state="status === 'missing' ? 'empty' : 'error'" card :text="status === 'missing' ? t.sosAlert.notFound : loadError" @retry="load" />
      <RouterLink class="back" :to="{ name: 'espace' }">{{ t.sosAlert.back }}</RouterLink>
    </template>
    <template v-else-if="alert">
      <header class="head">
        <p class="kicker">
          <span><AppIcon name="warning" :size="24" />{{ t.sosAlert.label }}</span>
          <span class="since">{{ t.sosAlert.ago(ago(alert.startedAt)) }}</span>
        </p>
        <h1>{{ t.sosAlert.title(name) }}</h1>
        <p class="meta">
          {{ t.sosAlert.started(formatClock(new Date(alert.startedAt))) }}<template v-if="battery !== null"> · {{ t.sosAlert.battery(battery) }}</template>
        </p>
      </header>

      <!-- Carte (NAR-205) : d'ici là, l'emplacement de la carte garde l'enfant et son cercle de précision. -->
      <div class="map" role="img" :aria-label="t.sosAlert.mapSoon">
        <span class="ring" />
        <ChildAvatar class="pin" :name="name" :color="child?.avatarColor ?? 'yellow'" :size="40" />
        <span class="soon">{{ t.sosAlert.mapSoon }}</span>
      </div>

      <div class="sheet">
        <div class="place card" role="status">
          <span class="dot" :class="{ off: !alert.position || !open }" aria-hidden="true" />
          <div v-if="alert.position">
            <strong>{{ t.sosAlert.coords(formatCoord(alert.position.lat, locale), formatCoord(alert.position.lng, locale)) }}</strong>
            <span>{{ t.sosAlert.live(ago(alert.position.recordedAt), alert.position.accuracyM) }}</span>
          </div>
          <div v-else><strong>{{ t.sosAlert.waiting }}</strong></div>
        </div>

        <p v-if="alert.status === 'cancelled'" class="state cancelled" role="status">{{ t.sosAlert.cancelled(name) }}</p>
        <p v-else-if="alert.status === 'handled'" class="state handled" role="status">
          <AppIcon name="shield" :size="20" />{{ alert.handledBy?.isMe ? t.sosAlert.handledByMe : t.sosAlert.handledBy(alert.handledBy?.name || t.sosAlert.someone) }}
        </p>
        <p v-else-if="alert.status === 'ended'" class="state" role="status">{{ t.sosAlert.ended }}</p>

        <ul v-if="people.length" class="people card">
          <li v-for="(p, i) in people" :key="p.isMe ? 'me' : p.name">
            <ChildAvatar :name="p.isMe ? USER_INITIAL : p.name || '?'" :color="PEOPLE_COLORS[i % PEOPLE_COLORS.length]" :size="28" />
            <span :class="{ strong: p.kind !== 'seen' }">{{ personText(p) }}</span>
          </li>
        </ul>

        <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>
        <p v-if="loadError && status === 'ready'" class="help" role="status">{{ loadError }}</p>

        <div v-if="alert.status !== 'cancelled'" class="actions">
          <a v-if="child?.phone" class="btn call" :href="`tel:${child.phone}`" :aria-label="t.sosAlert.callLabel(name)"><AppIcon name="phone" :size="22" />{{ t.sosAlert.call }}</a>
          <button type="button" class="btn coming" :disabled="busy !== null || mine('coming') || alert.status === 'handled'" @click="act('coming')">
            <AppIcon name="navigate" :size="22" />{{ t.sosAlert.comingAction }}
          </button>
          <button v-if="alert.status !== 'handled'" type="button" class="btn handle" :disabled="busy !== null" @click="act('handle')">
            <AppIcon name="shield" :size="22" />{{ t.sosAlert.handle }}
          </button>
        </div>
        <p v-if="alert.status !== 'cancelled' && alert.status !== 'handled'" class="hint">{{ t.sosAlert.handleHint }}</p>
        <RouterLink class="back" :to="{ name: 'espace' }">{{ t.sosAlert.back }}</RouterLink>
      </div>
    </template>
  </section>
</template>

<style scoped>
.sos-alert {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.head {
  background: var(--sos);
  color: var(--on-color);
  padding: calc(var(--space-5) + var(--safe-top)) calc(var(--gutter) + var(--safe-right)) var(--space-5) calc(var(--gutter) + var(--safe-left));
}
.cancelled .head,
.ended .head {
  background: var(--ink-soft);
}
.handled .head {
  background: var(--sos-deep);
}
.kicker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0 0 var(--space-2);
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.kicker > span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.since {
  letter-spacing: 0;
  text-transform: none;
  font-weight: 700;
}
.head h1 {
  margin: 0;
  color: inherit;
  font-size: clamp(1.9rem, 1.5rem + 2vw, 2.4rem);
  line-height: 1.15;
}
.meta {
  margin: var(--space-1) 0 0;
  font-weight: 700;
}
.map {
  position: relative;
  display: grid;
  place-items: center;
  height: 280px;
  background: var(--surface-muted);
  overflow: hidden;
}
.ring {
  position: absolute;
  width: 130px;
  height: 130px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--sos) 18%, transparent);
  border: 2px solid color-mix(in srgb, var(--sos) 55%, transparent);
}
.pin {
  position: relative;
  border: 3px solid var(--on-color);
  box-shadow: var(--shadow-float);
}
.soon {
  position: absolute;
  top: var(--space-2);
  right: var(--space-3);
  font-size: var(--fs-small);
  color: var(--text-mute);
  font-weight: 700;
}
.sheet {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: -36px;
  padding: 0 calc(var(--gutter) + var(--safe-right)) calc(var(--space-5) + var(--safe-bottom)) calc(var(--gutter) + var(--safe-left));
  position: relative;
}
.card {
  background: var(--surface);
  border-radius: var(--radius-sm);
  box-shadow: 0 2px 10px rgb(0 0 0 / 8%);
  padding: var(--space-3) var(--space-4);
}
.place {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}
.place strong,
.place span {
  display: block;
}
.place span {
  color: var(--text-mute);
  font-size: var(--fs-small);
}
.dot {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--sos);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--sos) 22%, transparent);
}
.dot.off {
  background: var(--text-mute);
  box-shadow: none;
}
.people {
  list-style: none;
  margin: 0;
  display: grid;
  gap: var(--space-2);
}
.people li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-soft);
}
.people .strong {
  color: var(--text);
  font-weight: 800;
}
.state {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-weight: 800;
}
.state.handled {
  color: var(--accent-deep);
}
.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}
.actions .btn {
  min-height: 60px;
  border: 0;
  justify-content: center;
}
.btn.call {
  background: var(--call);
  color: var(--on-color);
}
.btn.coming {
  background: var(--navy);
  color: var(--on-color);
}
/* Seul (pas de numéro de l'enfant) : J'arrive prend la ligne. */
.btn.coming:first-child {
  grid-column: 1 / -1;
}
.btn.handle {
  grid-column: 1 / -1;
  background: var(--ink);
  color: var(--on-color);
}
.btn:disabled {
  opacity: 0.55;
}
.hint {
  margin: 0;
  text-align: center;
  color: var(--text-mute);
  font-size: var(--fs-small);
}
.back {
  align-self: center;
  margin-top: var(--space-2);
  font-weight: 700;
}
.error {
  margin: 0;
}
</style>
